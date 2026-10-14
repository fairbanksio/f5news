"""Exercise time boundaries and bounded similarity work without model downloads."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import story_experiments as stories


def sample(hours):
    return pd.DataFrame({
        "title": [f"Headline {index}" for index in range(len(hours))],
        "sub": "news", "domain": [f"source{index % 3}" for index in range(len(hours))],
        "url": "https://example.com", "upvoteCount": np.arange(len(hours)) + 10,
        "commentCount": 0,
        "created_at": pd.Timestamp("2026-01-01", tz="UTC") + pd.to_timedelta(hours, unit="h"),
        "fetched_at": pd.Timestamp("2026-02-01", tz="UTC"), "observation_age_hours": 24,
    })


def features(count):
    result = np.zeros((count, 384), dtype=np.float32)
    result[np.arange(count), np.arange(count) % 2] = 1
    return result


class StoryExperimentsTests(unittest.TestCase):
    def test_group_requires_all_pairs_and_48_hour_span(self):
        posts = sample([0, 1, 2, 60])
        vectors = features(4)
        # A-B and B-C match, while A-C must stay separate.
        for index, angle in enumerate([0, 30, 60, 60]):
            vectors[index, :2] = [np.cos(np.deg2rad(angle)), np.sin(np.deg2rad(angle))]
        result = stories.group_same_story(posts, vectors)
        self.assertEqual(result["metrics"]["proposed_groups"], 1)
        self.assertEqual(len(result["tables"][0]["rows"]), 2)
        self.assertEqual(result["metrics"]["verified_groups"], 0)

    def test_neighbors_are_older_and_deduplicate_titles(self):
        posts = sample([0, 1, 2, 25, 26, 27])
        posts.loc[1, "title"] = posts.loc[0, "title"]
        result = stories.find_similar_stories(posts, features(6))
        for table in result["tables"]:
            rows = table["rows"]
            self.assertTrue(all(row["Hours Older"] >= 24 for row in rows))
            self.assertTrue(all(0 <= row["Headline Match (%)"] <= 100 for row in rows))
            titles = [row["Headline"] for row in rows]
            self.assertEqual(len(titles), len(set(titles)))
        self.assertGreater(result["metrics"]["matches"], 0)

    def test_topics_fit_only_past_history(self):
        posts = sample(np.linspace(0, 24 * 21, 120))
        vectors = features(120)
        vectors[-20:, 2] = .5
        with patch.object(stories.MiniBatchKMeans, "fit", autospec=True, return_value=None) as fit, \
             patch.object(stories.MiniBatchKMeans, "predict", return_value=np.arange(120) % 2):
            stories._topics(posts, vectors, 123456)
        training = fit.call_args.args[1]
        expected = posts.index[posts.created_at <= posts.created_at.max() - pd.Timedelta(days=7)]
        np.testing.assert_array_equal(training, vectors[expected])

    def test_topic_change_uses_share_when_collection_counts_differ(self):
        posts = sample([0] + list(np.linspace(24, 24 * 7, 20)) + list(np.linspace(24 * 7 + 1, 24 * 14, 40)))
        labels = np.array([0] + [0] * 10 + [1] * 10 + [0] * 20 + [1] * 20)
        result = stories.spot_growing_topics(posts, features(61), labels, {0: "Apple", 1: "Banana"}, 21)
        self.assertEqual(result["status"], "complete")
        for row in result["tables"][0]["rows"]:
            self.assertEqual(row["Change (Percentage Points)"], 0)

    def test_large_sample_keeps_pairwise_work_bounded(self):
        posts = sample(np.linspace(0, 24 * 2 - .1, 50000))
        vectors = features(50000)
        groups = stories.group_same_story(posts, vectors)
        feed = stories.build_balanced_feed(posts, vectors, None, {})
        self.assertEqual(groups["metrics"]["candidates"], 2000)
        self.assertEqual(feed["metrics"]["scored_candidates"], 200)
        self.assertEqual(feed["metrics"]["baseline"]["stories"], 10)
        self.assertIsNone(feed["metrics"]["baseline"]["distinct_topics"])

    def test_feed_can_trade_votes_for_variety(self):
        posts = sample(list(range(20)))
        posts["upvoteCount"] = [99] * 10 + [100] * 10
        vectors = features(20)
        vectors[10:] = 0
        vectors[10:, 0] = 1
        vectors[:10] = 0
        vectors[np.arange(10), np.arange(10) + 1] = 1
        result = stories.build_balanced_feed(posts, vectors, None, {})
        baseline = result["metrics"]["baseline"]["average_pairwise_similarity"]
        balanced = result["metrics"]["balanced"]["average_pairwise_similarity"]
        self.assertLess(balanced, baseline)

    def test_neighbors_prefer_same_subreddit_when_available(self):
        posts = sample([0, 1, 2, 3, 30, 31, 32])
        posts.loc[3, "sub"] = "other"
        vectors = features(7)
        result = stories.find_similar_stories(posts, vectors)
        self.assertTrue(all(row["Subreddit"] == "news"
                            for table in result["tables"] for row in table["rows"]))

    def test_empty_and_bad_order_have_explicit_outcomes(self):
        results = stories.run_story_experiments(sample([]), features(0))
        self.assertEqual(len(results), 4)
        self.assertTrue(all(result["status"] == "insufficient_data" for result in results))
        with self.assertRaisesRegex(ValueError, "sorted"):
            stories.run_story_experiments(sample([1, 0]), features(2))

    def test_sparse_history_still_runs_other_experiments(self):
        results = stories.run_story_experiments(sample([0, 30, 31]), features(3))
        self.assertEqual(results[1]["status"], "insufficient_data")
        self.assertEqual(results[2]["status"], "complete")
        self.assertEqual(results[3]["status"], "complete")
        self.assertTrue(all(len(result["summary"].split()) <= 45 for result in results))
        self.assertIn("latest saved post", results[0]["summary"])
        self.assertIn("latest saved post", results[3]["summary"])


if __name__ == "__main__":
    unittest.main()
