import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gdelt_topics import build_topics


class TopicTests(unittest.TestCase):
    def sample(self):
        return {'fetched_at': '2026-10-04T09:00:00+00:00', 'articles': [
            {'url':'https://a.test/1', 'source':'a.test', 'title':'Jane Smith wins election', 'persons':'jane smith', 'themes':'ELECTION;TRIAL'},
            {'url':'https://b.test/2', 'source':'b.test', 'title':'Jane Smith addresses voters', 'persons':'jane smith;body only', 'themes':'ELECTION'},
            {'url':'https://c.test/3', 'source':'c.test', 'title':'Something else', 'persons':'body only', 'themes':''},
        ]}

    def test_named_mentions_and_subjects(self):
        r=build_topics(self.sample())
        topics={t['name']:t for t in r['topics']}
        self.assertEqual(set(topics), {'Elections','Jane Smith'})
        self.assertEqual(topics['Elections']['source_count'],2)
        self.assertEqual(r['unassigned_count'],1)
        self.assertEqual(topics['Jane Smith']['articles'][0]['label_kind'],'headline')

    def test_duplicates_and_bad_links(self):
        p=self.sample(); p['articles'] += [p['articles'][0],dict(p['articles'][0],url='javascript:alert(1)')]
        r=build_topics(p)
        self.assertEqual(r['article_count'],3)
        self.assertEqual(r['topics'][0]['article_count'],2)

    def test_empty(self):
        p=self.sample();p['articles']=[]
        self.assertEqual(build_topics(p)['topics'],[])

if __name__=='__main__': unittest.main()
