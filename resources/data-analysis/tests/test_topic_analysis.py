"""Check fixed topic discovery, collection controls, and sparse comparisons."""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import topic_analysis as topics


class FixedModel:
    def __init__(self, **kwargs):
        self.cluster_centers_ = np.eye(2, 384, dtype=np.float32)
        self.training = None

    def fit(self, vectors):
        self.training = vectors.copy()
        return self

    def predict(self, vectors):
        return vectors[:, :2].argmax(axis=1)


def sample(groups):
    rows, vectors = [], []
    for date, sub, topic, count in groups:
        for _ in range(count):
            index = len(rows)
            rows.append({'title': f'{"Space Rocket" if topic == 0 else "City Election"} Article {index}',
                         'sub': sub, 'created_at': date, 'domain': 'example.com',
                         'url': 'https://example.com/story', 'upvoteCount': 10 + topic,
                         'commentCount': 5, 'observation_age_hours': 24, 'upvote_ratio': .9})
            vector = np.zeros(384, dtype=np.float32)
            vector[topic] = 1
            vectors.append(vector)
    return pd.DataFrame(rows), np.asarray(vectors).reshape(-1, 384)


def analyze(groups):
    posts, vectors = sample(groups)
    model = FixedModel()
    with patch.object(topics, 'MiniBatchKMeans', return_value=model):
        result = topics.analyze_topics(posts, vectors, topic_count=2)
    return result, posts, vectors, model


class TopicAnalysisTests(unittest.TestCase):
    def test_fit_excludes_current_window_and_boundary(self):
        result, posts, vectors, model = analyze([
            ('2026-01-01', 'news', 0, 1), ('2026-01-12', 'news', 1, 1),
            ('2026-01-13', 'news', 0, 1), ('2026-01-20', 'news', 1, 1)])
        np.testing.assert_array_equal(model.training, vectors[:2])
        self.assertEqual(result['periods']['current']['count'], 2)
        self.assertEqual(result['periods']['previous']['count'], 1)
        json.dumps(result, allow_nan=False)

    def test_emerging_and_disappearing_remain_available(self):
        result, *_ = analyze([('2026-01-01', 'news', 0, 1), ('2026-01-01', 'news', 1, 1),
                             ('2026-01-10', 'news', 0, 10), ('2026-01-20', 'news', 1, 10)])
        before, now = [row['metrics'] for row in result['topics']]
        self.assertEqual(before['status'], 'disappearing')
        self.assertEqual(now['status'], 'emerging')
        self.assertIsNone(now['growth_pct'])
        self.assertFalse(now['stable_comparison'])

    def test_zero_denominators_and_empty_history_are_unknown(self):
        result, *_ = analyze([('2026-01-01', 'news', 0, 2), ('2026-01-20', 'news', 1, 1)])
        self.assertIsNone(result['topics'][0]['metrics']['previous_share_pct'])
        self.assertIsNone(result['topics'][0]['metrics']['share_change_pp'])
        self.assertIsNone(result['topics'][0]['history'][0]['share_pct'])
        self.assertFalse(result['adjustment']['available'])

    def test_fixed_subreddit_weights_remove_collection_mix_change(self):
        result, *_ = analyze([
            ('2026-01-01', 'a', 0, 1), ('2026-01-01', 'b', 1, 1),
            ('2026-01-10', 'a', 0, 30), ('2026-01-10', 'a', 1, 10),
            ('2026-01-10', 'b', 0, 5), ('2026-01-10', 'b', 1, 15),
            ('2026-01-20', 'a', 0, 15), ('2026-01-20', 'a', 1, 5),
            ('2026-01-20', 'b', 0, 10), ('2026-01-20', 'b', 1, 30)])
        metric = result['topics'][0]['metrics']
        self.assertAlmostEqual(metric['share_change_pp'], -100 / 6)
        self.assertAlmostEqual(metric['adjusted_share_change_pp'], 0)
        self.assertAlmostEqual(result['adjustment']['previous_weights']['a'], 2 / 3)
        for sub in result['subreddits']:
            self.assertAlmostEqual(sub['topics'][0]['metrics']['share_change_pp'], 0)
            self.assertEqual(len(sub['topics'][0]['history']), 12)

    def test_age_matching_requires_ten_valid_posts_in_each_period(self):
        posts, vectors = sample([('2026-01-01', 'news', 1, 1), ('2026-01-10', 'news', 0, 10),
                                 ('2026-01-20', 'news', 0, 10)])
        posts.loc[1:10, 'upvoteCount'] = 100
        with patch.object(topics, 'MiniBatchKMeans', return_value=FixedModel()):
            result = topics.analyze_topics(posts, vectors, topic_count=2)
        reaction = result['topics'][0]['metrics']['reaction']
        self.assertTrue(reaction['available'])
        self.assertEqual(reaction['votes_change'], -90)
        posts.loc[1, 'observation_age_hours'] = 49
        with patch.object(topics, 'MiniBatchKMeans', return_value=FixedModel()):
            reaction = topics.analyze_topics(posts, vectors, topic_count=2)['topics'][0]['metrics']['reaction']
        self.assertFalse(reaction['available'])
        self.assertIsNone(reaction['current_median_votes'])
        self.assertEqual(reaction['previous_count'], 9)
        posts['upvoteCount'] = np.nan
        with patch.object(topics, 'MiniBatchKMeans', return_value=FixedModel()):
            reaction = topics.analyze_topics(posts, vectors, topic_count=2)['topics'][0]['metrics']['reaction']
        self.assertEqual(reaction['current_count'], 0)

    def test_missing_comments_do_not_become_zero_or_hide_valid_votes(self):
        posts, vectors = sample([('2026-01-01', 'news', 1, 1), ('2026-01-10', 'news', 0, 10),
                                 ('2026-01-20', 'news', 0, 10)])
        posts.loc[1, 'commentCount'] = np.nan
        with patch.object(topics, 'MiniBatchKMeans', return_value=FixedModel()):
            reaction = topics.analyze_topics(posts, vectors, topic_count=2)['topics'][0]['metrics']['reaction']
        self.assertTrue(reaction['votes_available'])
        self.assertFalse(reaction['comments_available'])
        self.assertIsNone(reaction['comments_change'])
        self.assertEqual(reaction['votes_change'], 0)

    def test_alignment_invalid_dates_and_deduplication(self):
        posts, vectors = sample([('2026-01-01', 'news', 0, 2), ('2026-01-20', 'news', 1, 1)])
        with self.assertRaises(ValueError):
            topics.analyze_topics(posts, vectors[:2])
        invalid = posts.copy()
        invalid.loc[0, 'created_at'] = 'bad-date'
        with self.assertRaises(ValueError):
            topics.analyze_topics(invalid, vectors)
        posts.loc[1, 'title'] = posts.loc[0, 'title'].upper() + '  '
        with patch.object(topics, 'MiniBatchKMeans', return_value=FixedModel()) as constructor:
            result = topics.analyze_topics(posts, vectors)
        self.assertEqual(result['sample']['duplicate_posts'], 1)
        self.assertEqual(result['sample']['posts'], 2)
        self.assertEqual(constructor.call_args.kwargs['n_clusters'], 1)
        self.assertEqual(result['topics'][0]['examples']['representative'][0]['title'], posts.loc[0, 'title'])

    def test_insufficient_history_and_unsafe_urls(self):
        posts, vectors = sample([('2026-01-20', 'news', 0, 2)])
        self.assertEqual(topics.analyze_topics(posts, vectors)['method']['status'], 'insufficient_history')
        self.assertIsNone(topics._safe_url('javascript:alert(1)'))
        self.assertIsNone(topics._safe_url('https://['))
        self.assertEqual(topics._safe_url('https://example.com'), 'https://example.com')

    def test_history_is_chronological_and_subreddit_denominator_is_local(self):
        result, *_ = analyze([('2026-01-01', 'a', 0, 1), ('2026-01-10', 'a', 0, 3),
                              ('2026-01-20', 'a', 0, 2), ('2026-01-20', 'b', 1, 10)])
        history = result['subreddits'][0]['topics'][0]['history']
        self.assertEqual([bin['start'] for bin in history], sorted(bin['start'] for bin in history))
        self.assertEqual(history[-1]['total'], 2)
        self.assertEqual(history[-1]['share_pct'], 100)


if __name__ == '__main__':
    unittest.main()
