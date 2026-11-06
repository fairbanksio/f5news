"""Check cookie and local storage reuse in real Firefox without network access."""

import sys
import json
import tempfile
from pathlib import Path
from urllib.parse import quote
from unittest.mock import patch

import smoke
from invisible_playwright import InvisiblePlaywright

FEED = "https://www.reddit.com/r/politics/rising/"
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


def check_navigation_http(browser):
    for status, expected in ((403, "navigation_http_rejected"), (429, "navigation_rate_limited")):
        page = browser.new_page()
        requests = []
        def fulfill(route):
            if route.request.is_navigation_request():
                requests.append(True)
            headers = {"content-type": "text/html", "content-length": "0", "set-cookie": "fixture=never-log-this-header; Secure; Path=/"}
            if status == 429:
                headers["retry-after"] = "60"
            else:
                headers["cf-mitigated"] = "challenge"
            route.fulfill(status=status, headers=headers, body="")
        page.route("https://www.reddit.com/**", fulfill)
        messages = []
        with patch.object(smoke, "log", side_effect=messages.append):
            try:
                smoke.navigate(page, "https://www.reddit.com/offline-status-check", timeout=5000)
            except smoke.SessionError as error:
                assert error.code == expected and error.http_status == status
                assert error.retry_after_seconds == (60 if status == 429 else None)
            else:
                raise AssertionError("The offline HTTP fixture was not rejected")
        assert len(requests) == 1
        events = [json.loads(message) for message in messages if message.startswith("{")]
        assert events == [{"eventType": "BROWSER_NAVIGATION_HTTP", "status": status,
                           "retryAfterSeconds": 60 if status == 429 else None, "contentLength": 0,
                           "challenge": status == 403}]
        assert not any("never-log-this-header" in message or "https://" in message or "set-cookie" in message for message in messages)
        page.close()


def main():
    stage = "starting"
    try:
        with tempfile.TemporaryDirectory() as directory, smoke.browser_lifecycle():
            path = Path(directory) / "session.json"
            seed = 12345
            stage = "exporting"
            with InvisiblePlaywright(seed=seed, headless=True, timezone="UTC", locale="en-US") as browser:
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
                stage = "checking offline HTTP response diagnostics"
                check_navigation_http(browser)
            stage = "reading saved session state"
            saved = smoke.read_session(path)
            assert path.stat().st_mode & 0o777 == 0o600
            assert saved["seed"] == seed
            stage = "restoring"
            with InvisiblePlaywright(seed=saved["seed"], headless=True, timezone="UTC", locale="en-US") as browser:
                page = offline_page(browser)
                assert smoke.reuse_session(page, saved, FEED) == "reused"
                assert any(cookie["name"] == "reddit_session" and cookie["value"] == COOKIE_VALUE for cookie in page.context.cookies())
                assert page.evaluate_read("name => localStorage.getItem(name)", STORAGE_KEY) == STORAGE_VALUE
                assert page.evaluate_read("() => document.documentElement.dataset.restoredBeforePageScript") == "yes"
                stage = "checking init script removal"
                page.evaluate("name => localStorage.setItem(name, 'fresh-after-restore')", STORAGE_KEY)
                page.goto(FEED + "?offline-check=second", wait_until="domcontentloaded", timeout=15000)
                assert page.evaluate_read("name => localStorage.getItem(name)", STORAGE_KEY) == "fresh-after-restore"
        print("Offline Firefox session roundtrip passed.")
        return 0
    except Exception:
        print("Offline Firefox session roundtrip failed while " + stage + ".", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
