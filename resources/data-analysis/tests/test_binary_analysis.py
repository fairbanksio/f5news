"""Offline checks for binary boundaries and validation-only model selection."""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, ClassifierMixin

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import binary_analysis as binary


class FixtureClassifier(ClassifierMixin, BaseEstimator):
    fits = []
    predictions = []

    def __init__(self, reverse=False):
        self.reverse = reverse

    def fit(self, posts, target):
        self.classes_ = np.array([1, 0] if self.reverse else [0, 1])
        self.fits.append(posts["partition"].iloc[0])
        return self

    def predict_proba(self, posts):
        self.predictions.append(posts["partition"].iloc[0])
        positive = posts["probability"].to_numpy()
        return np.column_stack([positive, 1 - positive] if self.reverse else [1 - positive, positive])


def posts(name, votes=(999, 1000), probabilities=(0.45, 0.55)):
    return pd.DataFrame({"title": ["Below", "At Boundary"], "upvoteCount": votes,
                         "probability": probabilities, "partition": name})


class BinaryAnalysisTests(unittest.TestCase):
    def setUp(self):
        FixtureClassifier.fits = []
        FixtureClassifier.predictions = []
        self.parts = [posts(name) for name in ("Training", "Validation", "Development", "Test")]

    def run_fixture(self, parts=None, reverse=False):
        with patch.object(binary, "BASE_CANDIDATES", ()):
            return binary.run_binary_experiment(*(parts or self.parts),
                extra_candidates=[("Fixture", FixtureClassifier(reverse=reverse))])

    def test_exact_score_boundary(self):
        self.assertEqual(binary.binary_target(posts("Fixture")).tolist(), [0, 1])

    def test_selection_uses_validation_and_never_fits_test(self):
        model, summary, predictions = self.run_fixture()
        self.assertEqual(summary["threshold"], 0.5)
        self.assertEqual(FixtureClassifier.fits, ["Training", "Development"])
        self.assertEqual(FixtureClassifier.predictions, ["Validation", "Test"])
        self.assertEqual(summary["model_metrics"]["balanced_accuracy"], 1)
        self.assertEqual(predictions["Guessed 1,000+?"].tolist(), ["No", "Yes"])
        json.dumps(summary, allow_nan=False)
        # Reversing test labels cannot change the frozen candidate or threshold.
        changed = self.parts[:-1] + [posts("Test", votes=(1000, 999))]
        _, changed_summary, _ = self.run_fixture(changed)
        self.assertEqual(changed_summary["threshold"], summary["threshold"])
        self.assertEqual(changed_summary["selected_name"], summary["selected_name"])
        self.assertEqual(changed_summary["model_metrics"]["accuracy"], 0)

    def test_probability_class_order(self):
        _, summary, predictions = self.run_fixture(reverse=True)
        self.assertEqual(summary["model_metrics"]["accuracy"], 1)
        self.assertEqual(predictions["Yes Strength"].tolist(), [0.45, 0.55])

    def test_threshold_is_selected_on_validation_before_refit(self):
        parts = self.parts.copy()
        parts[1] = posts("Validation", probabilities=(0.35, 0.45))
        _, summary, predictions = self.run_fixture(parts)
        self.assertEqual(summary["threshold"], 0.4)
        self.assertEqual(predictions["Guessed 1,000+?"].tolist(), ["Yes", "Yes"])

    def test_threshold_boundary_is_inclusive(self):
        parts = self.parts[:-1] + [posts("Test", probabilities=(0.49, 0.5))]
        _, _, predictions = self.run_fixture(parts)
        self.assertEqual(predictions["Guessed 1,000+?"].tolist(), ["No", "Yes"])

    def test_empty_and_single_class_partitions_fail(self):
        for index, name in enumerate(("Training", "Validation", "Development", "Test")):
            for invalid, message in ((self.parts[index].iloc[:0], "empty"),
                                     (posts(name, votes=(999, 1)), "both No and Yes")):
                with self.subTest(partition=name, message=message):
                    FixtureClassifier.fits = []
                    FixtureClassifier.predictions = []
                    parts = self.parts.copy()
                    parts[index] = invalid
                    with self.assertRaisesRegex(ValueError, message):
                        self.run_fixture(parts)
                    self.assertEqual(FixtureClassifier.fits, ["Training"] if name == "Test" else [])
                    self.assertEqual(FixtureClassifier.predictions, ["Validation"] if name == "Test" else [])


if __name__ == "__main__":
    unittest.main()
