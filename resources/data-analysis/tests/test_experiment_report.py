"""Offline checks for safe, portable experiment reports."""

from html.parser import HTMLParser
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from experiment_report import render_experiment_report


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs = []
        self.tags = []

    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        self.hrefs.extend(value for name, value in attrs if name == "href")


class ExperimentReportTests(unittest.TestCase):
    def fixture(self):
        return {"sample": {"loaded": 12, "usable": 10, "first_post": "2026-10-01", "last_post": "2026-10-04",
                           "subreddit_counts": {"news": 10}, "field_coverage": {"title": 1.0}},
                "elapsed_seconds": 1.123456789,
                "experiments": [{"id": "clusters", "title": "Story Groups", "summary": "Posts about similar stories.",
                                 "status": "complete", "metrics": {"groups": 2}, "tables": []}],
                "snapshot": {"status": "needs_history", "summary": "Repeated snapshots are needed."}}

    def test_escapes_every_source_of_dynamic_content(self):
        result = self.fixture()
        hostile = '<script>alert("x")</script>'
        result["sample"]["last_post"] = hostile
        entry = result["experiments"][0]
        entry.update({"id": 'x" onclick="alert(1)', "title": hostile, "summary": hostile,
                      "metrics": {hostile: hostile}, "tables": [{"title": hostile, "rows": [{hostile: hostile}]}]})
        result["snapshot"]["summary"] = hostile
        report = render_experiment_report(result)
        parser = Links()
        parser.feed(report)
        self.assertNotIn("script", parser.tags)
        self.assertNotIn(hostile, report)
        self.assertIn("&lt;script&gt;", report)
        self.assertNotIn(' onclick="', report)

    def test_links_allow_only_http_and_https(self):
        result = self.fixture()
        values = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '//evil.example',
                  'https://example.com/?x="quoted"&y=2', 'http://example.com/post', 'https://example.com/\npost']
        result["experiments"][0]["tables"] = [{"title": "Posts", "rows": [{"URL": value} for value in values]}]
        parser = Links()
        parser.feed(render_experiment_report(result))
        external = [url for url in parser.hrefs if not url.startswith("#")]
        self.assertEqual(external, values[3:5])

    def test_empty_rows_and_pending_status_are_clear(self):
        result = self.fixture()
        result["experiments"][0]["tables"] = [{"title": "Empty Results", "rows": []}]
        report = render_experiment_report(result)
        self.assertIn("No rows are available", report)
        self.assertIn(">Complete<", report)
        self.assertIn(">Need More Data<", report)
        self.assertIn("Tomorrow’s Popularity", report)
        self.assertIn("Repeated snapshots are needed.", report)

    def test_report_is_dark_and_self_contained(self):
        report = render_experiment_report(self.fixture())
        self.assertIn("color-scheme:dark", report)
        self.assertIn("overflow-x:auto", report)
        self.assertIn("<dd>1.1</dd>", report)
        self.assertNotIn("1.123456789</dd>", report)
        parser = Links()
        parser.feed(report)
        self.assertNotIn("script", parser.tags)
        self.assertNotIn("link", parser.tags)
        self.assertEqual(parser.hrefs, ["#clusters"])
        self.assertIn("not all of Reddit", report)

    def test_missing_data_can_render(self):
        self.assertIn("Unavailable", render_experiment_report({}))

    def test_small_numbers_and_scalar_values_keep_their_meaning(self):
        class Scalar:
            def item(self):
                return 1234

        result = self.fixture()
        result["sample"]["usable"] = Scalar()
        result["sample"]["last_post"] = "2026-10-04T16:03:02Z"
        result["experiments"][0]["metrics"] = {"cosine_threshold": 0.7}
        result["experiments"][0]["tables"] = [{"title": "Values", "rows": [{"Small Rate": 0.00012, "Missing": float("nan") }]}]
        report = render_experiment_report(result)
        self.assertIn("<dd>1,234</dd>", report)
        self.assertIn("<td>0.00012</td>", report)
        self.assertIn("<td>Unavailable</td>", report)
        self.assertIn("<dd>2026-10-04</dd>", report)
        self.assertIn("<summary>Sample Details</summary>", report)
        self.assertIn("100.0%", report)
        self.assertNotIn("<dt>Cosine Threshold</dt>", report)
        self.assertIn("cosine_threshold", report)


if __name__ == "__main__":
    unittest.main()
