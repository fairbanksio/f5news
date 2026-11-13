"""Check cookie and local storage reuse in real Firefox without network access."""

import sys
import json
import tempfile
from pathlib import Path
from urllib.parse import quote, urlsplit
from types import SimpleNamespace
from unittest.mock import patch

import smoke
from invisible_playwright import InvisiblePlaywright

FEED = "https://www.reddit.com/r/" + json.loads(smoke.SUBREDDITS.read_text())[0] + "/rising/"
STORAGE_KEY = "f5_offline_session_check"
STORAGE_VALUE = "offline-fixture-storage"
COOKIE_VALUE = "offline-fixture-cookie-not-an-account"
HTML = """<!doctype html><title>Offline Session Check</title>
<script>
  document.documentElement.dataset.restoredBeforePageScript =
    localStorage.getItem('f5_offline_session_check') === 'offline-fixture-storage' ? 'yes' : 'no';
</script>
<shreddit-post>Offline fixture</shreddit-post>"""


def offline_page(browser):
    page = browser.new_page()
    page.route("https://www.reddit.com/**", lambda route: route.fulfill(status=200, content_type="text/html", body=HTML))
    return page


def check_access_classification(page):
    fixtures = [
        ("<title>Offline Feed</title><shreddit-post>You have been blocked. Verify that you are human.</shreddit-post>", "feed"),
        ("<title>You have been blocked</title><shreddit-post>Story</shreddit-post>", "feed"),
        ("<div style='position:fixed'>You have been blocked by network security.</div><shreddit-post>Story</shreddit-post>", "blocked"),
        ("<div>Verify that you are human.</div><shreddit-post>Story</shreddit-post>", "challenge"),
        ("<div hidden>You have been blocked.</div><div style='display:none'>Complete the challenge.</div><div style='visibility:hidden'>Blocked by network security.</div><shreddit-post>Story</shreddit-post>", "feed"),
        ("<script type='application/json'>\"You have been blocked\"</script><style>/* Complete the challenge */</style><shreddit-post>Story</shreddit-post>", "feed"),
        ("<div style='display:contents'>You have been blocked.</div><shreddit-post>Story</shreddit-post>", "blocked"),
        ("<title>Blocked by network security</title><div>Access denied.</div>", "blocked"),
    ]
    for html, expected in fixtures:
        page.goto("data:text/html," + quote("<!doctype html>" + html), wait_until="domcontentloaded", timeout=15000)
        assert smoke.state(page) == expected

    for html, region, control in (
        ("<footer><a href='/help'>Verify that you are human</a></footer>", "footer", False),
        ("<dialog open><h2>Verify that <span>you are human</span></h2></dialog>", "dialog", False),
        ("<div id='captcha-widget'>Verify that you are human</div>", "verification", True),
    ):
        page.goto("data:text/html," + quote("<!doctype html>" + html + "<shreddit-post>Story</shreddit-post>"),
                  wait_until="domcontentloaded", timeout=15000)
        with patch.object(smoke, "log") as log:
            assert smoke.state(page) == "challenge"
        evidence = json.loads(log.call_args.args[0])
        assert evidence["matchedRegion"] == region
        assert evidence["verificationControl"] is control
        assert evidence["dialogVisible"] is (region == "dialog")


def check_navigation_http(browser):
    fixtures = (
        (403, False, "navigation_http_rejected"),
        (403, True, "feed_challenge"),
        (429, False, "navigation_rate_limited"),
        (503, False, "navigation_network_error"),
    )
    for status, challenge, expected in fixtures:
        page = browser.new_page()
        requests = []
        def fulfill(route):
            if route.request.is_navigation_request():
                requests.append(True)
            headers = {"content-type": "text/html", "content-length": "0", "set-cookie": "fixture=never-log-this-header; Secure; Path=/"}
            if status == 429:
                headers["retry-after"] = "60"
            if challenge:
                headers["cf-mitigated"] = "challenge"
            route.fulfill(status=status, headers=headers, body="")
        page.route("https://www.reddit.com/**", fulfill)
        messages = []
        with patch.object(smoke, "log", side_effect=messages.append):
            try:
                smoke.navigate(page, "https://www.reddit.com/offline-status-check", timeout=10000 if status == 503 else 5000)
            except smoke.SessionError as error:
                assert error.code == expected, "Offline HTTP reason did not match"
                assert error.http_status == status, "Offline HTTP status was not retained"
                assert error.retry_after_seconds == (60 if status == 429 else None), "Offline Retry-After metadata did not match"
            else:
                raise AssertionError("The offline HTTP fixture was not rejected")
        attempts = 3 if status == 503 else 1
        assert len(requests) == attempts, "Offline HTTP attempt count did not match"
        events = [json.loads(message) for message in messages if message.startswith("{")]
        assert events == [{"eventType": "BROWSER_NAVIGATION_HTTP", "status": status,
                           "retryAfterSeconds": 60 if status == 429 else None, "contentLength": 0,
                           "challenge": challenge}] * attempts, "Offline HTTP event metadata did not match"
        assert not any("never-log-this-header" in message or "https://" in message or "set-cookie" in message for message in messages)
        page.close()


def check_batch_runtime(saved, directory):
    feeds = json.loads(smoke.SUBREDDITS.read_text())
    assert len(feeds) >= 3, "Partial batch fixture needs a valid prefix and an unread suffix"
    failure_index = len(feeds) // 2
    for failure_status in (None, 403, 429):
        stats = {"launches": 0, "pages": 0, "requests": [], "checks": []}
        source = Path(directory) / "batch-input.json"
        output = Path(directory) / "batch-output.json"
        smoke.write_session(source, saved)

        class PageProxy:
            def __init__(self, page):
                self.page = page
            def __getattr__(self, name):
                return getattr(self.page, name)
            def locator(self, *_args, **_kwargs):
                raise AssertionError("Batch reuse unexpectedly accessed login controls")
            def evaluate_read(self, expression, *args):
                if expression.startswith("(function readRenderedPosts"):
                    retained = self.page.evaluate_read("""() => ({storage: localStorage.getItem('f5_offline_session_check') === 'offline-fixture-storage', visits: Number(localStorage.getItem('f5_batch_visits'))})""")
                    assert retained["storage"], "Batch local storage did not survive navigation"
                    assert retained["visits"] == len(stats["checks"]) + 1, "Batch local storage visit count was reset"
                    assert smoke.has_account_session(self.page), "Batch account cookie was lost"
                    stats["checks"].append(True)
                return self.page.evaluate_read(expression, *args)

        class BrowserFactory:
            def __init__(self, **kwargs):
                stats["launches"] += 1
                self.manager = InvisiblePlaywright(**kwargs, timezone="UTC", locale="en-US")
            def __enter__(self):
                self.browser = self.manager.__enter__()
                return self
            def __exit__(self, *args):
                return self.manager.__exit__(*args)
            def on(self, *args):
                return self.browser.on(*args)
            def new_page(self):
                stats["pages"] += 1
                page = self.browser.new_page()
                def fulfill(route):
                    if not route.request.is_navigation_request():
                        route.fulfill(status=204, body="")
                        return
                    parts = urlsplit(route.request.url).path.split("/")
                    assert len(parts) >= 5 and parts[1] == "r" and parts[3] == "rising", "Batch visited an unexpected route"
                    feed = parts[2]
                    assert feed in feeds, "Batch requested an unconfigured feed"
                    stats["requests"].append(feed)
                    index = feeds.index(feed)
                    if failure_status is not None and index == failure_index:
                        route.fulfill(status=failure_status, headers={"content-type": "text/html", "content-length": "0"}, body="")
                        return
                    name = feed.lower() + "0"
                    html = f"""<!doctype html><title>Offline Batch Feed</title>
                    <script>localStorage.setItem('f5_batch_visits', String(Number(localStorage.getItem('f5_batch_visits') || 0) + 1));</script>
                    <shreddit-post id="t3_{name}" subreddit-name="{feed}" post-type="link" post-title="Offline Story" author="fixture"
                      created-timestamp="2026-11-06T00:00:00Z" score="12" comment-count="2" domain="example.com"
                      content-href="https://example.com/story" permalink="/r/{feed}/comments/{name}/story/">Offline fixture</shreddit-post>"""
                    headers = {"content-type": "text/html"}
                    if index == 0:
                        headers["set-cookie"] = "reddit_session=offline-rotated-session; Domain=.reddit.com; Path=/; Secure; HttpOnly; SameSite=Lax"
                    route.fulfill(status=200, headers=headers, body=html)
                page.route("https://www.reddit.com/**", fulfill)
                return PageProxy(page)

        config = SimpleNamespace(subreddit=feeds[0], limit=1, all_feeds=True, authenticate=False,
                                 session_input=source, session_output=output, image_priority_map=None, batch_budget_seconds=90)
        messages = []
        with patch.object(smoke, "log", side_effect=messages.append):
            result = smoke.run_all_feeds(config, browser_factory=BrowserFactory)
        expected = len(feeds) if failure_status is None else failure_index
        assert result["status"] == "accessible", "Offline batch did not preserve accessible results"
        assert [item["subreddit"] for item in result["feeds"]] == feeds[:expected], "Offline batch prefix did not match"
        assert stats["launches"] == 1 and stats["pages"] == 1, "Offline batch opened more than one browser or page"
        assert len(stats["checks"]) == expected, "Offline batch did not retain state on every feed"
        assert stats["requests"] == feeds[:expected + (failure_status is not None)], "Offline batch read after a rejection"
        if failure_status is not None:
            assert result["batchFailure"]["subreddit"] == feeds[failure_index], "Offline batch failure identified the wrong feed"
            assert result["batchFailure"]["httpStatus"] == failure_status, "Offline batch failure lost HTTP status"
        final = smoke.read_session(output)
        assert any(cookie["name"] == "reddit_session" and cookie["value"] == "offline-rotated-session" for cookie in final["cookies"]), "Offline batch did not export final cookies"
        storage = dict((item["name"], item["value"]) for item in final["origins"][0]["localStorage"])
        assert storage["f5_batch_visits"] == str(expected), "Offline batch final local storage did not match"
        assert not any(COOKIE_VALUE in message or "offline-rotated-session" in message or STORAGE_VALUE in message for message in messages), "Offline batch logged fixture session values"
        progress = [json.loads(message) for message in messages if message.startswith('{') and json.loads(message).get("eventType") == "BROWSER_BATCH_FEED"]
        assert sum(item["stage"] == "collected" for item in progress) == expected, "Offline batch progress count did not match"


def main():
    stage = "starting"
    try:
        with tempfile.TemporaryDirectory() as directory, smoke.browser_lifecycle():
            path = Path(directory) / "session.json"
            seed = 12345
            stage = "exporting"
            with InvisiblePlaywright(seed=seed, headless=True, timezone="UTC", locale="en-US", extra_prefs=smoke.BROWSER_EXTRA_PREFS) as browser:
                stage = "creating the export page"
                page = offline_page(browser)
                stage = "setting the fixture cookie"
                page.context.add_cookies([{
                    "name": "reddit_session", "value": COOKIE_VALUE, "domain": ".reddit.com",
                    "path": "/", "secure": True, "httpOnly": True, "sameSite": "Lax",
                }])
                stage = "loading the offline fixture"
                page.goto(FEED, wait_until="domcontentloaded", timeout=15000)
                stage = "setting fixture local storage"
                page.evaluate("([name, value]) => localStorage.setItem(name, value)", [STORAGE_KEY, STORAGE_VALUE])
                stage = "checking the fixture feed"
                assert smoke.state(page) == "feed"
                stage = "checking the fixture cookie"
                assert smoke.has_account_session(page)
                stage = "exporting session state"
                smoke.export_session(page, seed, path)
                stage = "checking access classification"
                check_access_classification(page)
                page.close()
                stage = "checking offline HTTP response diagnostics"
                check_navigation_http(browser)
            stage = "reading saved session state"
            saved = smoke.read_session(path)
            assert path.stat().st_mode & 0o777 == 0o600
            assert saved["seed"] == seed
            stage = "restoring"
            with InvisiblePlaywright(seed=saved["seed"], headless=True, timezone="UTC", locale="en-US", extra_prefs=smoke.BROWSER_EXTRA_PREFS) as browser:
                page = offline_page(browser)
                assert smoke.reuse_session(page, saved, FEED) == "reused"
                assert any(cookie["name"] == "reddit_session" and cookie["value"] == COOKIE_VALUE for cookie in page.context.cookies())
                assert page.evaluate_read("name => localStorage.getItem(name)", STORAGE_KEY) == STORAGE_VALUE
                assert page.evaluate_read("() => document.documentElement.dataset.restoredBeforePageScript") == "yes"
                stage = "checking init script removal"
                page.evaluate("name => localStorage.setItem(name, 'fresh-after-restore')", STORAGE_KEY)
                page.goto(FEED + "?offline-check=second", wait_until="domcontentloaded", timeout=15000)
                assert page.evaluate_read("name => localStorage.getItem(name)", STORAGE_KEY) == "fresh-after-restore"
            stage = "checking one-browser batch reuse and partial failures"
            check_batch_runtime(saved, directory)
        print("Offline Firefox session roundtrip passed.")
        return 0
    except AssertionError as error:
        print("Offline Firefox session roundtrip failed while " + stage + ": " + (str(error) or "fixture assertion failed") + ".", file=sys.stderr)
        return 1
    except Exception:
        print("Offline Firefox session roundtrip failed while " + stage + ".", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
