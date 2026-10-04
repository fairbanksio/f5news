import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gdelt_topics import build_topics


class TopicTests(unittest.TestCase):
    def article(self, number, title, source=None):
        return {'url': f'https://news.test/{number}', 'source': source or f'{number}.test',
                'title': title, 'themes': 'GENERAL_HEALTH;USPEC_POLITICS_GENERAL1'}

    def payload(self, *articles):
        return {'fetched_at': '2026-10-04T09:00:00+00:00', 'articles': list(articles)}

    def test_related_stories_get_specific_headline_names_and_one_group_each(self):
        payload = self.payload(
            self.article(1, 'NASA delays Artemis launch after fuel leak'),
            self.article(2, 'Fuel leak postpones NASA Artemis launch'),
            self.article(3, 'Tokyo opens a new rail line'),
            self.article(4, 'New Tokyo rail service starts today'),
            self.article(5, 'Court hears unrelated tax case'))
        result = build_topics(payload, [[5, 0, 0], [4, 1, 0], [0, 0, 7], [0, 1, 5], [0, 3, 0]])
        self.assertEqual(len(result['topics']), 2)
        for topic in result['topics']:
            self.assertIn(topic['name'], [article['title'] for article in topic['articles']])
            self.assertEqual(topic['article_count'], 2)
            self.assertEqual(topic['source_count'], 2)
            self.assertEqual(topic['summary'], 'Articles about the same or a closely related story.')
            self.assertEqual(topic['articles'][0]['label_kind'], 'headline')
        grouped = [article['url'] for topic in result['topics'] for article in topic['articles']]
        self.assertEqual(len(grouped), len(set(grouped)))
        self.assertEqual(result['other_articles'][0]['title'], 'Court hears unrelated tax case')
        self.assertEqual(result['unassigned_count'], 1)

    def test_unrelated_headlines_are_not_forced_into_topics_despite_shared_tags(self):
        payload = self.payload(self.article(1, 'New diabetes treatment approved'),
                               self.article(2, 'Government passes immigration bill'),
                               self.article(3, 'Wildfire closes interstate'))
        result = build_topics(payload, np.eye(3))
        self.assertEqual(result['topics'], [])
        self.assertEqual(result['unassigned_count'], 3)

    def test_exact_normalized_headlines_group_across_publishers(self):
        payload = self.payload(self.article(1, 'NASA Launch Delayed!'),
                               self.article(2, '  nasa launch   delayed '))
        result = build_topics(payload, [[1, 0], [0, 1]])
        self.assertEqual(result['topics'][0]['article_count'], 2)
        self.assertEqual(result['topics'][0]['source_count'], 2)

    def test_one_publisher_can_form_topic_but_distinct_publishers_rank_first(self):
        payload = self.payload(*[self.article(n, f'Story {n}', 'same.test' if n < 4 else f'{n}.test')
                                 for n in range(1, 6)])
        result = build_topics(payload, [[1, 0]] * 3 + [[0, 1]] * 2)
        self.assertEqual([topic['source_count'] for topic in result['topics']], [2, 1])
        self.assertEqual([topic['article_count'] for topic in result['topics']], [2, 3])

    def test_filtered_rows_do_not_shift_vectors_and_missing_title_stays_other(self):
        first = self.article(1, 'NASA delays launch')
        missing = self.article(2, '')
        bad = dict(first, url='javascript:alert(1)', title='Unsafe row')
        last = self.article(3, 'NASA launch postponed')
        payload = self.payload(first, bad, dict(first), missing, last)
        result = build_topics(payload, [[1, 0], [0, 1], [0, 1], [0, 1], [1, 0]])
        self.assertEqual(result['article_count'], 3)
        self.assertEqual(result['topics'][0]['article_count'], 2)
        self.assertEqual(result['other_articles'][0]['url'], missing['url'])
        self.assertEqual(result['other_articles'][0]['label_kind'], 'url')

    def test_default_encoder_receives_only_real_valid_unique_url_headlines(self):
        first = self.article(1, 'NASA delays launch')
        payload = self.payload(first, dict(first), self.article(2, None),
                               dict(first, url='https://broken.test:bad/x'),
                               self.article(3, 'NASA launch postponed'))
        with patch('semantic_analysis.encode_titles', return_value=np.array([[1, 0], [1, 0]])) as encode:
            result = build_topics(payload)
        encode.assert_called_once_with(['NASA delays launch', 'NASA launch postponed'])
        self.assertEqual(result['unassigned_count'], 1)

    def test_rejects_malicious_or_malformed_urls(self):
        urls = ['javascript:alert(1)', '//bad.test/path', 'https://user:pass@bad.test/',
                'https://bad.test:broken/', 'https://bad.test/with space', 'https://bad.test/\\path',
                'https://bad.test/\npath', 'https://[broken/', None]
        payload = self.payload(*[dict(self.article(n, 'Headline'), url=url) for n, url in enumerate(urls)])
        result = build_topics(payload, np.ones((len(urls), 2)))
        self.assertEqual(result['article_count'], 0)
        self.assertEqual(result['topics'], [])

    def test_preserves_filter_metadata(self):
        payload = self.payload(self.article(1, 'NASA delays launch'))
        payload.update(country_note='US publisher batch', input_article_count=4,
                       excluded_articles=[{'url': 'https://news.test/quiz', 'reason': 'Quiz'}])
        result = build_topics(payload, [[1, 0]])
        for field in ('fetched_at', 'country_note', 'input_article_count', 'excluded_articles'):
            self.assertEqual(result[field], payload[field])

    def test_invalid_vector_alignment_and_values_raise(self):
        payload = self.payload(self.article(1, 'Headline'))
        for features in ([], [[1, 0], [0, 1]], [[0, 0]], [[np.nan, 1]], [[]]):
            with self.subTest(features=features), self.assertRaises(ValueError):
                build_topics(payload, features)

    def test_empty_and_missing_titles_need_no_model(self):
        for payload in (self.payload(), self.payload(self.article(1, ''))):
            with patch('semantic_analysis.encode_titles') as encode:
                result = build_topics(payload)
            encode.assert_not_called()
            self.assertEqual(result['topics'], [])
            self.assertEqual(result['unassigned_count'], len(payload['articles']))


if __name__ == '__main__':
    unittest.main()
