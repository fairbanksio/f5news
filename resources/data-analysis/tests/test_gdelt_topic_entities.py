import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gdelt_topic_entities import umbrella_topics


class UmbrellaTopicTests(unittest.TestCase):
    def article(self, number, title, persons='christa pike'):
        return dict(url=f'https://news.test/{number}', title=title,
                    source=f'{number}.test', persons=persons)

    def story(self, name, articles):
        return dict(name=name, summary='Related news.', articles=articles,
                    article_count=len(articles), source_count=len(articles))

    def test_person_combines_two_stories_and_singleton(self):
        articles = [self.article(1, 'Christa Pike execution halted')]
        articles += [self.article(n, f'Pike execution attempt report {n}') for n in range(2, 5)]
        articles += [self.article(5, "Christa Pike’s sentence commuted")]
        articles += [self.article(n, f'Pike sentence decision report {n}') for n in range(6, 9)]
        stories = [self.story('Execution halted', articles[:4]),
                   self.story('Sentence commuted', articles[4:])]
        topic, = umbrella_topics(stories, articles)
        self.assertEqual(topic['name'], 'Christa Pike')
        self.assertEqual(topic['article_count'], 8)
        self.assertEqual(topic['source_count'], 8)
        self.assertEqual(topic['stories'], stories)
        singleton = self.article(9, 'Pike seeks new hearing')
        topic, = umbrella_topics(stories, articles + [singleton])
        self.assertEqual(topic['article_count'], 9)
        self.assertIn(singleton, topic['articles'])
        self.assertEqual(len(topic['stories']), 3)
        self.assertEqual(topic['stories'][-1]['articles'], [singleton])

    def test_trump_alias_requires_full_name_headline_anchor(self):
        articles = [self.article(1, 'Donald Trump addresses reporters', 'donald trump'),
                    self.article(2, 'Trump announces policy', ''),
                    self.article(3, 'Congress votes today', 'donald trump')]
        topic, = umbrella_topics([], articles)
        self.assertEqual(topic['name'], 'Donald Trump')
        self.assertEqual(topic['article_count'], 2)
        self.assertEqual(umbrella_topics([], articles[1:]), [])

    def test_body_names_and_substrings_do_not_assign_articles(self):
        articles = [self.article(1, 'Christa Pike asks for review'),
                    self.article(2, 'Pike wins hearing'),
                    self.article(3, 'Spike in energy prices'),
                    self.article(4, 'Court hears unrelated dispute')]
        topic, = umbrella_topics([], articles)
        self.assertEqual([article['url'] for article in topic['articles']],
                         [articles[0]['url'], articles[1]['url']])

    def test_ambiguous_surname_does_not_assign_alias(self):
        articles = [self.article(1, 'Donald Trump speaks', 'donald trump;melania trump'),
                    self.article(2, 'Donald Trump travels', 'donald trump'),
                    self.article(3, 'Trump visits city', 'donald trump'),
                    self.article(4, 'Melania Trump speaks', 'melania trump'),
                    self.article(5, 'Melania Trump travels', 'melania trump')]
        topics = umbrella_topics([], articles)
        self.assertEqual(len(topics), 2)
        self.assertEqual({topic['article_count'] for topic in topics}, {2})
        self.assertNotIn(articles[2], [article for topic in topics for article in topic['articles']])

    def test_overlapping_people_choose_central_actor_without_duplicate_articles(self):
        persons = 'donald trump;jay clayton'
        articles = [self.article(1, 'Donald Trump nominates Jay Clayton', persons),
                    self.article(2, 'Jay Clayton nominated by Trump', persons),
                    self.article(3, 'Clayton faces confirmation hearing', persons),
                    self.article(4, 'Jay Clayton responds to senators', persons)]
        topic, = umbrella_topics([], articles)
        self.assertEqual(topic['name'], 'Jay Clayton')
        self.assertEqual(topic['article_count'], 4)
        self.assertEqual(umbrella_topics([], list(reversed(articles)))[0]['name'], 'Jay Clayton')
        self.assertEqual(len({article['url'] for article in topic['articles']}), 4)

    def test_tied_overlap_uses_earliest_headline_mention(self):
        persons = 'alex smith;jordan jones'
        articles = [self.article(1, 'Alex Smith meets Jordan Jones', persons),
                    self.article(2, 'Smith consults Jones', persons)]
        topic, = umbrella_topics([], articles)
        self.assertEqual(topic['name'], 'Alex Smith')

    def test_entity_singletons_with_same_headline_share_nested_story(self):
        articles = [self.article(1, 'Christa Pike hearing scheduled'),
                    self.article(2, 'Christa Pike hearing scheduled')]
        topic, = umbrella_topics([], articles)
        self.assertEqual(len(topic['stories']), 1)
        self.assertEqual(topic['stories'][0]['article_count'], 2)

    def test_unicode_punctuation_and_possessives_share_identity(self):
        articles = [self.article(1, 'José O’Connor’s court hearing', 'josé o’connor'),
                    self.article(2, "Jose O'Connor responds", "jose o'connor"),
                    self.article(3, 'OConnor seeks review', '')]
        topic, = umbrella_topics([], articles)
        self.assertEqual(topic['name'], 'José O’Connor')
        self.assertEqual(topic['article_count'], 3)

    def test_mixed_story_and_fallback_keep_counts_and_nested_members_consistent(self):
        articles = [self.article(1, 'Christa Pike asks for review'),
                    self.article(2, 'Pike hearing scheduled'),
                    self.article(3, 'Court budget increases', ''),
                    self.article(4, 'Court budget approved', ''),
                    self.article(5, 'Unrelated singleton', '')]
        stories = [self.story('Court coverage', articles[:4])]
        topics = umbrella_topics(stories, articles)
        self.assertEqual(len(topics), 2)
        urls = [article['url'] for topic in topics for article in topic['articles']]
        self.assertEqual(len(urls), len(set(urls)))
        self.assertEqual(len(urls), 4)
        for topic in topics:
            self.assertEqual(topic['article_count'], len(topic['articles']))
            self.assertEqual(topic['stories'][0]['article_count'], 2)


if __name__ == '__main__':
    unittest.main()
