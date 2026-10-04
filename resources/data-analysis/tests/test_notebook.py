"""Exercise notebook cells with local Spark and synthetic data only."""
import contextlib
import io
import json
import os
from itertools import chain
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest

import numpy as np
from pyspark.ml import Pipeline
from pyspark.ml.classification import LogisticRegression
from pyspark.ml.evaluation import MulticlassClassificationEvaluator
from pyspark.ml.feature import CountVectorizer, RegexTokenizer, StopWordsRemover
from pyspark.ml.linalg import Vectors
from pyspark.ml.tuning import CrossValidator, ParamGridBuilder
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, create_map, lit


NOTEBOOK = Path(__file__).resolve().parents[1] / "f5-spark-analysis.ipynb"


class NotebookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["PYSPARK_PYTHON"] = sys.executable
        cls.cells = json.loads(NOTEBOOK.read_text())["cells"]
        cls.spark = (SparkSession.builder.master("local[1]")
                     .appName("NotebookRegressionTests")
                     .config("spark.ui.enabled", "false")
                     .config("spark.sql.shuffle.partitions", "1")
                     .getOrCreate())
        cls.spark.sparkContext.setLogLevel("ERROR")

    @classmethod
    def tearDownClass(cls):
        cls.spark.stop()

    def run_cell(self, starts_with, namespace):
        source = next("".join(c["source"]) for c in self.cells
                      if c["cell_type"] == "code"
                      and "".join(c["source"]).startswith(starts_with))
        with contextlib.redirect_stdout(io.StringIO()):
            exec(compile(source, str(NOTEBOOK), "exec"), namespace)

    def test_training_weights_change_fitted_probabilities(self):
        rows = [(float(label), Vectors.dense([1.0]))
                for label, count in [(0, 6), (1, 3), (2, 1)]
                for _ in range(count)]
        training = self.spark.createDataFrame(rows, ["bucket", "features"])
        namespace = dict(trainingData=training, DEBUG=False, np=np,
                         create_map=create_map, lit=lit, col=col, chain=chain,
                         RegexTokenizer=RegexTokenizer,
                         StopWordsRemover=StopWordsRemover,
                         CountVectorizer=CountVectorizer,
                         LogisticRegression=LogisticRegression)
        self.run_cell("trainingData.groupBy", namespace)
        weighted = namespace["trainingData"]
        totals = weighted.groupBy("bucket").sum("weight").collect()
        for row in totals:
            self.assertAlmostEqual(row["sum(weight)"], 10 / 3)
        self.assertNotIn("weight", training.columns)
        self.run_cell("# Tokenizer", namespace)
        lr = namespace["lr"]
        self.assertEqual(lr.getWeightCol(), "weight")
        weighted_model = lr.fit(weighted)
        unweighted_model = lr.copy({lr.weightCol: ""}).fit(training)
        # Inference needs features only, never training labels or weights.
        inference = self.spark.createDataFrame([(Vectors.dense([1.0]),)], ["features"])
        weighted_probs = weighted_model.transform(inference).first().probability
        unweighted_probs = unweighted_model.transform(inference).first().probability
        np.testing.assert_allclose(weighted_probs, [1 / 3] * 3, atol=0.01)
        np.testing.assert_allclose(unweighted_probs, [0.6, 0.3, 0.1], atol=0.01)

    def test_reports_accuracy_and_keeps_f1_for_model_selection(self):
        predictions = self.spark.createDataFrame(
            [(0.0, 0.0), (0.0, 0.0), (0.0, 0.0), (1.0, 0.0)],
            ["bucket", "prediction"])
        logged = {}
        namespace = dict(model=SimpleNamespace(transform=lambda _: predictions),
                         testData=predictions, DEBUG=False,
                         mlflow=SimpleNamespace(log_metric=lambda k, v: logged.update({k: v})),
                         MulticlassClassificationEvaluator=MulticlassClassificationEvaluator)
        self.run_cell("# Make Predictions for entire", namespace)
        self.assertAlmostEqual(logged["lr_accuracy"], 0.75)
        f1 = MulticlassClassificationEvaluator(labelCol="bucket", metricName="f1")
        self.assertNotAlmostEqual(logged["lr_accuracy"], f1.evaluate(predictions))
        namespace.update(RegexTokenizer=RegexTokenizer, StopWordsRemover=StopWordsRemover,
                         CountVectorizer=CountVectorizer, LogisticRegression=LogisticRegression,
                         Pipeline=Pipeline, ParamGridBuilder=ParamGridBuilder,
                         CrossValidator=CrossValidator)
        self.run_cell("# Tokenizer", namespace)
        self.run_cell("pipeline = Pipeline", namespace)
        self.run_cell("# Create ParamGrid", namespace)
        self.assertEqual(namespace["cvPipeline"].getEvaluator().getMetricName(), "f1")

    def test_confidence_tracks_each_predicted_bucket(self):
        rows = []
        for bucket in range(6):
            probabilities = [0.02] * 6
            probabilities[bucket] = 0.9
            rows.append((f"Title {bucket}", float(bucket), Vectors.dense(probabilities)))
        predictions = self.spark.createDataFrame(rows, ["title", "prediction", "probability"])
        namespace = dict(predictions=predictions)
        self.run_cell("# Access individual rows", namespace)
        self.assertEqual(namespace["formatted_scores"], ["90.00%"] * 6)

    def test_notebook_syntax_and_split_before_weighting(self):
        sources = ["".join(c["source"]) for c in self.cells if c["cell_type"] == "code"]
        for source in sources:
            if not source.startswith("%"):
                compile(source, str(NOTEBOOK), "exec")
        split = next(i for i, s in enumerate(sources) if "df.randomSplit" in s)
        weights = next(i for i, s in enumerate(sources) if s.startswith("trainingData.groupBy"))
        self.assertLess(split, weights)


if __name__ == "__main__":
    unittest.main()
