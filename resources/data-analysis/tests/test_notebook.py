"""Exercise the local notebook with synthetic records and a fake Mongo client."""
import contextlib
import io
import json
import os
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch


NOTEBOOK = Path(__file__).resolve().parents[1] / "f5-spark-analysis.ipynb"
BUCKET_LABELS = ["0–499", "500–999", "1,000–4,999", "5,000–9,999", "10,000–24,999", "25,000–49,999", "50,000+"]


class NotebookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cells = json.loads(NOTEBOOK.read_text())["cells"]
        cls.cache = tempfile.TemporaryDirectory()
        cls.environment = patch.dict(os.environ, {"MPLCONFIGDIR": cls.cache.name, "XDG_CACHE_HOME": cls.cache.name})
        cls.environment.start()

    @classmethod
    def tearDownClass(cls):
        cls.environment.stop()
        cls.cache.cleanup()

    def setUp(self):
        self.ns = {"BUCKET_LABELS": BUCKET_LABELS, "BUCKET_EDGES": [500, 1000, 5000, 10000, 25000, 50000]}
        self.run_tag("imports")
        self.ns["plt"].switch_backend("Agg")
        self.run_tag("definitions")

    def run_tag(self, tag):
        cells = [c for c in self.cells if tag in c.get("metadata", {}).get("tags", [])]
        self.assertEqual(len(cells), 1, f"Expected one {tag} cell")
        with contextlib.redirect_stdout(io.StringIO()):
            exec(compile("".join(cells[0]["source"]), str(NOTEBOOK), "exec"), self.ns)

    def record(self, title="Sample article", votes=10, created=1700000000, **changes):
        record = {"title": title, "upvoteCount": votes, "created_utc": created,
                  "fetchedAt": self.ns["pd"].Timestamp(created + 7200, unit="s", tz="UTC"),
                  "sub": "politics"}
        record.update(changes)
        return record

    def test_exact_bucket_boundaries(self):
        values = [0, 499, 500, 999, 1000, 4999, 5000, 9999, 10000, 24999, 25000, 49999, 50000, 100000]
        records = [self.record(f"Article {i}", value, 1700000000 + i) for i, value in enumerate(values)]
        df, summary = self.ns["prepare_posts"](records)
        self.assertEqual(df["bucket"].tolist(), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6])
        self.assertEqual(summary, {"loaded": 14, "excluded": 0, "duplicate_titles": 0, "usable": 14})

    def test_invalid_records_and_latest_title_dedup(self):
        records = [self.record("  Shared   TITLE  ", 10),
                   self.record("shared title", 5000, fetchedAt=self.ns["pd"].Timestamp(1700010800, unit="s", tz="UTC"))]
        records += [self.record(title=value) for value in [None, " ", 42]]
        records += [self.record(f"Bad votes {i}", votes=value)
                    for i, value in enumerate([None, "bad", -1, float("nan"), float("inf"), True])]
        records += [self.record("Bad created", created_utc="bad"),
                    self.record("Bad fetched", fetchedAt="bad"),
                    self.record("Negative age", fetchedAt=self.ns["pd"].Timestamp(1699999999, unit="s", tz="UTC"))]
        df, summary = self.ns["prepare_posts"](records)
        self.assertEqual(summary, {"loaded": 14, "excluded": 12, "duplicate_titles": 1, "usable": 1})
        self.assertEqual(df.iloc[0]["title"], "shared title")
        self.assertEqual(df.iloc[0]["bucket"], 3)
        self.assertEqual(str(df["created_at"].dt.tz), "UTC")
        self.assertEqual(df.iloc[0]["observation_age_hours"], 3)

    def test_observation_age_filter_and_empty_input(self):
        records = [self.record("Younger", fetchedAt=self.ns["pd"].Timestamp(1700003600, unit="s", tz="UTC")),
                   self.record("Older")]
        df, _ = self.ns["prepare_posts"](records, minimum_age_hours=2)
        self.assertEqual(df["title"].tolist(), ["Older"])
        df, summary = self.ns["prepare_posts"]([])
        self.assertTrue(df.empty)
        self.assertEqual(summary["usable"], 0)
        df, summary = self.ns["prepare_posts"]([self.record(title=" ")])
        self.assertTrue(df.empty)
        self.assertEqual(summary["excluded"], 1)
        for age in [-1, float("inf"), float("nan")]:
            with self.subTest(age=age), self.assertRaises(ValueError):
                self.ns["prepare_posts"]([], minimum_age_hours=age)

    def test_chronological_split_keeps_creation_time_ties_together(self):
        times = list(range(7)) + [7, 7, 7, 8, 9]
        records = [self.record(f"Article {i}", 10 if i % 2 else 2000, 1700000000 + time)
                   for i, time in enumerate(times)]
        df, _ = self.ns["prepare_posts"](records)
        train, test = self.ns["temporal_split"](df.sample(frac=1, random_state=1), 0.3)
        self.assertEqual(len(train), 7)
        self.assertEqual(len(test), 5)
        self.assertLess(train["created_at"].max(), test["created_at"].min())
        self.assertFalse(set(train["title_key"]) & set(test["title_key"]))

    def test_invalid_split_and_one_class_fail_clearly(self):
        df, _ = self.ns["prepare_posts"]([self.record(f"Article {i}", created=1700000000 + i) for i in range(10)])
        for fraction in [0, 1, -0.1, float("nan")]:
            with self.subTest(fraction=fraction), self.assertRaises(ValueError):
                self.ns["temporal_split"](df, fraction)
        with self.assertRaisesRegex(ValueError, "two buckets"):
            self.ns["temporal_split"](df)
        with self.assertRaisesRegex(ValueError, "at least 10"):
            self.ns["temporal_split"](df.head(9))
        df["created_at"] = df.iloc[0]["created_at"]
        with self.assertRaisesRegex(ValueError, "distinct creation times"):
            self.ns["temporal_split"](df)

    def test_actual_training_uses_train_only_vocabulary_and_balanced_classes(self):
        pd = self.ns["pd"]
        self.ns.update(train=pd.DataFrame({"title": ["apple orchard"] * 6 + ["banana market"] * 2,
                                           "bucket": [0] * 6 + [2] * 2}), RANDOM_SEED=123456)
        model = self.ns["build_model"]().fit(self.ns["train"]["title"], self.ns["train"]["bucket"])
        self.assertEqual(model.named_steps["classifier"].class_weight, "balanced")
        self.assertEqual(model.classes_.tolist(), [0, 2])
        before = dict(model.named_steps["tfidf"].vocabulary_)
        model.predict(["holdoutonly vocabulary"])
        self.assertEqual(model.named_steps["tfidf"].vocabulary_, before)
        self.assertNotIn("holdoutonly", before)
        balanced = self.ns["build_model"]().fit(["shared headline"] * 8, [0] * 6 + [2] * 2)
        self.ns["np"].testing.assert_allclose(balanced.predict_proba(["shared headline"]), [[0.5, 0.5]], atol=0.01)
        baseline = self.ns["DummyClassifier"](strategy="most_frequent").fit(self.ns["train"]["title"], self.ns["train"]["bucket"])
        self.assertEqual(baseline.predict(["banana market"]).tolist(), [0])

    def test_selection_uses_validation_and_refit_preserves_test_vocabulary(self):
        pd = self.ns["pd"]
        train = pd.DataFrame({"title": ["apple orchard"] * 6 + ["banana market"] * 4, "bucket": [0] * 6 + [2] * 4})
        validation = pd.DataFrame({"title": ["apple validationonly", "banana validationonly"], "bucket": [0, 2]})
        model, options, scores = self.ns["select_model"](train, validation)
        self.assertEqual(len(scores), 5)
        self.assertAlmostEqual(scores["weighted_f1"].max(), self.ns["evaluate_predictions"](
            validation["bucket"], model.predict(validation))["weighted_f1"])
        for value in model.get_params(deep=True).values():
            if hasattr(value, "vocabulary_"):
                self.assertNotIn("validationonly", value.vocabulary_)
        self.ns.update(train=train, validation=validation, development=pd.concat([train, validation]), RANDOM_SEED=123456)
        self.run_tag("train")
        fitted = self.ns["model"]
        vectorizers = [value for value in fitted.get_params(deep=True).values() if hasattr(value, "vocabulary_")]
        before = [dict(value.vocabulary_) for value in vectorizers]
        fitted.predict(pd.DataFrame({"title": ["testonly future title"]}))
        self.assertEqual(before, [value.vocabulary_ for value in vectorizers])
        for vocabulary in before:
            self.assertNotIn("testonly", vocabulary)

    def test_confidence_maps_probability_columns_to_present_classes(self):
        np = self.ns["np"]
        class FakeModel:
            classes_ = np.array([0, 2, 5])
            def predict_proba(self, titles):
                return np.array([[0.1, 0.2, 0.7], [0.1, 0.8, 0.1]])
        predictions = self.ns["predict_titles"](FakeModel(), ["First", "Second"])
        self.assertEqual(predictions["Bucket"].tolist(), [5, 2])
        self.assertEqual(predictions["Upvote Range"].tolist(), [BUCKET_LABELS[5], BUCKET_LABELS[2]])
        np.testing.assert_allclose(predictions["Confidence"], [0.7, 0.8])

    def test_metrics_distinguish_accuracy_f1_and_majority_baseline(self):
        actual = [0, 0, 0, 2]
        baseline = self.ns["DummyClassifier"](strategy="most_frequent").fit(["a"] * 4, actual)
        metrics = self.ns["evaluate_predictions"](actual, baseline.predict(["b"] * 4))
        self.assertAlmostEqual(metrics["accuracy"], 0.75)
        self.assertAlmostEqual(metrics["weighted_f1"], 9 / 14)
        self.assertAlmostEqual(metrics["macro_f1"], 6 / 49)
        self.assertNotEqual(metrics["accuracy"], metrics["weighted_f1"])

    def test_joblib_roundtrip_preserves_predictions(self):
        model = self.ns["build_model"]().fit(["apple orchard", "apple fruit", "banana market", "banana yellow"], [0, 0, 5, 5])
        titles = ["apple orchard", "banana market", "new headline"]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.joblib"
            self.ns["joblib"].dump(model, path)
            loaded = self.ns["joblib"].load(path)
            self.ns["np"].testing.assert_allclose(model.predict_proba(titles), loaded.predict_proba(titles))
            self.ns["pd"].testing.assert_frame_equal(self.ns["predict_titles"](model, titles), self.ns["predict_titles"](loaded, titles))

    def test_posting_features_exclude_scores_fetch_times_and_unknown_values(self):
        pd = self.ns["pd"]
        posts = pd.DataFrame([self.record("Apple orchard?", domain="EXAMPLE.COM", is_self=False),
                              self.record("Banana market", created=1700003600)])
        features = self.ns["model_features"](posts)
        self.assertEqual(features.iloc[0]["domain"], "example.com")
        self.assertEqual(features.iloc[1]["domain"], "unknown")
        self.assertNotIn("upvoteCount", features)
        self.assertNotIn("fetchedAt", features)
        changed = posts.assign(upvoteCount=999999, fetchedAt="changed", observation_age_hours=10000)
        pd.testing.assert_frame_equal(features, self.ns["model_features"](changed))
        unknown = self.ns["model_features"](pd.DataFrame({"title": ["", "New headline"]}))
        self.assertEqual(unknown["hour"].tolist(), ["unknown", "unknown"])
        self.assertTrue(self.ns["np"].isfinite(unknown["caps"]).all())

    def test_richer_model_roundtrip_and_real_post_examples(self):
        pd = self.ns["pd"]
        posts = pd.DataFrame([self.record(f"Apple orchard {i}", domain="fruit.example") for i in range(6)] +
                             [self.record(f"Banana market {i}", votes=2000, domain="market.example") for i in range(6)])
        posts["bucket"] = [0] * 6 + [2] * 6
        model = self.ns["build_candidate"]({"kind": "context_char", "C": 1, "metadata_weight": 0.25}).fit(posts, posts["bucket"])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "richer-model.joblib"
            self.ns["joblib"].dump(model, path)
            loaded = self.ns["joblib"].load(path)
            self.ns["np"].testing.assert_allclose(model.predict_proba(posts), loaded.predict_proba(posts))
            guesses = self.ns["predict_posts"](loaded, posts.head(2))
            self.assertEqual(guesses["Actual Range"].tolist(), [BUCKET_LABELS[0]] * 2)
            changed = posts.assign(upvoteCount=100000, fetchedAt="bad")
            self.ns["np"].testing.assert_allclose(loaded.predict_proba(posts), loaded.predict_proba(changed))

    def test_mongo_read_is_bounded_projected_and_client_closes(self):
        calls = []
        records = [self.record()]
        class FakeClient:
            def __init__(self, uri, **kwargs):
                calls.append(("connect", uri, kwargs))
            def __enter__(self):
                return self
            def __exit__(self, *args):
                calls.append(("close",))
            def __getitem__(self, key):
                calls.append(("select", key))
                return self
            def find(self, query, projection):
                calls.append(("find", query, projection))
                return self
            def sort(self, key, direction):
                calls.append(("sort", key, direction))
                return self
            def limit(self, limit):
                calls.append(("limit", limit))
                return self
            def max_time_ms(self, timeout):
                calls.append(("timeout", timeout))
                return self
            def __iter__(self):
                return iter(records)
        config = {"mongo_uri": "mongodb://offline.invalid", "database": "fixture", "collection": "newposts"}
        with patch.dict(self.ns, {"MongoClient": FakeClient}):
            self.assertEqual(self.ns["load_posts"](config, 25, "politics"), records)
        self.assertEqual(calls[1:3], [("select", "fixture"), ("select", "newposts")])
        self.assertEqual(calls[3], ("find", {"sub": "politics"}, {"_id": 0, "title": 1, "upvoteCount": 1, "created_utc": 1, "fetchedAt": 1, "sub": 1, "domain": 1, "is_self": 1, "is_video": 1}))
        self.assertEqual(calls[4:], [("sort", "_id", -1), ("limit", 25), ("timeout", 20000), ("close",)])
        self.assertEqual(calls[0][2]["serverSelectionTimeoutMS"], 10000)
        for limit in [0, 100001, True, 2.5]:
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                self.ns["load_posts"](config, limit)
        with self.assertRaises(ValueError):
            self.ns["load_posts"]({}, 25)

    def test_mongo_failure_does_not_display_driver_details(self):
        def failing_client(*args, **kwargs):
            raise RuntimeError("mongodb://private-user:fixture-password@offline.invalid")
        with patch.dict(self.ns, {"MongoClient": failing_client}):
            with self.assertRaisesRegex(RuntimeError, "MongoDB read failed") as caught:
                self.ns["load_posts"]({"mongo_uri": "offline", "database": "fixture", "collection": "newposts"}, 25)
        self.assertNotIn("fixture-password", str(caught.exception))
        self.assertTrue(caught.exception.__suppress_context__)

    def test_vault_reads_kv2_config_with_token_and_custom_path(self):
        expected = {"mongo_uri": "mongodb://offline.invalid", "database": "fixture", "collection": "newposts"}
        calls = []
        responses = []
        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            response = io.BytesIO(json.dumps({"data": {"data": {**expected, "unrelated": "ignored"}}}).encode())
            responses.append(response)
            return response
        settings = {"VAULT_ADDR": "https://vault.invalid/", "VAULT_TOKEN": "fixture-token",
                    "VAULT_KV_MOUNT": "custom mount", "VAULT_SECRET_PATH": "/folder/f5.news/"}
        with patch.dict(self.ns, {"urlopen": fake_urlopen}):
            actual = self.ns["load_database_config"](settings)
        self.assertEqual(actual, expected)
        request, timeout = calls[0]
        self.assertEqual(request.full_url, "https://vault.invalid/v1/custom%20mount/data/folder/f5.news")
        self.assertEqual(request.get_header("X-vault-token"), "fixture-token")
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(timeout, 10)
        self.assertTrue(responses[0].closed)

    def test_vault_defaults_and_environment_credentials(self):
        calls = []
        expected = {"mongo_uri": "mongodb://offline.invalid", "database": "fixture", "collection": "newposts"}
        def fake_urlopen(request, timeout):
            calls.append(request)
            return io.BytesIO(json.dumps({"data": {"data": expected}}).encode())
        with patch.dict(os.environ, {"VAULT_ADDR": "https://vault.invalid", "VAULT_TOKEN": "fixture-token"}, clear=True):
            with patch.dict(self.ns, {"urlopen": fake_urlopen}):
                actual = self.ns["load_database_config"]({})
        self.assertEqual(actual, expected)
        self.assertEqual(calls[0].full_url, "https://vault.invalid/v1/kv/data/f5.news")

    def test_vault_missing_database_keys_fail_without_env_fallback(self):
        settings = {"VAULT_ADDR": "https://vault.invalid", "VAULT_TOKEN": "fixture-token",
                    "mongo_uri": "mongodb://offline.invalid", "database": "fixture", "collection": "newposts"}
        for values in [None, [], ["fixture-secret"], {}, {"mongo_uri": "fixture-secret", "database": "fixture"},
                       {"mongo_uri": "fixture-secret", "database": "fixture", "collection": " "}]:
            with self.subTest(values=values):
                def fake_urlopen(request, timeout):
                    return io.BytesIO(json.dumps({"data": {"data": values}}).encode())
                with patch.dict(self.ns, {"urlopen": fake_urlopen}):
                    with self.assertRaisesRegex(ValueError, "must contain") as caught:
                        self.ns["load_database_config"](settings)
                self.assertNotIn("fixture-secret", str(caught.exception))

    def test_vault_token_and_server_failures_hide_details(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "VAULT_ADDR and VAULT_TOKEN"):
                self.ns["load_database_config"]({"VAULT_ADDR": "https://vault.invalid"})
        def failing_urlopen(*args, **kwargs):
            raise RuntimeError("fixture-token: secret backend details")
        settings = {"VAULT_ADDR": "https://vault.invalid", "VAULT_TOKEN": "fixture-token"}
        with patch.dict(self.ns, {"urlopen": failing_urlopen}):
            with self.assertRaisesRegex(RuntimeError, "Vault read failed") as caught:
                self.ns["load_database_config"](settings)
        self.assertNotIn("fixture-token", str(caught.exception))
        self.assertNotIn("secret backend details", str(caught.exception))
        self.assertTrue(caught.exception.__suppress_context__)

    def test_explicit_env_config_skips_vault_and_rejects_unknown_source(self):
        expected = {"mongo_uri": "mongodb://offline.invalid", "database": "fixture", "collection": "newposts"}
        def forbidden_urlopen(*args, **kwargs):
            self.fail("Environment credentials must not access Vault")
        with patch.dict(self.ns, {"urlopen": forbidden_urlopen}):
            self.assertEqual(self.ns["load_database_config"]({**expected, "unrelated": "ignored"}, "env"), expected)
        with self.assertRaisesRegex(ValueError, "vault or env"):
            self.ns["load_database_config"](expected, "unknown")
        for values in [{}, {**expected, "database": None}, {**expected, "collection": 5}]:
            with self.subTest(values=values), self.assertRaisesRegex(ValueError, "must contain"):
                self.ns["load_database_config"](values, "env")

    def test_all_code_cells_compile_and_notebook_outputs_are_clear(self):
        for cell in self.cells:
            if cell["cell_type"] == "code":
                compile("".join(cell["source"]), str(NOTEBOOK), "exec")
                self.assertEqual(cell.get("outputs", []), [])
                self.assertIsNone(cell.get("execution_count"))


if __name__ == "__main__":
    unittest.main()
