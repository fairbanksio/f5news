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
    def test_opt_in_challenge_evidence_creates_one_private_viewport_jpeg(self):
        image = b"\xff\xd8\xffimage\xff\xd9"
        page = types.SimpleNamespace(url=smoke.CHALLENGE_LISTING_URL,
                                     evaluate_read=lambda _: {"state": "challenge"})
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "challenge.jpg"
            with patch.dict(os.environ, {"F5_CHALLENGE_SCREENSHOT_PATH": str(target)}), \
                    patch.object(page, "screenshot", create=True, return_value=image) as screenshot:
                self.assertEqual(smoke.state(page), "challenge")
                self.assertEqual(smoke.state(page), "challenge")
                screenshot.assert_called_once_with(type="jpeg", quality=70, full_page=False, scale="css", timeout=1500)
            self.assertEqual(target.read_bytes(), image)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_screenshot_excludes_other_pages_states_and_unconfigured_runs(self):
        page = types.SimpleNamespace(evaluate_read=lambda _: {"state": "challenge"})
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "challenge.jpg"
            with patch.dict(os.environ, {"F5_CHALLENGE_SCREENSHOT_PATH": str(target)}), \
                    patch.object(page, "screenshot", create=True) as screenshot:
                for url in ("https://www.reddit.com/login/", "https://www.reddit.com/r/politics/comments/id/",
                            smoke.CHALLENGE_LISTING_URL + "?token=private", "https://other.example/r/politics/rising/"):
                    page.url = url
                    self.assertEqual(smoke.state(page), "challenge")
                page.url = smoke.CHALLENGE_LISTING_URL
                page.evaluate_read = lambda _: {"state": "feed"}
                self.assertEqual(smoke.state(page), "feed")
                os.environ.pop("F5_CHALLENGE_SCREENSHOT_PATH")
                smoke.capture_listing_challenge(page)
                screenshot.assert_not_called()
            self.assertFalse(target.exists())

    def test_invalid_or_failed_screenshot_does_not_change_challenge_result(self):
        page = types.SimpleNamespace(url=smoke.CHALLENGE_LISTING_URL,
                                     evaluate_read=lambda _: {"state": "challenge"})
        for image in (b"not jpeg", b"\xff\xd8\xff" + b"x" * smoke.MAX_CHALLENGE_SCREENSHOT_BYTES + b"\xff\xd9",
                      RuntimeError("screenshot timed out")):
            with self.subTest(result=type(image).__name__), tempfile.TemporaryDirectory() as directory:
                target = Path(directory) / "challenge.jpg"
                def screenshot(**_kwargs):
                    if isinstance(image, Exception):
                        raise image
                    return image
                page.screenshot = screenshot
                with patch.dict(os.environ, {"F5_CHALLENGE_SCREENSHOT_PATH": str(target)}):
                    self.assertEqual(smoke.state(page), "challenge")
                self.assertFalse(target.exists())

    def test_page_access_logs_only_bounded_verification_evidence(self):
        evidence = {"state": "challenge", "marker": "verify_human", "hasPosts": False,
                    "titleMatch": True, "dialogVisible": False, "verificationFrame": True}
        page = types.SimpleNamespace(evaluate_read=lambda _expression: evidence)
        with patch.object(smoke, "log") as log:
            self.assertEqual(smoke.state(page), "challenge")
            self.assertEqual(json.loads(log.call_args.args[0]),
                             {"eventType": "BROWSER_PAGE_ACCESS", **evidence})
            log.reset_mock()
            evidence = {"state": "feed"}
            self.assertEqual(smoke.state(page), "feed")
            log.assert_not_called()

    def test_navigation_races_are_loading_but_other_errors_propagate(self):
        page = types.SimpleNamespace(evaluate_read=lambda _expression: (_ for _ in ()).throw(RuntimeError("Execution context was destroyed")))
        self.assertEqual(smoke.state(page), "loading")
        page.evaluate_read = lambda _expression: (_ for _ in ()).throw(RuntimeError("Browser closed"))
        with self.assertRaisesRegex(RuntimeError, "Browser closed"):
            smoke.state(page)

    def test_options_restrict_targets_and_limits(self):
        configured = json.loads(smoke.SUBREDDITS.read_text())
        self.assertEqual(configured, ["politics"])
        for feed in configured:
            self.assertEqual(smoke.options(["--subreddit", feed.upper()]).subreddit, feed)
        alternate = types.SimpleNamespace(read_text=lambda: '["MixedCase"]')
        with patch.object(smoke, "SUBREDDITS", alternate):
            self.assertEqual(smoke.options(["--subreddit", "mixedcase"]).subreddit, "MixedCase")
        for feed in ("news", "worldnews", "economics", "science", "technology", "europe", "health", "energy", "sports", "business"):
            with self.assertRaises(SystemExit):
                smoke.options(["--subreddit", feed])
        with self.assertRaises(SystemExit):
            smoke.options(["--subreddit", "woodworking"])
        with self.assertRaises(SystemExit):
            smoke.options(["--limit", "26"])

    def test_challenge_closes_browser_before_reading_posts(self):
        events = []

        class Page:
            def on(self, *_args):
                pass

            def goto(self, url, **_kwargs):
                self.url = url

            def evaluate(self, expression, *_args):
                if "verificationFrame" not in expression:
                    raise AssertionError("A challenged page must not be scraped")
                return {"state": "challenge", "marker": "verify_human", "hasPosts": False,
                        "titleMatch": False, "dialogVisible": False, "verificationFrame": True}

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
        self.assertEqual(result["status"], "challenge_required")
        self.assertEqual(result["sessionReason"], "feed_challenge")
        self.assertEqual(result["posts"], [])
        self.assertEqual(events, ["closed"])


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

    def login_page(self, click_error=None):
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
                if click_error:
                    raise click_error

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

    def test_dispatched_descendant_click_observes_success_without_resubmitting(self):
        error = RuntimeError("Locator.click: the action went out but did not reach the element: mouseup landed on span.flex.items-center.gap-xs")
        page, events = self.login_page(click_error=error)
        with patch.dict(os.environ, {"REDDIT_USERNAME": "test-account", "REDDIT_PASSWORD": "test-password"}), patch.object(smoke, "login_state", side_effect=["login", "loading"]), patch.object(smoke, "has_account_session", return_value=True), patch.object(smoke, "state", return_value="feed"):
            self.assertEqual(smoke.authenticate_once(page, "https://www.reddit.com/r/politics/rising/"), "authenticated")
        self.assertEqual(sum(event[0] == "click" for event in events), 1)

    def test_dispatched_click_observes_rejection_or_challenge_without_resubmitting(self):
        for state in ("failed", "challenge", "blocked"):
            error = RuntimeError("the action went out but did not reach the element: mouseup landed on span.flex")
            page, events = self.login_page(click_error=error)
            with patch.dict(os.environ, {"REDDIT_USERNAME": "test-account", "REDDIT_PASSWORD": "test-password"}), patch.object(smoke, "login_state", side_effect=["login", state]):
                self.assertEqual(smoke.authenticate_once(page, "https://www.reddit.com/r/politics/rising/"), "auth_" + state)
            self.assertEqual(sum(event[0] == "click" for event in events), 1)

    def test_dispatched_click_without_account_session_stays_unverified(self):
        error = RuntimeError("the action went out but did not reach the element: mouseup landed on span.flex")
        page, events = self.login_page(click_error=error)
        with patch.dict(os.environ, {"REDDIT_USERNAME": "test-account", "REDDIT_PASSWORD": "test-password"}), patch.object(smoke, "login_state", side_effect=["login", "loading"]), patch.object(smoke, "has_account_session", return_value=False), patch.object(smoke.time, "monotonic", side_effect=[0, 1, 2, 3, 40]), patch.object(smoke.time, "sleep"):
            self.assertEqual(smoke.authenticate_once(page, "https://www.reddit.com/r/politics/rising/"), "auth_unverified")
        self.assertEqual(sum(event[0] == "click" for event in events), 1)

    def test_other_click_errors_propagate_without_another_attempt(self):
        for message in ("Timeout waiting for element", "NS_ERROR_NET_RESET", "mouseup landed on span.flex", "action went out but did not reach the element: mouseup was never sent"):
            page, events = self.login_page(click_error=RuntimeError(message))
            with patch.dict(os.environ, {"REDDIT_USERNAME": "test-account", "REDDIT_PASSWORD": "test-password"}), patch.object(smoke, "login_state", return_value="login"):
                with self.assertRaisesRegex(RuntimeError, message):
                    smoke.authenticate_once(page, "https://www.reddit.com/r/politics/rising/")
            self.assertEqual(sum(event[0] == "click" for event in events), 1)

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


class SessionTests(unittest.TestCase):
    def session(self):
        return {"version": 1, "seed": 12345, "cookies": [{"name": "reddit_session", "value": "private-session-cookie", "domain": ".reddit.com", "path": "/", "expires": -1, "secure": True, "httpOnly": True, "sameSite": "Lax"}],
                "origins": [{"origin": "https://www.reddit.com", "localStorage": [{"name": "account", "value": "private-storage-value"}]}]}

    def test_validation_reasons_distinguish_root_expiry_missing_and_malformed(self):
        for reason, change in [("root_cookie_expired", lambda data: data["cookies"][0].update(expires=1)),
                               ("root_cookie_missing", lambda data: data.update(cookies=[])),
                               ("invalid_data", lambda data: data.update(version=2))]:
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as directory:
                fixture = self.session()
                change(fixture)
                path = Path(directory) / "input.json"
                path.write_text(json.dumps(fixture))
                path.chmod(0o600)
                with self.assertRaises(smoke.SessionError) as caught:
                    smoke.read_session(path)
                self.assertEqual(caught.exception.code, reason)
                self.assertNotIn("private-session-cookie", str(caught.exception))

    def test_expired_same_name_subdomain_or_path_cookies_do_not_invalidate_root_cookie(self):
        for domain, path in [("oauth.reddit.com", "/"), (".reddit.com", "/unrelated")]:
            fixture = self.session()
            fixture["cookies"].append({**fixture["cookies"][0], "domain": domain, "path": path, "expires": 1})
            self.assertEqual(smoke.validate_session(fixture), self.session())

    def test_expired_root_cookie_is_dropped_when_another_valid_root_cookie_remains(self):
        fixture = self.session()
        fixture["cookies"].append({**fixture["cookies"][0], "domain": "reddit.com", "expires": 1})
        self.assertEqual(smoke.validate_session(fixture), self.session())

    def test_input_file_and_restore_errors_have_only_finite_reasons(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.json"
            path.write_text("private-session-cookie")
            path.chmod(0o600)
            with self.assertRaises(smoke.SessionError) as caught:
                smoke.read_session(path)
            self.assertEqual(caught.exception.code, "input_file_invalid")
        self.assertEqual(smoke.SessionError("safe", "private-session-cookie").code, "invalid_data")

    def test_restore_diagnostics_distinguish_cookie_loss_timeout_and_access_challenge(self):
        page = types.SimpleNamespace(context=types.SimpleNamespace(add_cookies=lambda _cookies: None),
                                     add_init_script=lambda **_kwargs: nullcontext(), goto=lambda *_args, **_kwargs: None)
        for state, reason in [("feed", "feed_cookie_missing"), ("blocked", "feed_blocked"), ("challenge", "feed_challenge")]:
            diagnostics = {}
            with patch.object(smoke, "state", return_value=state), patch.object(smoke, "has_account_session", return_value=False):
                smoke.reuse_session(page, self.session(), "https://www.reddit.com/r/politics/rising/", diagnostics=diagnostics)
            self.assertEqual(diagnostics, {"sessionReason": reason})
            self.assertNotIn("private-session-cookie", json.dumps(diagnostics))
        diagnostics = {}
        with patch.object(smoke.time, "monotonic", side_effect=[0, 61]):
            self.assertEqual(smoke.reuse_session(page, self.session(), "https://www.reddit.com/r/politics/rising/", diagnostics=diagnostics), "session_invalid")
        self.assertEqual(diagnostics, {"sessionReason": "feed_timeout"})

    def test_run_returns_finite_input_reason_before_browser_launch(self):
        module = types.SimpleNamespace(InvisiblePlaywright=lambda **_kwargs: self.fail("Invalid input must not launch a browser"))
        config = argparse.Namespace(subreddit="politics", limit=1, session_input=Path("/tmp/unused-input"))
        with patch.dict(sys.modules, {"invisible_playwright": module}), patch.object(smoke, "read_session", side_effect=smoke.SessionError("Session data is invalid", "root_cookie_expired")):
            result = smoke.run(config)
        self.assertEqual(result, {"status": "session_invalid", "sessionReason": "root_cookie_expired", "subreddit": "politics", "posts": []})

    def test_run_returns_restore_reason_and_closes_browser(self):
        closed = []
        page = types.SimpleNamespace(on=lambda *_args: None)

        class Browser:
            def __init__(self, **_kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                closed.append(True)

            def on(self, *_args):
                pass

            def new_page(self):
                return page

        config = argparse.Namespace(subreddit="politics", limit=1, session_input=Path("/tmp/unused-input"))
        with patch.dict(sys.modules, {"invisible_playwright": types.SimpleNamespace(InvisiblePlaywright=Browser)}), patch.object(smoke, "read_session", return_value=self.session()), patch.object(smoke, "reuse_session", side_effect=smoke.SessionError("Session could not be restored", "restore_exception")):
            result = smoke.run(config)
        self.assertEqual(result, {"status": "session_invalid", "sessionReason": "restore_exception", "subreddit": "politics", "posts": []})
        self.assertEqual(closed, [True])

    def test_roundtrip_and_private_output_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.json"
            smoke.write_session(path, self.session())
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(smoke.read_session(path), self.session())
            path.chmod(0o644)
            with self.assertRaisesRegex(smoke.SessionError, "Session input is invalid"):
                smoke.read_session(path)

    def test_session_rejects_malformed_external_and_expired_records(self):
        import copy
        mutations = [lambda data: data.update(version=2), lambda data: data.update(seed=True),
                     lambda data: data["cookies"][0].update(domain="evilreddit.com"),
                     lambda data: data["cookies"][0].update(expires=1),
                     lambda data: data["cookies"][0].update(name="token_v2"),
                     lambda data: data["cookies"][0].update(url="https://evil.example"),
                     lambda data: data["origins"][0].update(origin="https://evil.example"),
                     lambda data: data["origins"][0]["localStorage"][0].update(value={"secret": "value"}),
                     lambda data: data["cookies"].append(data["cookies"][0])]
        for mutate in mutations:
            data = copy.deepcopy(self.session())
            mutate(data)
            with self.assertRaisesRegex(smoke.SessionError, "Session data is invalid"):
                smoke.validate_session(data)

    def test_expired_non_account_cookies_are_dropped_without_expiring_session(self):
        fixture = self.session()
        fixture["cookies"].append({"name": "analytics", "value": "irrelevant-value", "domain": ".reddit.com", "path": "/", "expires": 1})
        self.assertEqual(smoke.validate_session(fixture), self.session())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.json"
            smoke.write_session(path, fixture)
            self.assertEqual(smoke.read_session(path), self.session())

    def test_session_size_limit_is_one_mib(self):
        fixture = self.session()
        fixture["origins"][0]["localStorage"][0]["value"] = "x" * smoke.MAX_SESSION_BYTES
        self.assertEqual(smoke.MAX_SESSION_BYTES, 1024 * 1024)
        with self.assertRaises(smoke.SessionError):
            smoke.validate_session(fixture)

    def test_session_io_errors_never_include_values(self):
        with patch.object(smoke, "validate_session", side_effect=RuntimeError("private-session-cookie private-storage-value")):
            with self.assertRaisesRegex(smoke.SessionError, "Session output could not be saved") as caught:
                smoke.write_session("/tmp/unused-session-test.json", self.session())
        self.assertNotIn("private-", str(caught.exception))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.json"
            path.write_text("private-session-cookie")
            path.chmod(0o600)
            with self.assertRaises(smoke.SessionError) as caught:
                smoke.read_session(path)
            self.assertNotIn("private-", str(caught.exception))

    def test_restore_uses_cookies_and_origin_scoped_init_then_removes_it(self):
        events = []
        class Script:
            def __enter__(self):
                events.append("script_enter")
            def __exit__(self, *_args):
                events.append("script_removed")
        page = types.SimpleNamespace(
            context=types.SimpleNamespace(add_cookies=lambda cookies: events.append(("cookies", cookies))),
            add_init_script=lambda **kwargs: events.append(("script", kwargs["script"])) or Script(),
            goto=lambda url, **kwargs: events.append(("goto", url)))
        with patch.object(smoke, "state", return_value="feed"), patch.object(smoke, "has_account_session", return_value=True):
            self.assertEqual(smoke.reuse_session(page, self.session(), "https://www.reddit.com/r/politics/rising/"), "reused")
        self.assertEqual(events[0], ("cookies", [{key: value for key, value in self.session()["cookies"][0].items() if key != "expires"}]))
        self.assertIn("item.origin === location.origin", events[1][1])
        self.assertEqual(events[-1], "script_removed")

    def test_restore_preserves_real_expiries_and_omits_only_session_sentinel(self):
        session = self.session()
        session["cookies"].append({"name": "persistent", "value": "fixture-persistent", "domain": ".reddit.com", "path": "/", "expires": 9999999999})
        added = []
        page = types.SimpleNamespace(context=types.SimpleNamespace(add_cookies=lambda cookies: added.extend(cookies)),
                                     add_init_script=lambda **_kwargs: nullcontext(), goto=lambda *_args, **_kwargs: None)
        with patch.object(smoke, "state", return_value="feed"), patch.object(smoke, "has_account_session", return_value=True):
            self.assertEqual(smoke.reuse_session(page, session, "https://www.reddit.com/r/politics/rising/"), "reused")
        self.assertNotIn("expires", added[0])
        self.assertEqual(added[1]["expires"], 9999999999)
        self.assertEqual(session["cookies"][0]["expires"], -1)

    def test_reuse_access_failure_does_not_authenticate(self):
        page = types.SimpleNamespace(context=types.SimpleNamespace(add_cookies=lambda _cookies: None),
                                     add_init_script=lambda **_kwargs: nullcontext(), goto=lambda *_args, **_kwargs: None)
        for state in ("blocked", "challenge", "feed"):
            with patch.object(smoke, "state", return_value=state), patch.object(smoke, "has_account_session", return_value=False), patch.object(smoke, "authenticate_once", side_effect=AssertionError("Must not log in")):
                expected = "session_invalid" if state == "feed" else "session_" + state
                self.assertEqual(smoke.reuse_session(page, self.session(), "https://www.reddit.com/r/politics/rising/"), expected)

    def test_restore_exception_is_generic_and_does_not_leak_script_values(self):
        page = types.SimpleNamespace(context=types.SimpleNamespace(add_cookies=lambda _cookies: None),
                                     add_init_script=lambda **kwargs: (_ for _ in ()).throw(RuntimeError(kwargs["script"])))
        with self.assertRaises(smoke.SessionError) as caught:
            smoke.reuse_session(page, self.session(), "https://www.reddit.com/r/politics/rising/")
        self.assertEqual(str(caught.exception), "Session could not be restored")
        self.assertEqual(caught.exception.code, "restore_exception")

    def test_export_reads_localstorage_separately_and_filters_third_party_cookies(self):
        cookies = [{**self.session()["cookies"][0], "size": 42, "session": True}] + [{"name": "foreign", "value": "foreign-value", "domain": ".example.com", "path": "/"}]
        page = types.SimpleNamespace(context=types.SimpleNamespace(cookies=lambda: cookies),
                                     evaluate_read=lambda _expression: self.session()["origins"][0])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.json"
            smoke.export_session(page, 12345, path)
            self.assertEqual(smoke.read_session(path), self.session())

    def test_run_reuses_saved_seed_without_credentials_and_refreshes_session(self):
        fixture = self.session()
        events = []
        class Page:
            context = types.SimpleNamespace(add_cookies=lambda cookies: events.append("cookies"), cookies=lambda: fixture["cookies"])
            def on(self, *_args):
                pass
            def add_init_script(self, **_kwargs):
                return nullcontext()
            def goto(self, url, **_kwargs):
                events.append(url)
            def evaluate_read(self, expression, *_args):
                return fixture["origins"][0] if "Object.entries(localStorage)" in expression else [sample_post()]
        class Browser:
            def __init__(self, **kwargs):
                events.append(kwargs)
            def __enter__(self):
                return self
            def __exit__(self, *_args):
                events.append("closed")
            def on(self, *_args):
                pass
            def new_page(self):
                return Page()
        module = types.SimpleNamespace(InvisiblePlaywright=Browser)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "session.json"
            config = argparse.Namespace(subreddit="politics", limit=1, authenticate=False, session_input=Path("/tmp/input-session"), session_output=output)
            with patch.dict(sys.modules, {"invisible_playwright": module}), patch.dict(os.environ, {"REDDIT_USERNAME": "", "REDDIT_PASSWORD": ""}), patch.object(smoke, "read_session", return_value=fixture), patch.object(smoke, "state", return_value="feed"), patch.object(smoke, "authenticate_once", side_effect=AssertionError("Must not log in")):
                result = smoke.run(config)
            self.assertEqual(result["status"], "accessible")
            self.assertEqual(events[0], {"headless": True, "seed": 12345, "extra_prefs": smoke.BROWSER_EXTRA_PREFS})
            self.assertEqual(smoke.read_session(output), fixture)
        self.assertEqual(events[-1], "closed")
        self.assertNotIn("https://www.reddit.com/login/", events)

    def test_session_cli_prevents_reuse_with_login_or_anonymous_export(self):
        self.assertEqual(smoke.options(["--session-input", "/tmp/input", "--session-output", "/tmp/output"]).session_input, Path("/tmp/input"))
        for args in [["--session-input", "/tmp/input", "--authenticate"], ["--session-output", "/tmp/output"]]:
            with self.assertRaises(SystemExit):
                smoke.options(args)


class NavigationTests(unittest.TestCase):
    def clock(self):
        clock = {"seconds": 0, "delays": []}
        def sleep(seconds):
            clock["delays"].append(seconds)
            clock["seconds"] += seconds
        return clock, lambda: clock["seconds"], sleep

    def test_transient_get_failure_retries_then_returns_the_successful_response(self):
        clock, now, sleep = self.clock()
        calls = []
        response = object()
        def goto(url, **kwargs):
            calls.append((url, kwargs))
            clock["seconds"] += 0.1
            if len(calls) == 1:
                raise RuntimeError("Page.goto: NS_ERROR_NET_EMPTY_RESPONSE")
            return response
        page = types.SimpleNamespace(goto=goto)
        self.assertIs(smoke.navigate(page, "https://www.reddit.com/r/news/rising/", now=now, sleep=sleep), response)
        self.assertEqual(len(calls), 2)
        self.assertEqual(clock["delays"], [1])
        self.assertLess(calls[1][1]["timeout"], calls[0][1]["timeout"])

    def test_network_errors_stop_after_three_attempts_with_one_total_budget(self):
        for code in ("NS_ERROR_NET_EMPTY_RESPONSE", "NS_ERROR_NET_RESET", "net::ERR_CONNECTION_RESET"):
            clock, now, sleep = self.clock()
            calls = []
            def goto(_url, **kwargs):
                calls.append(kwargs["timeout"])
                clock["seconds"] += 2
                raise RuntimeError("Page.goto: " + code)
            with self.assertRaises(smoke.SessionError) as caught:
                smoke.navigate(types.SimpleNamespace(goto=goto), "https://www.reddit.com", now=now, sleep=sleep)
            self.assertEqual(caught.exception.code, "navigation_network_error")
            self.assertEqual(len(calls), 3)
            self.assertEqual(clock["delays"], [1, 2])
            self.assertEqual(calls, [30000, 27000, 23000])
            self.assertLessEqual(clock["seconds"], 30)

    def test_small_optional_timeout_cannot_become_three_full_timeouts(self):
        clock, now, sleep = self.clock()
        calls = []
        def goto(_url, **kwargs):
            calls.append(kwargs["timeout"])
            clock["seconds"] += 2
            raise RuntimeError("NS_ERROR_NET_RESET")
        with self.assertRaises(smoke.SessionError):
            smoke.navigate(types.SimpleNamespace(goto=goto), "https://www.reddit.com", timeout=5000, now=now, sleep=sleep)
        self.assertEqual(calls, [5000, 2000])
        self.assertEqual(clock["seconds"], 5)
        self.assertEqual(clock["delays"], [1])

    def test_unrelated_errors_and_tokens_in_call_logs_are_not_retried(self):
        for message in ("Page.goto: Timeout exceeded", "Page.goto: NS_ERROR_UNKNOWN_HOST", "Page.goto: other error\nCall log: NS_ERROR_NET_RESET", "Page.goto: timeout at https://example.com/NS_ERROR_NET_RESET"):
            clock, now, sleep = self.clock()
            calls = []
            error = RuntimeError(message)
            def goto(_url, **_kwargs):
                calls.append(True)
                raise error
            with self.assertRaises(RuntimeError) as caught:
                smoke.navigate(types.SimpleNamespace(goto=goto), "https://www.reddit.com", now=now, sleep=sleep)
            self.assertIs(caught.exception, error)
            self.assertEqual(len(calls), 1)
            self.assertEqual(clock["delays"], [])

    def test_reuse_preserves_network_reason_without_declaring_cookie_expiry(self):
        page = types.SimpleNamespace(context=types.SimpleNamespace(add_cookies=lambda _cookies: None), add_init_script=lambda **_kwargs: nullcontext())
        with patch.object(smoke, "navigate", side_effect=smoke.SessionError("Browser navigation failed", "navigation_network_error")):
            with self.assertRaises(smoke.SessionError) as caught:
                smoke.reuse_session(page, SessionTests().session(), "https://www.reddit.com/r/news/rising/")
        self.assertEqual(caught.exception.code, "navigation_network_error")

    def test_network_failure_cli_emits_finite_reason_and_no_posts(self):
        for session_input, expected in ((None, "network_error"), (Path("/tmp/session.json"), "session_invalid")):
            output = io.StringIO()
            config = argparse.Namespace(subreddit="politics", session_input=session_input, authenticate=not session_input)
            with patch.object(smoke, "options", return_value=config), patch.object(smoke, "browser_lifecycle", return_value=nullcontext()), patch.object(smoke, "run", side_effect=smoke.SessionError("Browser navigation failed", "navigation_network_error")), patch.object(smoke, "log_resources"), patch.object(sys, "stdout", output):
                self.assertEqual(smoke.main(), 2)
            result = json.loads(output.getvalue())
            self.assertEqual(result["status"], expected)
            self.assertEqual(result["sessionReason"], "navigation_network_error")
            self.assertEqual(result["posts"], [])


class NavigationHTTPTests(unittest.TestCase):
    def response(self, status, headers=None, url="https://www.reddit.com/r/news/rising/", navigation=True, parent=None):
        request = types.SimpleNamespace(url=url, is_navigation_request=lambda: navigation, frame=types.SimpleNamespace(parent_frame=parent))
        return types.SimpleNamespace(request=request, status=status, headers=headers or {})

    def page(self, response, error=True, removable=True):
        events = {"observer": None, "calls": 0, "removed": False}
        def on(_event, callback):
            events["observer"] = callback
        def goto(*_args, **_kwargs):
            events["calls"] += 1
            events["observer"](response)
            if error:
                raise RuntimeError("Page.goto: NS_ERROR_NET_EMPTY_RESPONSE")
            return response
        def remove(_event, _callback):
            events["removed"] = True
        page = types.SimpleNamespace(on=on, goto=goto)
        if removable:
            page.remove_listener = remove
        return page, events

    def test_explicit_empty_denial_or_rate_limit_has_one_get_and_safe_metadata(self):
        for status, reason in ((401, "feed_challenge"), (403, "feed_challenge"), (429, "navigation_rate_limited"), (503, "feed_challenge")):
            response = self.response(status, {"retry-after": "60", "content-length": "0", "cf-mitigated": "challenge", "set-cookie": "private-cookie-value"})
            page, events = self.page(response)
            messages = []
            with patch.object(smoke, "log", side_effect=messages.append):
                with self.assertRaises(smoke.SessionError) as caught:
                    smoke.navigate(page, "https://www.reddit.com")
            self.assertEqual(caught.exception.code, reason)
            self.assertEqual(caught.exception.diagnostics(), {"sessionReason": reason, "httpStatus": status, "retryAfterSeconds": 60})
            self.assertEqual(events["calls"], 1)
            self.assertTrue(events["removed"])
            self.assertEqual(json.loads(messages[0]), {"eventType": "BROWSER_NAVIGATION_HTTP", "status": status, "retryAfterSeconds": 60, "contentLength": 0, "challenge": True})
            self.assertNotIn("private-cookie-value", "".join(messages))
            self.assertNotIn("https://", "".join(messages))

    def test_successful_goto_returning_403_is_still_a_single_rejection(self):
        page, events = self.page(self.response(403), error=False)
        with self.assertRaises(smoke.SessionError) as caught:
            smoke.navigate(page, "https://www.reddit.com")
        self.assertEqual(caught.exception.code, "navigation_http_rejected")
        self.assertEqual(events["calls"], 1)

    def test_main_listing_challenge_header_captures_without_changing_http_result(self):
        for status, headers, code, capture_expected in (
            (403, {"cf-mitigated": "challenge"}, "feed_challenge", True),
            (429, {}, "navigation_rate_limited", False),
            (403, {}, "navigation_http_rejected", False),
        ):
            page, events = self.page(self.response(status, headers, smoke.CHALLENGE_LISTING_URL), error=False)
            with patch.object(smoke, "capture_listing_challenge") as capture, self.assertRaises(smoke.SessionError) as caught:
                smoke.navigate(page, smoke.CHALLENGE_LISTING_URL)
            self.assertEqual(caught.exception.code, code)
            self.assertEqual(events["calls"], 1)
            self.assertEqual(capture.call_count, int(capture_expected))

    def test_only_reddit_main_document_responses_affect_navigation(self):
        for response in (self.response(403, navigation=False), self.response(403, parent=object()), self.response(403, url="https://evil.example/")):
            page, events = self.page(response)
            clock, now, sleep = NavigationTests().clock()
            messages = []
            with patch.object(smoke, "log", side_effect=messages.append):
                with self.assertRaises(smoke.SessionError) as caught:
                    smoke.navigate(page, "https://www.reddit.com", now=now, sleep=sleep)
            self.assertEqual(caught.exception.code, "navigation_network_error")
            self.assertEqual(events["calls"], 3)
            self.assertFalse(any("BROWSER_NAVIGATION_HTTP" in message for message in messages))

    def test_empty_5xx_still_uses_bounded_transient_retries(self):
        page, events = self.page(self.response(503, {"content-length": "0"}))
        clock, now, sleep = NavigationTests().clock()
        with self.assertRaises(smoke.SessionError) as caught:
            smoke.navigate(page, "https://www.reddit.com", now=now, sleep=sleep)
        self.assertEqual(events["calls"], 3)
        self.assertEqual(caught.exception.http_status, 503)
        self.assertEqual(caught.exception.code, "navigation_network_error")

    def test_normal_503_response_has_three_bounded_gets_instead_of_feed_wait(self):
        page, events = self.page(self.response(503, {"content-length": "0"}), error=False)
        clock, now, sleep = NavigationTests().clock()
        with self.assertRaises(smoke.SessionError) as caught:
            smoke.navigate(page, "https://www.reddit.com", timeout=5000, now=now, sleep=sleep)
        self.assertEqual(events["calls"], 3)
        self.assertEqual(clock["delays"], [1, 2])
        self.assertEqual(caught.exception.http_status, 503)
        self.assertEqual(caught.exception.code, "navigation_network_error")

    def test_callback_failures_do_not_break_success_and_late_callbacks_are_inactive(self):
        page, events = self.page(types.SimpleNamespace(), error=False, removable=False)
        messages = []
        with patch.object(smoke, "log", side_effect=messages.append):
            smoke.navigate(page, "https://www.reddit.com")
            events["observer"](self.response(403, {"set-cookie": "private-cookie-value"}))
        self.assertEqual(messages, [])
        self.assertEqual(events["calls"], 1)

    def test_http_failure_cli_preserves_finite_status_and_retry_metadata(self):
        for session_input, expected in ((None, "network_error"), (Path("/tmp/session.json"), "session_invalid")):
            output = io.StringIO()
            config = argparse.Namespace(subreddit="politics", session_input=session_input)
            error = smoke.SessionError("Browser navigation was rejected", "navigation_rate_limited", 429, 60)
            with patch.object(smoke, "options", return_value=config), patch.object(smoke, "browser_lifecycle", return_value=nullcontext()), patch.object(smoke, "run", side_effect=error), patch.object(smoke, "log_resources"), patch.object(sys, "stdout", output):
                self.assertEqual(smoke.main(), 2)
            result = json.loads(output.getvalue())
            self.assertEqual(result["status"], expected)
            self.assertEqual(result["httpStatus"], 429)
            self.assertEqual(result["retryAfterSeconds"], 60)
            self.assertEqual(result["posts"], [])

    def test_header_errors_keep_status_and_do_not_log_exception_values(self):
        class Response:
            status = 403
            request = self.response(403).request
            @property
            def headers(self):
                raise RuntimeError("private-cookie-value")
        page, events = self.page(Response())
        messages = []
        with patch.object(smoke, "log", side_effect=messages.append), self.assertRaises(smoke.SessionError) as caught:
            smoke.navigate(page, "https://www.reddit.com")
        self.assertEqual(caught.exception.http_status, 403)
        self.assertNotIn("private-cookie-value", "".join(messages))
        self.assertEqual(events["calls"], 1)


class SnapshotTests(unittest.TestCase):
    def test_single_feed_reads_one_snapshot_and_keeps_partial_media(self):
        events = []
        gallery = sample_post("gallery")
        gallery["thumbnail"] = "https://i.redd.it/cover.jpg"
        link = sample_post("link")
        link["attributes"].update(id="t3_link", permalink="/r/politics/comments/link/story/")

        class Page:
            def on(self, *_args):
                pass

            def goto(self, url, **_kwargs):
                events.append(url)

            def evaluate_read(self, _reader, args):
                if args != {"detail": False}:
                    raise AssertionError("Snapshot must read the listing")
                events.append("read")
                return [gallery, link]

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
            result = smoke.run(argparse.Namespace(subreddit="politics", limit=25))
        self.assertEqual(result["status"], "accessible")
        self.assertEqual(result["posts"], [gallery, link])
        self.assertEqual(events, ["https://www.reddit.com/r/politics/rising/", "read", "closed"])

    def test_malformed_reader_or_missing_core_never_reports_success(self):
        for payload in [None, {}, [None], [{"attributes": None}]]:
            page = types.SimpleNamespace(evaluate_read=lambda *_args: payload)
            with self.assertRaises(RuntimeError):
                smoke.read_posts(page, "reader")
        for field in smoke.CORE_ATTRIBUTES:
            post = sample_post()
            post["attributes"][field] = None
            with self.assertRaisesRegex(RuntimeError, "incomplete"):
                smoke.validate_core(post)


class BatchTests(unittest.TestCase):
    def setUp(self):
        self.deployed_catalog = smoke.SUBREDDITS
        fixture = types.SimpleNamespace(read_text=lambda: '["fixtureone", "fixturetwo", "fixturethree"]')
        self.enterContext(patch.object(smoke, "SUBREDDITS", fixture))

    def test_scheduled_batch_reads_only_politics(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(smoke, "SUBREDDITS", self.deployed_catalog):
            config, stats, fixture, browser = self.setup_batch(directory, limit=25)
            result = self.execute(config, stats, fixture, browser)
            self.assertEqual(result["status"], "accessible")
            self.assertEqual([item["subreddit"] for item in result["feeds"]], ["politics"])
            self.assertEqual(stats["requests"], ["https://www.reddit.com/r/politics/rising/"])
            self.assertEqual(len(result["feeds"][0]["posts"]), 1)

    def test_snapshot_does_not_reload_after_transient_navigation_failure(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(smoke, "SUBREDDITS", self.deployed_catalog):
            config, stats, fixture, browser = self.setup_batch(directory)
            stats.update(fail_on="politics", error=RuntimeError("Page.goto: NS_ERROR_NET_RESET"))
            result = self.execute(config, stats, fixture, browser)
            self.assertEqual(result["sessionReason"], "navigation_network_error")
            self.assertEqual(stats["requests"], ["https://www.reddit.com/r/politics/rising/"])

    def setup_batch(self, directory, **overrides):
        feeds = json.loads(smoke.SUBREDDITS.read_text())
        fixture = SessionTests().session()
        stats = {"launches": 0, "pages": 0, "requests": [], "restores": 0, "closed": 0, "feeds": feeds}
        config = argparse.Namespace(subreddit=feeds[0], limit=1, all_feeds=True, authenticate=False,
                                    session_input=Path(directory) / "input.json", session_output=Path(directory) / "output.json",
                                    batch_budget_seconds=130)
        for key, value in overrides.items():
            setattr(config, key, value)
        class Page:
            current = feeds[0]
            context = types.SimpleNamespace(cookies=lambda: fixture["cookies"])
            def __init__(self):
                self.context.add_cookies = lambda _cookies: stats.update(restores=stats["restores"] + 1)
            def on(self, *_args):
                pass
            def add_init_script(self, **_kwargs):
                return nullcontext()
            def goto(self, url, **_kwargs):
                self.current = url.split("/r/")[1].split("/")[0]
                stats["requests"].append(url)
                if stats.get("clock") is not None:
                    stats["clock"]["seconds"] += 1 if len(stats["requests"]) == 1 else 10
                if stats.get("fail_on") == self.current:
                    raise stats["error"]
            def evaluate_read(self, expression, *_args):
                if "Object.entries(localStorage)" in expression:
                    return fixture["origins"][0]
                post = sample_post()
                name = self.current.lower() + "0"
                post["attributes"].update(id="t3_" + name, **{"subreddit-name": self.current, "permalink": f"/r/{self.current}/comments/{name}/story/"})
                if stats.get("malformed") == self.current:
                    post["attributes"]["score"] = None
                return [post]
            def evaluate(self, *_args):
                raise AssertionError("Batch must not scroll")
            def locator(self, *_args):
                raise AssertionError("Batch session reuse must never access login controls")
        class Browser:
            def __init__(self, **kwargs):
                stats["launches"] += 1
                stats["kwargs"] = kwargs
            def __enter__(self):
                return self
            def __exit__(self, *_args):
                stats["closed"] += 1
            def on(self, *_args):
                pass
            def new_page(self):
                stats["pages"] += 1
                return Page()
        return config, stats, fixture, Browser

    def execute(self, config, stats, fixture, browser):
        module = types.SimpleNamespace(InvisiblePlaywright=browser)
        with patch.dict(sys.modules, {"invisible_playwright": module}), patch.object(smoke, "read_session", return_value=fixture), patch.object(smoke, "state", return_value="feed"), patch.object(smoke, "authenticate_once", side_effect=AssertionError("Reuse must not log in")):
            return smoke.run(config)

    def test_all_feeds_reuse_one_browser_page_and_session_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            config, stats, fixture, browser = self.setup_batch(directory)
            result = self.execute(config, stats, fixture, browser)
            self.assertEqual(result["status"], "accessible")
            self.assertEqual([item["subreddit"] for item in result["feeds"]], stats["feeds"])
            self.assertEqual(stats["launches"], 1)
            self.assertEqual(stats["pages"], 1)
            self.assertEqual(stats["restores"], 1)
            self.assertEqual(stats["closed"], 1)
            self.assertEqual(len(stats["requests"]), len(stats["feeds"]))
            self.assertEqual(smoke.read_session(config.session_output), fixture)

    def test_rate_limit_or_denial_preserves_prefix_and_stops_remaining_reads(self):
        for status, reason in ((429, "navigation_rate_limited"), (403, "navigation_http_rejected")):
            with tempfile.TemporaryDirectory() as directory:
                config, stats, fixture, browser = self.setup_batch(directory)
                failure_index = len(stats["feeds"]) // 2
                stats.update(fail_on=stats["feeds"][failure_index], error=smoke.SessionError("Browser navigation was rejected", reason, status, 60 if status == 429 else None))
                result = self.execute(config, stats, fixture, browser)
                self.assertEqual([item["subreddit"] for item in result["feeds"]], stats["feeds"][:failure_index])
                self.assertEqual(result["batchFailure"]["subreddit"], stats["feeds"][failure_index])
                self.assertEqual(result["batchFailure"]["httpStatus"], status)
                self.assertEqual(result["batchFailure"]["sessionReason"], reason)
                self.assertEqual(len(stats["requests"]), failure_index + 1)
                self.assertEqual(smoke.read_session(config.session_output), fixture)

    def test_failure_before_first_feed_has_no_accessible_prefix(self):
        with tempfile.TemporaryDirectory() as directory:
            config, stats, fixture, browser = self.setup_batch(directory)
            stats.update(fail_on=stats["feeds"][0], error=smoke.SessionError("Browser navigation was rejected", "navigation_rate_limited", 429))
            result = self.execute(config, stats, fixture, browser)
            self.assertEqual(result["status"], "session_invalid")
            self.assertEqual(result["posts"], [])
            self.assertNotIn("feeds", result)
            self.assertFalse(config.session_output.exists())

    def test_malformed_metadata_does_not_lose_earlier_valid_feeds_or_leak_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            config, stats, fixture, browser = self.setup_batch(directory)
            stats["malformed"] = stats["feeds"][1]
            result = self.execute(config, stats, fixture, browser)
            self.assertEqual(len(result["feeds"]), 1)
            self.assertEqual(result["batchFailure"], {"subreddit": stats["feeds"][1], "status": "runtime_error"})
            self.assertEqual(len(stats["requests"]), 2)

    def test_global_deadline_returns_completed_prefix_before_another_feed(self):
        with tempfile.TemporaryDirectory() as directory:
            config, stats, fixture, browser = self.setup_batch(directory, batch_budget_seconds=5)
            clock = {"seconds": 0}
            stats["clock"] = clock
            with patch.object(smoke.time, "monotonic", side_effect=lambda: clock["seconds"]):
                result = self.execute(config, stats, fixture, browser)
            self.assertEqual(len(result["feeds"]), 1)
            self.assertEqual(result["batchFailure"], {"subreddit": stats["feeds"][1], "status": "loading_timeout"})
            self.assertEqual(len(stats["requests"]), 2)

    def test_cancellation_returns_completed_prefix_without_more_http(self):
        with tempfile.TemporaryDirectory() as directory:
            config, stats, fixture, browser = self.setup_batch(directory)
            stats.update(fail_on=stats["feeds"][1], error=smoke.BrowserCancelled("cancelled"))
            result = self.execute(config, stats, fixture, browser)
            self.assertEqual(len(result["feeds"]), 1)
            self.assertEqual(result["batchFailure"]["status"], "loading_timeout")
            self.assertEqual(stats["closed"], 1)
            self.assertEqual(len(stats["requests"]), 2)

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
