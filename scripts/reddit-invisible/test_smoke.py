import argparse
import json
import io
import os
import signal
import subprocess
import sys
import tempfile
import types
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch

import smoke


class LifecycleTests(unittest.TestCase):
    def display(self, fail=False):
        events = []

        class Display:
            _proc = object()

            def start(self):
                events.append("started")
                if fail:
                    raise smoke.BrowserCancelled("cancelled during startup")

            def stop(self):
                self._proc = None
                events.append("stopped")

        return Display(), events

    def test_sigterm_unwinds_cleanup_and_restores_hooks(self):
        display, events = self.display()
        factory = lambda: display
        session = types.SimpleNamespace(make_virtual_display=factory)
        module = types.SimpleNamespace(_session=session)
        previous = signal.getsignal(signal.SIGTERM)
        messages = []
        identity = {"pid": 123, "pgid": 123, "startTime": "456"}
        with patch.dict(sys.modules, {"invisible_playwright": module}), patch.object(smoke, "display_identity", return_value=identity), patch.object(smoke, "log", side_effect=messages.append):
            with self.assertRaises(smoke.BrowserCancelled):
                with smoke.browser_lifecycle():
                    owned = session.make_virtual_display()
                    owned.start()
                    try:
                        signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
                    finally:
                        owned.stop()
        self.assertEqual(events, ["started", "stopped"])
        self.assertIs(session.make_virtual_display, factory)
        self.assertIs(signal.getsignal(signal.SIGTERM), previous)
        self.assertEqual([json.loads(message)["eventType"] for message in messages], ["BROWSER_OWNED_DISPLAY", "BROWSER_DISPLAY_STOPPED"])

    def test_cancel_during_display_start_still_reports_and_stops_it(self):
        display, events = self.display(fail=True)
        session = types.SimpleNamespace(make_virtual_display=lambda: display)
        module = types.SimpleNamespace(_session=session)
        messages = []
        with patch.dict(sys.modules, {"invisible_playwright": module}), patch.object(smoke, "display_identity", return_value={"pid": 123, "pgid": 123, "startTime": "456"}), patch.object(smoke, "log", side_effect=messages.append):
            with smoke.browser_lifecycle(), self.assertRaises(smoke.BrowserCancelled):
                session.make_virtual_display().start()
        self.assertEqual(events, ["started", "stopped"])
        self.assertEqual(len(messages), 2)


def sample_post(post_type="link"):
    return {"attributes": {"id": "t3_example", "subreddit-name": "politics", "permalink": "/r/politics/comments/example/story/",
                           "content-href": "https://example.com/story", "post-title": "Story", "author": "reporter",
                           "created-timestamp": "2026-11-06T05:42:36Z", "score": "12", "comment-count": "4", "post-type": post_type},
            "images": [], "thumbnail": None, "video": None, "mediaComplete": post_type != "gallery"}


class SmokeTests(unittest.TestCase):
    def test_navigation_races_are_loading_but_other_errors_propagate(self):
        page = types.SimpleNamespace(evaluate_read=lambda _expression: (_ for _ in ()).throw(RuntimeError("Execution context was destroyed")))
        self.assertEqual(smoke.state(page), "loading")
        page.evaluate_read = lambda _expression: (_ for _ in ()).throw(RuntimeError("Browser closed"))
        with self.assertRaisesRegex(RuntimeError, "Browser closed"):
            smoke.state(page)

    def test_options_restrict_targets_and_limits(self):
        self.assertEqual(smoke.options(["--subreddit", "economics"]).subreddit, "Economics")
        self.assertEqual(smoke.options(["--subreddit", "Economics"]).subreddit, "Economics")
        with self.assertRaises(SystemExit):
            smoke.options(["--subreddit", "woodworking"])
        with self.assertRaises(SystemExit):
            smoke.options(["--limit", "26"])

    def test_visible_checkbox_is_clicked_once_then_feed_metadata_is_read(self):
        events = []
        states = iter(["challenge", "feed"])
        raw = sample_post()

        class Checkbox:
            def is_visible(self, **_kwargs):
                return True

            def click(self, **_kwargs):
                events.append("click")

        class Page:
            def on(self, *_args):
                pass

            def goto(self, url, **_kwargs):
                self.url = url

            def frame_locator(self, _selector):
                return types.SimpleNamespace(locator=lambda _anchor: Checkbox())

            def evaluate(self, expression, *_args):
                return next(states) if "return 'challenge'" in expression else [raw]

            evaluate_read = evaluate

        class Browser:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                events.append("closed")

            def new_page(self):
                return Page()

            def on(self, *_args):
                pass

        module = types.SimpleNamespace(InvisiblePlaywright=Browser)
        with patch.dict(sys.modules, {"invisible_playwright": module}), patch.object(smoke.time, "sleep"):
            result = smoke.run(argparse.Namespace(subreddit="politics", limit=1))
        self.assertEqual(result["status"], "accessible")
        self.assertEqual(result["posts"], [raw])
        self.assertEqual(events, ["click", "closed"])


class AuthenticationTests(unittest.TestCase):
    def test_authentication_is_explicitly_opted_in(self):
        self.assertFalse(smoke.options([]).authenticate)
        self.assertTrue(smoke.options(["--authenticate"]).authenticate)

    def test_logs_redact_mongo_and_reddit_credentials(self):
        secrets = {"MONGO_CONNECTION_STRING": "mongodb://private-host/database", "REDDIT_USERNAME": "private-account",
                   "REDDIT_PASSWORD": "private-password", "REDDIT_CLIENT_ID": "private-client-id", "REDDIT_SECRET_KEY": "private-client-secret"}
        output = io.StringIO()
        with patch.dict(os.environ, secrets), patch.object(sys, "stderr", output):
            smoke.log("Failure: " + " ".join(secrets.values()) + " https://example.com/path?token=private-token")
        for secret in [*secrets.values(), "private-token"]:
            self.assertNotIn(secret, output.getvalue())
        self.assertIn("[redacted]", output.getvalue())

    def login_page(self):
        events = []

        class Field:
            def __init__(self, name):
                self.name = name

            def count(self):
                return 1

            def is_visible(self):
                return True

            def is_enabled(self):
                raise AssertionError("Click must wait for enabled state rather than sample it immediately")

            def fill(self, value, **_kwargs):
                events.append(("fill", self.name, value))

            def click(self, **_kwargs):
                events.append(("click", self.name))

            def get_by_role(self, *_args, **_kwargs):
                return Field("submit")

        page = types.SimpleNamespace(
            url="https://www.reddit.com/login/",
            goto=lambda url, **_kwargs: events.append(("goto", url)),
            locator=lambda selector: Field(selector),
            context=types.SimpleNamespace(cookies=lambda: []),
        )
        return page, events

    def test_missing_credentials_never_navigates_or_fills(self):
        page, events = self.login_page()
        with patch.dict(os.environ, {"REDDIT_USERNAME": "", "REDDIT_PASSWORD": ""}):
            self.assertEqual(smoke.authenticate_once(page, "https://www.reddit.com/r/politics/rising/"), "auth_credentials_missing")
        self.assertEqual(events, [])

    def test_login_submits_once_then_requires_session_and_feed(self):
        page, events = self.login_page()
        access = iter(["login", "loading"])
        credentials = {"REDDIT_USERNAME": "test-account", "REDDIT_PASSWORD": "test-password"}
        with patch.dict(os.environ, credentials), patch.object(smoke, "login_state", side_effect=lambda _page: next(access)), patch.object(smoke, "has_account_session", return_value=True), patch.object(smoke, "state", return_value="feed"):
            result = smoke.authenticate_once(page, "https://www.reddit.com/r/politics/rising/")
        self.assertEqual(result, "authenticated")
        self.assertEqual(sum(event[0] == "click" for event in events), 1)
        self.assertEqual(sum(event[0] == "fill" for event in events), 2)
        self.assertEqual(events[-1], ("goto", "https://www.reddit.com/r/politics/rising/"))

    def test_login_challenge_or_block_prevents_fill(self):
        for access in ("challenge", "blocked"):
            page, events = self.login_page()
            with patch.dict(os.environ, {"REDDIT_USERNAME": "test-account", "REDDIT_PASSWORD": "test-password"}), patch.object(smoke, "login_state", return_value=access):
                self.assertEqual(smoke.authenticate_once(page, "https://www.reddit.com/r/politics/rising/"), "auth_" + access)
            self.assertEqual([event[0] for event in events], ["goto"])

    def test_failed_credentials_or_challenge_after_submission_never_retries(self):
        for access in ("failed", "challenge", "blocked"):
            page, events = self.login_page()
            states = iter(["login", access])
            with patch.dict(os.environ, {"REDDIT_USERNAME": "test-account", "REDDIT_PASSWORD": "test-password"}), patch.object(smoke, "login_state", side_effect=lambda _page: next(states)):
                result = smoke.authenticate_once(page, "https://www.reddit.com/r/politics/rising/")
            self.assertEqual(result, "auth_" + access)
            self.assertEqual(sum(event[0] == "click" for event in events), 1)

    def test_successful_feed_without_account_session_is_unverified(self):
        page, events = self.login_page()
        with patch.dict(os.environ, {"REDDIT_USERNAME": "test-account", "REDDIT_PASSWORD": "test-password"}), patch.object(smoke, "login_state", side_effect=["login", "loading"]), patch.object(smoke, "has_account_session", side_effect=[True, False]), patch.object(smoke, "state", return_value="feed"):
            self.assertEqual(smoke.authenticate_once(page, "https://www.reddit.com/r/politics/rising/"), "auth_unverified")
        self.assertEqual(sum(event[0] == "click" for event in events), 1)

    def test_login_redirect_to_another_site_never_receives_credentials(self):
        page, events = self.login_page()
        page.url = "https://evil.example/login/"
        with patch.dict(os.environ, {"REDDIT_USERNAME": "test-account", "REDDIT_PASSWORD": "test-password"}), patch.object(smoke, "login_state", return_value="login"):
            self.assertEqual(smoke.authenticate_once(page, "https://www.reddit.com/r/politics/rising/"), "auth_login_unavailable")
        self.assertEqual([event[0] for event in events], ["goto"])

    def test_auth_session_cookie_is_required_and_never_logged(self):
        page, _events = self.login_page()
        for cookie, expected in [({"name": "csrf_token", "value": "anonymous", "domain": ".reddit.com"}, False),
                                 ({"name": "token_v2", "value": "anonymous", "domain": ".reddit.com"}, False),
                                 ({"name": "reddit_session", "value": "session-secret", "domain": ".reddit.com"}, True),
                                 ({"name": "token_v2", "value": "session-secret", "domain": "evil.example"}, False)]:
            page.context.cookies = lambda: [cookie]
            self.assertEqual(smoke.has_account_session(page), expected)

    def test_exception_redaction_precedes_truncation(self):
        secret = "private-password-crossing-log-boundary"
        error = RuntimeError("x" * 1190 + secret + " trailing details")
        output = io.StringIO()
        with patch.dict(os.environ, {"REDDIT_PASSWORD": secret}), patch.object(smoke, "options", return_value=argparse.Namespace()), patch.object(smoke, "browser_lifecycle", return_value=nullcontext()), patch.object(smoke, "run", side_effect=error), patch.object(smoke, "log_resources"), patch.object(sys, "stderr", output):
            self.assertEqual(smoke.main(), 1)
        self.assertNotIn(secret[:10], output.getvalue())
        self.assertIn("[redacted]", output.getvalue())

    def test_auth_failure_cli_returns_nonzero_with_no_posts(self):
        output = io.StringIO()
        config = argparse.Namespace(subreddit="politics", limit=1, authenticate=True)
        with patch.object(smoke, "options", return_value=config), patch.object(smoke, "browser_lifecycle", return_value=nullcontext()), patch.object(smoke, "run", return_value={"status": "auth_failed", "posts": []}), patch.object(smoke, "log_resources"), patch.object(sys, "stdout", output):
            self.assertEqual(smoke.main(), 2)
        self.assertEqual(json.loads(output.getvalue())["posts"], [])


class GalleryTests(unittest.TestCase):
    def page(self, details):
        calls = []
        page = types.SimpleNamespace(
            goto=lambda url, **kwargs: calls.append((url, kwargs)),
            evaluate_read=lambda reader, args: details,
        )
        return page, calls

    def test_gallery_detail_keeps_listing_core_and_adds_complete_images(self):
        listing = sample_post("gallery")
        detail = sample_post("gallery")
        detail["attributes"]["score"] = "999"
        detail["attributes"]["created-timestamp"] = "different"
        detail.update(images=[{"id": "image1", "url": "https://i.redd.it/image1.jpg"}], mediaComplete=True)
        page, calls = self.page([detail])
        with patch.object(smoke, "state", return_value="feed"):
            result = smoke.enrich_gallery(page, "reader", listing, "politics")
        self.assertEqual(result["attributes"], listing["attributes"])
        self.assertEqual(result["images"], detail["images"])
        self.assertTrue(result["mediaComplete"])
        self.assertEqual(result["thumbnail"], detail["images"][0]["url"])
        self.assertEqual(calls[0][0], "https://www.reddit.com/r/politics/comments/example/story/")
        self.assertEqual(listing["images"], [])

    def test_gallery_reader_uses_detail_mode(self):
        observed = []
        detail = {**sample_post("gallery"), "mediaComplete": True,
                  "images": [{"id": "image1", "url": "https://i.redd.it/image1.jpg"}]}
        page, _calls = self.page([detail])
        page.evaluate_read = lambda reader, args: observed.append((reader, args)) or [detail]
        with patch.object(smoke, "state", return_value="feed"):
            smoke.enrich_gallery(page, "shared-reader", sample_post("gallery"), "politics")
        self.assertEqual(observed, [("shared-reader", {"detail": True})])

    def test_external_or_mismatched_gallery_links_fail_before_navigation(self):
        for permalink in ["https://evil.example/r/politics/comments/example/story/", "/r/news/comments/example/story/", "/r/politics/comments/wrong/story/"]:
            listing = sample_post("gallery")
            listing["attributes"]["permalink"] = permalink
            page, calls = self.page([])
            with self.assertRaisesRegex(RuntimeError, "does not match"):
                smoke.enrich_gallery(page, "reader", listing, "politics")
            self.assertEqual(calls, [])

    def test_gallery_detail_rejects_missing_post_partial_or_invalid_images(self):
        detail = {**sample_post("gallery"), "mediaComplete": True,
                  "images": [{"id": "image1", "url": "https://i.redd.it/image1.jpg"}]}
        for details in [[], [sample_post("gallery")], [{**detail, "mediaComplete": False}],
                        [{**detail, "images": [{"id": "image1", "url": "javascript:alert(1)"}]}],
                        [{**detail, "images": detail["images"] * 2}]]:
            with self.subTest(details=details):
                page, _calls = self.page(details)
                with patch.object(smoke, "state", return_value="feed"), self.assertRaises(RuntimeError):
                    smoke.enrich_gallery(page, "reader", sample_post("gallery"), "politics")

    def test_detail_block_or_navigation_error_propagates(self):
        for access in ["blocked", "challenge"]:
            page, _calls = self.page([])
            with patch.object(smoke, "state", return_value=access), self.assertRaisesRegex(RuntimeError, access):
                smoke.enrich_gallery(page, "reader", sample_post("gallery"), "politics")
        page, _calls = self.page([])
        page.goto = lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("navigation failed"))
        with self.assertRaisesRegex(RuntimeError, "navigation failed"):
            smoke.enrich_gallery(page, "reader", sample_post("gallery"), "politics")

    def test_gallery_failure_closes_browser_and_does_not_return_accessible(self):
        events = []
        listing = sample_post("gallery")

        class Page:
            def on(self, *_args):
                pass

            def goto(self, url, **_kwargs):
                events.append(url)

            def evaluate_read(self, _reader, _args):
                return [listing]

        class Browser:
            def __init__(self, **_kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                events.append("closed")

            def on(self, *_args):
                pass

            def new_page(self):
                return Page()

        module = types.SimpleNamespace(InvisiblePlaywright=Browser)
        with patch.dict(sys.modules, {"invisible_playwright": module}), patch.object(smoke, "state", return_value="feed"):
            with self.assertRaisesRegex(RuntimeError, "missing complete image metadata"):
                smoke.run(argparse.Namespace(subreddit="politics", limit=1))
        self.assertEqual(events[-1], "closed")
        self.assertEqual(len(events), 3)

    def test_malformed_reader_or_missing_core_never_reports_success(self):
        for payload in [None, {}, [None], [{"attributes": None}]]:
            page, _calls = self.page(payload)
            with self.assertRaises(RuntimeError):
                smoke.read_posts(page, "reader")
        for field in smoke.CORE_ATTRIBUTES:
            post = sample_post()
            post["attributes"][field] = None
            with self.assertRaisesRegex(RuntimeError, "incomplete"):
                smoke.validate_core(post)


class NativeRunnerTests(unittest.TestCase):
    def check_runner(self, architecture):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            docker = root / "docker"
            docker.write_text("""#!/usr/bin/env python3
import json, os, sys
with open(os.environ['TEST_DOCKER_LOG'], 'a') as output:
    output.write(json.dumps(sys.argv[1:]) + '\\n')
if sys.argv[1] == 'info':
    print(os.environ['TEST_DOCKER_ARCH'])
""")
            docker.chmod(0o755)
            logfile = root / "calls.jsonl"
            env = {**os.environ, "PATH": directory + os.pathsep + os.environ["PATH"], "TEST_DOCKER_ARCH": architecture, "TEST_DOCKER_LOG": str(logfile)}
            result = subprocess.run(["bash", str(smoke.ROOT / "run-local.sh"), "--subreddit", "politics"], env=env, text=True, capture_output=True)
            return result, [json.loads(line) for line in logfile.read_text().splitlines()]

    def test_runner_uses_daemon_native_architecture_for_build_and_run(self):
        for daemon, platform in [("aarch64", "linux/arm64"), ("x86_64", "linux/amd64")]:
            with self.subTest(daemon=daemon):
                result, calls = self.check_runner(daemon)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual([call[0] for call in calls], ["info", "build", "run"])
                for call in calls[1:]:
                    self.assertEqual(call[call.index("--platform") + 1], platform)
                self.assertEqual(calls[-1][-2:], ["--subreddit", "politics"])

    def test_unsupported_architecture_stops_before_building(self):
        result, calls = self.check_runner("unsupported")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([call[0] for call in calls], ["info"])


if __name__ == "__main__":
    unittest.main()
