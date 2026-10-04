"""Exercise chronology, missing labels, comparison scope, and offline fitting."""
import sys
from pathlib import Path
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import engagement_experiments as experiments


def posts(count=400):
    return pd.DataFrame({
        "title": [f"Story number {i}: {'discussion' if i % 2 else 'quiet'}" for i in range(count)],
        "sub": ["news"] * count,
        "domain": ["example.com"] * count,
        "upvoteCount": [1500 if i % 2 else 500 for i in range(count)],
        "commentCount": [150 if i % 2 else 50 for i in range(count)],
        "created_at": pd.date_range("2026-01-01", periods=count, freq="h", tz="UTC"),
        "fetched_at": pd.date_range("2026-01-02", periods=count, freq="h", tz="UTC"),
        "observation_age_hours": [24] * count,
    })


class EngagementTests(unittest.TestCase):
    def test_empty_and_missing_labels_fail_cleanly(self):
        for data in [pd.DataFrame(), posts().assign(commentCount=np.nan)]:
            result = experiments.run_engagement_experiments(data)
            self.assertEqual(len(result), 3)
            self.assertEqual(result[0]["status"], "insufficient_data")
            self.assertEqual(result[0]["metrics"]["eligible_posts"], 0)

    def test_timestamps_and_repeated_headlines_do_not_cross_splits(self):
        data = posts()
        data.loc[399, "title"] = " STORY NUMBER 0: quiet "
        data["created_at"] = data["created_at"].dt.floor("6h")
        clean = experiments._dated_unique(data)
        self.assertEqual(len(clean), 399)
        split = experiments._chronological_parts(clean)
        for older, newer in zip(split, split[1:]):
            self.assertLess(older.created_at.max(), newer.created_at.min())
            self.assertFalse(set(older._headline) & set(newer._headline))

    def test_model_receives_only_creation_clues_and_refits_before_test(self):
        fits, predictions = [], []

        class FakeModel:
            def fit(self, data, labels):
                fits.append((data.copy(), labels.copy()))
                return self

            def predict(self, data):
                predictions.append(data.copy())
                return np.arange(len(data)) % 2

        data = posts().assign(upvote_ratio=.9)
        data.loc[0, "commentCount"] = np.nan
        with patch.object(experiments, "build_candidate", side_effect=lambda *args, **kwargs: FakeModel()):
            result = experiments.run_engagement_experiments(data)[0]
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["metrics"]["eligible_posts"], 399)
        self.assertEqual(len(fits), 4)
        forbidden = {"upvoteCount", "commentCount", "upvote_ratio", "fetched_at", "observation_age_hours"}
        for frame, labels in fits:
            self.assertFalse(forbidden & set(frame.columns))
            self.assertTrue(labels.notna().all())
        self.assertLess(fits[-1][0].created_at.max(), predictions[-1].created_at.min())
        self.assertEqual(result["metrics"]["test_posts"], len(predictions[-1]))
        self.assertEqual(result["metrics"]["target_comments"], 100)

    def test_real_models_fit_without_downloads(self):
        result = experiments.run_engagement_experiments(posts())[0]
        self.assertEqual(result["status"], "complete")
        self.assertEqual(len(result["metrics"]["validation_trials"]), 3)
        self.assertGreaterEqual(result["metrics"]["model"]["balanced_accuracy"], 0)

    def test_age_window_and_largest_subreddit_apply_to_comparisons(self):
        main = posts().assign(observation_age_hours=24)
        main.loc[350:, "observation_age_hours"] = 200
        small = posts(100).assign(sub="other", domain="other.com", upvoteCount=999999)
        result = experiments.run_engagement_experiments(pd.concat([main, small], ignore_index=True))
        publisher = result[1]
        self.assertEqual(publisher["metrics"]["compared_posts"], 350)
        self.assertEqual(publisher["tables"][0]["rows"][0]["Website"], "example.com")
        self.assertIn("12–48", publisher["summary"])
        self.assertEqual(result[2]["metrics"]["compared_posts"], 350)

    def test_publishers_ignore_missing_counts_and_require_thirty_posts(self):
        data = posts(60)
        data.loc[:9, "upvoteCount"] = np.nan
        data.loc[:19, "commentCount"] = np.nan
        data.loc[50:, "domain"] = "small.com"
        result = experiments.run_engagement_experiments(data)[1]
        self.assertIn("mixed or unknown", result["summary"])
        rows = result["tables"][0]["rows"]
        self.assertEqual(len(rows), 1)
        coverage = result["metrics"]["count_coverage"]["example.com"]
        self.assertEqual(coverage["known_votes"], 40)
        self.assertEqual(coverage["known_comments"], 30)
        self.assertEqual(rows[0]["1,000+ Votes (%)"], 50)

    def test_visible_summaries_are_brief_and_scores_are_percentages(self):
        result = experiments.run_engagement_experiments(posts())
        for section in result:
            self.assertLessEqual(len(section["summary"].split()), 45)
            self.assertNotRegex(section["summary"].lower(), r"precision|recall|regularization|validation")
        discussion = result[0]
        self.assertEqual(len(discussion["tables"]), 1)
        self.assertEqual([row["Model"] for row in discussion["tables"][0]["rows"]],
                         ["Computer Guess", "Always Guess the Common Answer"])
        row = discussion["tables"][0]["rows"][0]
        self.assertEqual(row["Correct Guesses (%)"], discussion["metrics"]["model"]["accuracy"] * 100)

    def test_pacific_time_handles_daylight_saving(self):
        data = posts(60)
        data["created_at"] = ([pd.Timestamp("2026-01-05 07:30Z")] * 30 +
                              [pd.Timestamp("2026-07-06 07:30Z")] * 30)
        result = experiments.run_engagement_experiments(data)[2]
        days = result["tables"][0]["rows"]
        self.assertEqual({row["Day Of Week"] for row in days}, {"Sunday", "Monday"})
        blocks = result["tables"][1]["rows"]
        self.assertEqual({row["Four-Hour Block"] for row in blocks}, {"8:00 PM–11:59 PM", "12:00 AM–3:59 AM"})


if __name__ == "__main__":
    unittest.main()
