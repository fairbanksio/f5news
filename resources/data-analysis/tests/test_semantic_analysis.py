"""Test headline embeddings and model persistence without downloading weights."""
import hashlib
import sqlite3
import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

import joblib
import numpy as np
import pandas as pd

MODULE_PATH = Path(__file__).resolve().parents[1]
if str(MODULE_PATH) not in sys.path:
    sys.path.insert(0, str(MODULE_PATH))
import semantic_analysis


class FakeEncoder:
    def __init__(self):
        self.calls = []

    @staticmethod
    def vector(title):
        vector = np.zeros(semantic_analysis.DIMENSIONS, dtype=np.float32)
        index = 0 if title.startswith("Apple") else 1 if title.startswith("Banana") else 2
        vector[index] = 1
        return vector

    def encode(self, titles, **kwargs):
        self.calls.append((list(titles), kwargs))
        return np.stack([self.vector(title) for title in titles])


class SemanticAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.cache = Path(self.directory.name)
        self.encoder = FakeEncoder()
        self.encoder_patch = patch.object(semantic_analysis, "_encoder", return_value=self.encoder)
        self.encoder_factory = self.encoder_patch.start()
        self.addCleanup(self.encoder_patch.stop)

    def encode(self, titles):
        return semantic_analysis.encode_titles(titles, self.cache)

    def test_cache_misses_are_deduplicated_and_preserve_input_order(self):
        titles = ["Banana market", "Apple orchard", "Banana market", "New headline"]
        vectors = self.encode(titles)
        np.testing.assert_array_equal(vectors, np.stack([self.encoder.vector(title) for title in titles]))
        self.assertEqual(vectors.dtype, np.float32)
        self.assertEqual(self.encoder.calls[0][0], ["Banana market", "Apple orchard", "New headline"])
        self.assertEqual(self.encoder.calls[0][1], {
            "batch_size": 64, "normalize_embeddings": True,
            "convert_to_numpy": True, "show_progress_bar": True,
        })
        self.encoder_factory.assert_called_once_with(str(self.cache))
        with sqlite3.connect(self.cache / "embeddings.sqlite") as db:
            self.assertEqual(db.execute("SELECT count(*) FROM embeddings").fetchone()[0], 3)

    def test_cache_hits_skip_encoder_and_encode_only_new_titles(self):
        self.encode(["Apple orchard", "Banana market"])
        self.encoder.calls.clear()
        self.encoder_factory.reset_mock()
        vectors = self.encode(["Banana market", "Apple orchard", "Banana market"])
        self.encoder_factory.assert_not_called()
        np.testing.assert_array_equal(vectors[0], vectors[2])
        self.encode(["Apple orchard", "New headline", "New headline"])
        self.assertEqual([call[0] for call in self.encoder.calls], [["New headline"]])

    def test_revision_change_does_not_reuse_old_vectors(self):
        self.encode(["Apple orchard"])
        with patch.object(semantic_analysis, "MODEL_REVISION", "offline-new-revision"):
            self.encode(["Apple orchard"])
            self.encode(["Apple orchard"])
        self.assertEqual(len(self.encoder.calls), 2)
        with sqlite3.connect(self.cache / "embeddings.sqlite") as db:
            revisions = {row[0] for row in db.execute("SELECT revision FROM embeddings")}
        self.assertEqual(revisions, {semantic_analysis.MODEL_REVISION, "offline-new-revision"})

    def test_invalid_cached_vectors_are_replaced(self):
        for bad_blob in [b"broken", np.zeros(383, dtype=np.float32).tobytes(),
                         np.full(384, np.nan, dtype=np.float32).tobytes()]:
            with self.subTest(blob_bytes=len(bad_blob)):
                self.encode(["Apple orchard"])
                key = hashlib.sha256(b"Apple orchard").hexdigest()
                with sqlite3.connect(self.cache / "embeddings.sqlite") as db:
                    db.execute("UPDATE embeddings SET vector=? WHERE revision=? AND title_hash=?",
                               (bad_blob, semantic_analysis.MODEL_REVISION, key))
                self.encoder.calls.clear()
                result = self.encode(["Apple orchard"])
                self.assertEqual([call[0] for call in self.encoder.calls], [["Apple orchard"]])
                np.testing.assert_array_equal(result[0], self.encoder.vector("Apple orchard"))
                self.encoder_factory.reset_mock()
                np.testing.assert_array_equal(self.encode(["Apple orchard"]), result)
                self.encoder_factory.assert_not_called()

    def test_empty_titles_skip_encoder(self):
        result = self.encode([])
        self.assertEqual(result.shape, (0, 384))
        self.assertEqual(result.dtype, np.float32)
        self.encoder_factory.assert_not_called()

    def test_invalid_encoder_output_is_rejected_without_caching(self):
        for result in [np.zeros((1, 383)), np.full((1, 384), np.inf), np.zeros((2, 384))]:
            with self.subTest(shape=result.shape, finite=np.isfinite(result).all()):
                with patch.object(self.encoder, "encode", return_value=result):
                    with self.assertRaisesRegex(ValueError, "invalid headline features"):
                        self.encode(["Apple orchard"])
                with sqlite3.connect(self.cache / "embeddings.sqlite") as db:
                    self.assertEqual(db.execute("SELECT count(*) FROM embeddings").fetchone()[0], 0)

    def test_transformer_fit_does_not_encode_or_learn_titles(self):
        transformer = semantic_analysis.MeaningTransformer(cache_dir=str(self.cache))
        self.assertIs(transformer.fit(["Apple train"], [0]), transformer)
        self.encoder_factory.assert_not_called()
        result = transformer.transform(pd.Series(["Banana holdout", "Apple train"]))
        np.testing.assert_array_equal(result, np.stack([
            self.encoder.vector("Banana holdout"), self.encoder.vector("Apple train")]))

    def test_semantic_candidate_joblib_roundtrip_with_and_without_metadata(self):
        posts = pd.DataFrame({
            "title": [f"Apple orchard {i}" for i in range(12)] + [f"Banana market {i}" for i in range(12)],
            "domain": ["fruit.example"] * 12 + ["market.example"] * 12,
            "created_utc": list(range(1700000000, 1700000024)),
            "upvoteCount": [10] * 12 + [5010] * 12,
        })
        labels = [0] * 12 + [10] * 12
        heldout = pd.DataFrame({"title": ["Apple future", "Banana future"]})
        for classifier, metadata_weight in [("lr", 0), ("lr", 0.25), ("sgd", 0), ("sgd", 0.25)]:
            with self.subTest(classifier=classifier, metadata_weight=metadata_weight):
                model = semantic_analysis.build_semantic_candidate({
                    "C": 3, "classifier": classifier, "alpha": 0.001, "metadata_weight": metadata_weight})
                model.set_params(features__meaning__cache_dir=str(self.cache))
                model.fit(posts, labels)
                before = model.predict_proba(heldout)
                self.assertEqual(model.predict(heldout).tolist(), [0, 10])
                changed = heldout.assign(upvoteCount=999999, fetchedAt="changed", observation_age_hours=999)
                np.testing.assert_allclose(model.predict_proba(changed), before)
                path = self.cache / f"candidate-{classifier}-{metadata_weight}.joblib"
                joblib.dump(model, path)
                loaded = joblib.load(path)
                self.encoder_factory.reset_mock()
                np.testing.assert_allclose(loaded.predict_proba(heldout), before)
                self.assertEqual(loaded.predict(heldout).tolist(), [0, 10])
                self.encoder_factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
