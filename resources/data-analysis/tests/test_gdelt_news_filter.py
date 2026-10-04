import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from gdelt_news_filter import news_reason,filter_news

class NewsFilterTests(unittest.TestCase):
    def test_excludes_lifestyle_with_misleading_tags(self):
        for title in ['Your Perfect Autumn Reveals Your Intimacy Spice Level','How posh is your wardrobe?','NYT Mini Crossword Hints And Answers','Dear Abby: My family hurt me','50 Wives Post Ridiculous Things']:
            self.assertIsNotNone(news_reason(dict(title=title,themes='ELECTION;MEDICAL')))

    def test_retains_events(self):
        for title in ['Polls open in Bosnia','U.S. Economy Shows Slower Hiring','Police investigate fatal shooting','Product recall follows contamination','Carnegie Mellon gets $3bn donation','Germany visits Kyiv as Russia steps up attacks']:
            self.assertIsNone(news_reason(dict(title=title,themes='')))

    def test_exclusions_are_reviewable(self):
        p=dict(articles=[dict(title='Quiz: Who are you?',url='https://a.test',source='a.test'),dict(title='Polls open',url='https://b.test',source='b.test')])
        r=filter_news(p)
        self.assertEqual(r['input_article_count'],2)
        self.assertEqual(len(r['articles']),1)
        self.assertEqual(r['excluded_articles'][0]['reason'],'Quiz Or Puzzle')
        self.assertEqual(len(p['articles']),2)

if __name__=='__main__':unittest.main()
