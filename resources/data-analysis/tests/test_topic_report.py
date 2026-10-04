"""Safety and portable initial-content checks for the topic report."""

from html.parser import HTMLParser
from pathlib import Path
import json
import shutil
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from topic_report import render_topic_report, _sparkline, _story_date, _SCRIPT


class Document(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.tags = []
        self.in_payload = False
        self.payload = ""
        self.scripts = 0

    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        attrs = dict(attrs)
        if tag == "a":
            self.links.append(attrs.get("href"))
        if tag == "script":
            self.scripts += 1
            self.in_payload = attrs.get("id") == "topic-data"

    def handle_endtag(self, tag):
        if tag == "script":
            self.in_payload = False

    def handle_data(self, data):
        if self.in_payload:
            self.payload += data


class TopicReportTests(unittest.TestCase):
    def fixture(self):
        return {"sample": {"posts": 80000, "subreddits": 13, "earliest_created_at": "2026-01-01", "latest_created_at": "2026-09-30"},
                "periods": {"current": {"start": "2026-09-23", "end": "2026-09-30", "count": 200},
                            "previous": {"start": "2026-09-16", "end": "2026-09-23", "count": 180}},
                "topics": [{"id": 0, "name": "Space Launches", "keywords": ["space", "launch"],
                            "metrics": {"current_count": 30, "previous_count": 20, "current_share_pct": 15,
                                        "previous_share_pct": 11.1, "share_change_pp": 3.9, "stable_comparison": True,
                                        "reaction": {"available": True, "current_median_votes": 100, "previous_median_votes": 80}},
                            "history": [{"start": "2026-09-23", "end": "2026-09-30", "count": 30, "share_pct": 15}],
                            "examples": {"current": [{"title": "A Rocket Launch", "date": "2026-09-25", "sub": "news", "votes": 123, "comments": 10, "url": "https://example.com/rocket"}], "previous": []}}],
                "subreddits": [{"name": "news", "topics": [], "periods": {}}], "method": {"window_days": 7}}

    def test_default_all_topics_are_readable_without_javascript(self):
        result = self.fixture()
        report = render_topic_report(result)
        before_scripts = report.split('<script', 1)[0]
        self.assertIn("Space Launches", before_scripts)
        self.assertIn("A Rocket Launch", before_scripts)
        self.assertIn("80,000", before_scripts)
        self.assertIn("2026-09-16", before_scripts)
        self.assertIn('value="all"', before_scripts)
        self.assertIn("not all of Reddit", before_scripts)
        self.assertIn("Weekly Counts and Shares", before_scripts)
        self.assertIn("Headlines grouped automatically. Check examples.", before_scripts)

    def test_payload_cannot_close_script_and_round_trips(self):
        result = self.fixture()
        hostile = '</script><script>alert("x")</script>&\u2028\u2029'
        result["topics"][0]["name"] = hostile
        result["topics"][0]["examples"]["current"][0]["title"] = hostile
        document = Document()
        report = render_topic_report(result)
        document.feed(report)
        self.assertEqual(document.scripts, 2)
        self.assertEqual(json.loads(document.payload), result)
        self.assertNotIn(hostile, report)
        self.assertIn('\\u003c/script\\u003e', document.payload)
        self.assertNotIn('innerHTML', report)
        self.assertNotIn('eval(', report)

    def test_story_links_reject_non_http_schemes_and_controls(self):
        result = self.fixture()
        values = ["javascript:alert(1)", "//evil.example", "data:text/html,attack", "https://example.com/\nattack", "https://example.com/?a=1&b=2", "http://example.com/story"]
        topic = result["topics"][0]
        topic["examples"] = {"current": [{"title": "Unsafe Story", "url": u} for u in values[:3]], "previous": [{"title": "Story", "url": u} for u in values[3:]]}
        document = Document()
        document.feed(render_topic_report(result))
        self.assertEqual(document.links, values[4:])

    def test_empty_report_and_missing_metrics_are_clear(self):
        report = render_topic_report({})
        self.assertIn("No topics are available", report)
        self.assertIn("Unavailable", report)
        result = self.fixture()
        result["topics"][0]["metrics"] = {}
        self.assertIn("Unavailable → Unavailable", render_topic_report(result))

    def test_source_template_tokens_are_preserved(self):
        result = self.fixture()
        result["topics"][0]["name"] = "__DATA__"
        self.assertEqual(json.loads(DocumentPayload(render_topic_report(result)))["topics"][0]["name"], "__DATA__")

    def test_missing_weeks_split_lines_and_real_zero_is_preserved(self):
        chart = _sparkline([{"share_pct": 8}, {"share_pct": None}, {"share_pct": 0}, {"share_pct": 4}])
        self.assertEqual(chart.count("<polyline"), 2)
        self.assertEqual(chart.count("<circle"), 3)
        self.assertIn('cy="72.0"', chart)
        self.assertIn("gaps mean no data", chart)
        self.assertIn("No weekly history available", _sparkline([{"share_pct": None}, {"share_pct": "invalid"}]))
        self.assertIn("No weekly history available", _sparkline([]))

    def test_story_timestamps_use_pacific_time_and_periods_use_dates(self):
        self.assertEqual(_story_date("2026-10-04T20:03:00Z"), "Oct 4, 2026 1:03 PM PDT")
        self.assertEqual(_story_date("2026-01-02T02:03:00Z"), "Jan 1, 2026 6:03 PM PST")
        result = self.fixture()
        result["periods"]["current"]["start"] = "2026-09-23T00:00:00Z"
        result["topics"][0]["examples"]["current"][0]["date"] = "2026-10-04T20:03:00Z"
        report = render_topic_report(result).split("<script", 1)[0]
        self.assertIn("Recent: 2026-09-23 to", report)
        self.assertIn("Oct 4, 2026 1:03 PM PDT", report)
        self.assertNotIn("T00:00:00", report)

    @unittest.skipUnless(shutil.which("node"), "Node is needed to exercise the offline controls")
    def test_votes_and_comments_can_be_compared_independently(self):
        fixture = self.fixture()
        topic = fixture["topics"][0]
        topic["metrics"]["reaction"] = {"available": False, "comments_available": True,
            "comments_change": 30, "previous_median_comments": 20, "current_median_comments": 50,
            "previous_median_votes": None, "current_median_votes": None}
        fixture["subreddits"][0]["topics"] = [topic]
        runtime = r"""
class Element {
 constructor(){this.children=[];this.textContent="";this.style={};this.value="";this.hidden=false;}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 setAttribute(){}
 addEventListener(){}
 text(){return this.textContent+this.children.map(c=>c.text()).join(" ");}
}
const nodes={};const document={getElementById(id){return nodes[id]||(nodes[id]=new Element());},createElement(){return new Element();},createElementNS(){return new Element();}};
"""
        setup = 'document.getElementById("topic-data").textContent=' + json.dumps(json.dumps(fixture)) + ';document.getElementById("subreddit").value="0";document.getElementById("measure").value="comments";'
        checks = r"""
const commentsView={rising:nodes.rising.text(),table:nodes.comparisons.text(),note:nodes["measure-note"].text()};
nodes.measure.value="reactions";render();const votesView={rising:nodes.rising.text(),table:nodes.comparisons.text()};
data.subreddits[0].topics[0].metrics.reaction={available:true,comments_available:false,votes_change:70,previous_median_votes:30,current_median_votes:100};
nodes.measure.value="reactions";render();const votesOnly=nodes.rising.text();nodes.measure.value="comments";render();const commentsUnavailable=nodes.rising.text();
nodes.subreddit.value="all";nodes.measure.value="comments";render();
process.stdout.write(JSON.stringify({commentsView,votesView,votesOnly,commentsUnavailable,allHidden:nodes.ranking.hidden,allNote:nodes["measure-note"].text()}));
"""
        output = subprocess.run([shutil.which("node")], input=runtime+setup+_SCRIPT+checks, text=True, capture_output=True, check=True)
        state = json.loads(output.stdout)
        self.assertIn("+30.0 comments", state["commentsView"]["rising"])
        self.assertIn("20.0 → 50.0", state["commentsView"]["table"])
        self.assertIn("saved median comments", state["commentsView"]["note"])
        self.assertIn("No supported changes", state["votesView"]["rising"])
        self.assertIn("20.0 → 50.0", state["votesView"]["table"])
        self.assertIn("+70.0 votes", state["votesOnly"])
        self.assertIn("No supported changes", state["commentsUnavailable"])
        self.assertTrue(state["allHidden"])
        self.assertIn("Choose a subreddit", state["allNote"])
        report = render_topic_report(fixture)
        self.assertIn('<option value="comments">More Comments</option>', report)
        self.assertIn('<option value="reactions">More Votes</option>', report)
        self.assertIn("Search Topics or Example Headlines", report)

    def test_dark_self_contained_controls_and_supported_rankings(self):
        report = render_topic_report(self.fixture())
        self.assertIn("color-scheme:dark", report)
        self.assertIn('id="search"', report)
        self.assertIn('id="measure"', report)
        self.assertIn('id="subreddit"', report)
        self.assertNotIn('<script src=', report)
        self.assertNotIn('<link', report)
        self.assertIn('t.metrics?.stable_comparison', report)
        self.assertIn('adjusted_share_change_pp', report)
        self.assertIn('$("ranking").hidden=isAll&&reaction', report)
        self.assertIn('Choose a subreddit to compare reactions.', report)


def DocumentPayload(report):
    document = Document()
    document.feed(report)
    return document.payload


if __name__ == "__main__":
    unittest.main()
