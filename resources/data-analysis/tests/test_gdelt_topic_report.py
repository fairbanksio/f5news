"""Content and safety checks for the static GDELT topic report."""

from html.parser import HTMLParser
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gdelt_topic_report import render_topics


class Document(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.tags = []

    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        if tag == "a":
            self.links.append(dict(attrs))


class GdeltTopicReportTests(unittest.TestCase):
    def fixture(self):
        return {"fetched_at": "2026-10-04T20:03:00Z", "country_note": "United States websites only.",
                "article_count": 4, "source_count": 3, "unassigned_count": 1,
                "topics": [{"name": "Space Launches", "summary": "A rocket took supplies to space.",
                            "article_count": 3, "source_count": 2,
                            "articles": [{"url": "https://one.example/rocket?a=1&b=2", "source": "one.example", "label": "A Rocket Launch", "label_kind": "headline"},
                                         {"url": "http://two.example/space", "source": "two.example", "label": "Space Supplies", "label_kind": "url"}]}]}

    def test_readable_links_counts_and_limitations(self):
        report = render_topics(self.fixture())
        document = Document()
        document.feed(report)
        self.assertEqual([row["href"] for row in document.links if not row["href"].startswith("#")], ["https://one.example/rocket?a=1&b=2", "http://two.example/space"])
        self.assertTrue(all(row["rel"] == "noopener noreferrer" for row in document.links if not row["href"].startswith("#")))
        for text in ["Topics Getting Coverage", "Space Launches", "A rocket took supplies to space.",
                     "2 websites · 3 articles", "United States websites only.",
                     "This single batch cannot show whether interest is rising.",
                     "not verified headlines", "1 article did not fit a topic", "Oct 4, 2026 1:03 PM PDT",
                     "Related stories about the same person are combined under one topic."]:
            self.assertIn(text, report)
        self.assertIn("color-scheme:dark", report)
        self.assertFalse(set(document.tags) & {"script", "link", "img", "iframe"})

    def test_all_source_text_is_escaped(self):
        result = self.fixture()
        hostile = '<script>alert("x")</script>&'
        result["country_note"] = hostile
        result["topics"][0].update(name=hostile, summary=hostile)
        result["topics"][0]["articles"][0].update(label=hostile, source=hostile)
        report = render_topics(result)
        document = Document()
        document.feed(report)
        self.assertNotIn("script", document.tags)
        self.assertNotIn(hostile, report)
        self.assertGreaterEqual(report.count('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;'), 5)

    def test_malicious_and_malformed_urls_have_no_links(self):
        result = self.fixture()
        urls = ["javascript:alert(1)", "data:text/html,attack", "//evil.example/attack", "https:///no-host",
                "https://example.com/\nattack", "https://example.com/\\attack", "https://[bad", "https://example.com:bad/",
                "https://user:password@example.com/", "https://example.com/\tattack"]
        result["topics"][0]["articles"] = [{"url": url, "label": "Unsafe Article", "source": "Website"} for url in urls]
        document = Document()
        document.feed(render_topics(result))
        self.assertEqual([row for row in document.links if not row["href"].startswith("#")], [])

    def test_nested_stories_under_one_named_topic(self):
        result = self.fixture()
        topic = result['topics'][0]
        topic['name'] = 'Christa Pike'
        topic['story_count'] = 2
        topic['stories'] = [dict(name='Failed execution', articles=topic['articles'][:1]),
                            dict(name='Sentence commutation', articles=topic['articles'][1:])]
        report = render_topics(result)
        self.assertIn('Christa Pike', report)
        self.assertIn('<th>Stories</th>', report)
        self.assertIn('<summary>Failed execution</summary>', report)
        self.assertIn('<summary>Sentence commutation</summary>', report)
        self.assertEqual(report.count('https://one.example/rocket?a=1&amp;b=2'), 1)

    def test_empty_and_missing_examples(self):
        report = render_topics({})
        self.assertIn("No topics found in this batch.", report)
        self.assertNotIn("not verified headlines", report)
        result = self.fixture()
        result["topics"][0]["articles"] = []
        self.assertIn("No article links available.", render_topics(result))

    def test_ranking_order_is_preserved(self):
        result = self.fixture()
        result["topics"].append({"name": "Earthquakes", "summary": "The ground shook.", "article_count": 1, "source_count": 1, "articles": []})
        report = render_topics(result)
        self.assertLess(report.index("Space Launches"), report.index("Earthquakes"))

    def test_news_filter_and_excluded_articles_are_safe_and_collapsed(self):
        result = self.fixture()
        result["input_article_count"] = 6
        result["excluded_articles"] = [
            {"url": "https://quiz.example/quiz", "source": "quiz.example", "label": "Quiz", "reason": "Quiz or game"},
            {"url": "javascript:alert(1)", "source": '<img src=x>', "label": '<script>attack</script>', "reason": '<iframe>attack</iframe>'}]
        report = render_topics(result)
        document = Document()
        document.feed(report)
        self.assertIn("Kept 4 of 6 articles", report)
        self.assertIn("Automatic filtering can miss things.", report)
        self.assertIn('<details><summary>Excluded Articles (2)</summary>', report)
        self.assertNotIn('<details open', report)
        self.assertEqual(document.links[-1]["href"], "https://quiz.example/quiz")
        self.assertFalse(set(document.tags) & {"img", "script", "iframe"})
        self.assertIn('&lt;iframe&gt;attack&lt;/iframe&gt;', report)
        self.assertNotIn("News Filter:", render_topics(self.fixture()))

    def test_other_news_links_are_shown_without_topics(self):
        result = self.fixture()
        articles = result["topics"][0]["articles"]
        result["topics"] = []
        result["other_articles"] = articles
        report = render_topics(result)
        document = Document()
        document.feed(report)
        self.assertIn('<h2>Other News</h2>', report)
        self.assertEqual(len(document.links), 2)
        self.assertIn("not verified headlines", report)


if __name__ == "__main__":
    unittest.main()
