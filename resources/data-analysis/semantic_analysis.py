"""Encode headline meaning locally, with a cache that survives new database posts."""
from functools import lru_cache
import hashlib
from pathlib import Path
import sqlite3

import numpy as np

MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
MODEL_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
DIMENSIONS = 384


@lru_cache(maxsize=1)
def _encoder(cache_dir):
    from sentence_transformers import SentenceTransformer
    import torch
    torch.set_num_threads(4)
    kwargs = dict(revision=MODEL_REVISION, cache_folder=str(Path(cache_dir) / "weights"),
                  trust_remote_code=False, model_kwargs={"use_safetensors": True},
                  device="mps" if torch.backends.mps.is_available() else "cpu")
    try:
        return SentenceTransformer(MODEL_ID, local_files_only=True, **kwargs)
    except OSError:
        return SentenceTransformer(MODEL_ID, **kwargs)


def encode_titles(titles, cache_dir=None):
    cache_dir = Path(cache_dir or Path(__file__).resolve().parent / "models/meaning-cache")
    cache_dir.mkdir(parents=True, exist_ok=True)
    titles = list(titles)
    keys = [hashlib.sha256(title.encode("utf-8")).hexdigest() for title in titles]
    vectors = {}
    with sqlite3.connect(cache_dir / "embeddings.sqlite") as db:
        db.execute("CREATE TABLE IF NOT EXISTS embeddings (revision TEXT, title_hash TEXT, vector BLOB, PRIMARY KEY (revision, title_hash))")
        unique_keys = list(dict.fromkeys(keys))
        for offset in range(0, len(unique_keys), 500):
            chunk = unique_keys[offset:offset + 500]
            placeholders = ",".join("?" for _ in chunk)
            rows = db.execute(f"SELECT title_hash, vector FROM embeddings WHERE revision=? AND title_hash IN ({placeholders})", [MODEL_REVISION, *chunk])
            for key, blob in rows:
                if len(blob) != DIMENSIONS * np.dtype(np.float32).itemsize:
                    continue
                vector = np.frombuffer(blob, dtype=np.float32)
                if vector.shape == (DIMENSIONS,) and np.isfinite(vector).all():
                    vectors[key] = vector.copy()
        missing = {key: title for key, title in zip(keys, titles) if key not in vectors}
        if missing:
            print(f"Reading headline meaning for {len(missing):,} new titles...", flush=True)
            encoded = _encoder(str(cache_dir)).encode(list(missing.values()), batch_size=64,
                normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=True)
            encoded = np.asarray(encoded, dtype=np.float32)
            if encoded.shape != (len(missing), DIMENSIONS) or not np.isfinite(encoded).all():
                raise ValueError("The meaning model returned invalid headline features.")
            for key, vector in zip(missing, encoded):
                vectors[key] = vector
                db.execute("INSERT OR REPLACE INTO embeddings VALUES (?, ?, ?)", (MODEL_REVISION, key, vector.tobytes()))
    return np.vstack([vectors[key] for key in keys]) if keys else np.empty((0, DIMENSIONS), dtype=np.float32)


from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LogisticRegression, SGDClassifier
from sklearn.pipeline import FunctionTransformer, Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from analysis_models import model_features


class MeaningTransformer(TransformerMixin, BaseEstimator):
    """Use a fixed pretrained encoder. Fit does not learn from held-out headlines."""
    def __init__(self, cache_dir=None):
        self.cache_dir = cache_dir

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        return encode_titles(X, self.cache_dir)


def build_semantic_candidate(options, seed=123456):
    parts = [("meaning", MeaningTransformer(), "title")]
    weights = None
    weight = options.get("metadata_weight", 0)
    if weight:
        parts.extend([
            ("meta", OneHotEncoder(handle_unknown="infrequent_if_exist", min_frequency=10),
             ["domain", "hour", "day", "is_self", "is_video"]),
            ("stats", StandardScaler(), ["length", "words", "question", "caps"]),
        ])
        weights = {"meta": weight, "stats": weight}
    classifier = (SGDClassifier(loss="log_loss", alpha=options.get("alpha", 0.0001),
                                max_iter=1000, tol=0.001, random_state=seed)
                  if options.get("classifier") == "sgd" else
                  LogisticRegression(C=options.get("C", 3), max_iter=1000, random_state=seed))
    return Pipeline([
        ("inputs", FunctionTransformer(model_features, validate=False)),
        ("features", ColumnTransformer(parts, transformer_weights=weights)),
        ("classifier", classifier),
    ])
