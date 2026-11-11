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
        configured = json.loads(smoke.SUBREDDITS.read_text())
        for feed in configured:
            self.assertEqual(smoke.options(["--subreddit", feed.upper()]).subreddit, feed)
        alternate = types.SimpleNamespace(read_text=lambda: '["MixedCase"]')
        with patch.object(smoke, "SUBREDDITS", alternate):
            self.assertEqual(smoke.options(["--subreddit", "mixedcase"]).subreddit, "MixedCase")
        for feed in ("economics", "science", "technology", "europe", "health", "energy", "sports", "business"):
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
                if "return 'challenge'" not in expression:
                    raise AssertionError("A challenged page must not be scraped")
                return "challenge"

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


class LinkPreviewTests(unittest.TestCase):
    def posts(self, count=1):
        result = []
        for index in range(count):
            post = sample_post("link")
            post["attributes"].update(id=f"t3_item{index}", permalink=f"/r/politics/comments/item{index}/story/", score=str(index + 1))
            post["thumbnail"] = f"https://external-preview.redd.it/image{index}.jpg?width=140&s=small"
            result.append(post)
        return result

    def page(self, posts):
        events = []
        details = []
        def goto(url, **kwargs):
            events.append((url, kwargs))
            name = url.split("/comments/")[1].split("/")[0]
            source = next(post for post in posts if post["attributes"]["id"] == "t3_" + name)
            details[:] = [{**source, "attributes": {**source["attributes"], "score": "9999"},
                          "preview": {"images": [{"source": {"url": f"https://external-preview.redd.it/{name}.jpg?width=1080&s=published", "width": 1080}}]}}]
        return types.SimpleNamespace(goto=goto, evaluate_read=lambda *_args: details), events

    def test_optional_detail_preview_preserves_listing_core_and_image_signature(self):
        posts = self.posts()
        page, events = self.page(posts)
        with patch.object(smoke, "state", return_value="feed"):
            result = smoke.enrich_link_previews(page, "reader", posts, "politics")
        self.assertEqual(result[0]["attributes"], posts[0]["attributes"])
        self.assertEqual(result[0]["thumbnail"], "https://external-preview.redd.it/item0.jpg?width=1080&s=published")
        self.assertEqual(result[0]["thumbnail"], result[0]["preview"]["images"][0]["source"]["url"])
        self.assertEqual(posts[0]["thumbnail"], "https://external-preview.redd.it/image0.jpg?width=140&s=small")
        self.assertLessEqual(events[0][1]["timeout"], 5000)

    def test_missing_or_unusable_link_thumbnail_recovers_published_detail_preview(self):
        for thumbnail in (None, "", "default", "ftp://cdn.example/image.jpg", "https://user:secret@cdn.example/image.jpg"):
            posts = self.posts()
            posts[0]["thumbnail"] = thumbnail
            page, events = self.page(posts)
            with patch.object(smoke, "state", return_value="feed"):
                result = smoke.enrich_link_previews(page, "reader", posts, "politics", priority_ids=["t3_item0"])
            self.assertEqual(result[0]["thumbnail"], "https://external-preview.redd.it/item0.jpg?width=1080&s=published")
            self.assertEqual(result[0]["attributes"], posts[0]["attributes"])
            self.assertEqual(len(events), 1)

    def test_missing_preview_still_keeps_valid_core_listing(self):
        posts = self.posts()
        posts[0].pop("thumbnail")
        page, events = self.page(posts)
        page.evaluate_read = lambda *_args: posts
        with patch.object(smoke, "state", return_value="feed"):
            result = smoke.enrich_link_previews(page, "reader", posts, "politics", priority_ids=["t3_item0"])
        self.assertEqual(result, posts)
        self.assertNotIn("preview", result[0])
        smoke.validate_core(result[0])
        self.assertEqual(len(events), 1)

    def test_missing_internal_or_invalid_destination_does_not_request_details(self):
        for destination in ("https://www.reddit.com/r/news/comments/item0/story/", "/r/news/comments/item0/story/", "javascript:alert(1)", "https://user:secret@publisher.example/story"):
            posts = self.posts()
            posts[0]["thumbnail"] = None
            posts[0]["attributes"]["content-href"] = destination
            page, events = self.page(posts)
            self.assertEqual(smoke.enrich_link_previews(page, "reader", posts, "politics"), posts)
            self.assertEqual(events, [])

    def test_tiny_or_unknown_detail_images_never_replace_missing_article_preview(self):
        for width in (None, 0, 64, 320, True, "1080", float("inf")):
            posts = self.posts()
            posts[0]["thumbnail"] = None
            page, _events = self.page(posts)
            source = {"url": "https://i.redd.it/communityicon.png"}
            if width is not None:
                source["width"] = width
            detail = {**posts[0], "preview": {"images": [{"source": source}]}}
            page.evaluate_read = lambda *_args: [detail]
            with patch.object(smoke, "state", return_value="feed"):
                result = smoke.enrich_link_previews(page, "reader", posts, "politics", priority_ids=["t3_item0"])
            self.assertEqual(result, posts)
            self.assertNotIn("preview", result[0])

    def test_large_measured_original_detail_image_can_fill_missing_preview(self):
        posts = self.posts()
        posts[0]["thumbnail"] = None
        page, _events = self.page(posts)
        detail = {**posts[0], "preview": {"images": [{"source": {"url": "https://i.redd.it/articlephoto.jpg", "width": 800}}]}}
        page.evaluate_read = lambda *_args: [detail]
        with patch.object(smoke, "state", return_value="feed"):
            result = smoke.enrich_link_previews(page, "reader", posts, "politics", priority_ids=["t3_item0"])
        self.assertEqual(result[0]["thumbnail"], "https://i.redd.it/articlephoto.jpg")
        self.assertEqual(result[0]["attributes"], posts[0]["attributes"])

    def test_top_four_small_link_images_are_prioritized_without_reordering_posts(self):
        posts = self.posts(6)
        page, events = self.page(posts)
        with patch.object(smoke, "state", return_value="feed"):
            result = smoke.enrich_link_previews(page, "reader", posts, "politics")
        self.assertEqual([event[0].split("/comments/")[1].split("/")[0] for event in events], ["item5", "item4", "item3", "item2"])
        self.assertEqual([post["attributes"]["id"] for post in result], [post["attributes"]["id"] for post in posts])
        self.assertNotIn("preview", result[0])

    def test_explicit_priorities_target_known_small_images_in_supplied_order(self):
        posts = self.posts(7)
        page, events = self.page(posts)
        priorities = ["t3_item0", "t3_absent", "t3_item2", "t3_item1", "t3_item4", "t3_item5"]
        with patch.object(smoke, "state", return_value="feed"):
            result = smoke.enrich_link_previews(page, "reader", posts, "politics", priority_ids=priorities)
        self.assertEqual([event[0].split("/comments/")[1].split("/")[0] for event in events], ["item0", "item2", "item1", "item4"])
        self.assertIn("preview", result[0])
        self.assertNotIn("preview", result[6])
        self.assertEqual([post["attributes"] for post in result], [post["attributes"] for post in posts])

    def test_explicit_empty_priorities_skip_optional_details(self):
        posts = self.posts(6)
        page, events = self.page(posts)
        self.assertEqual(smoke.enrich_link_previews(page, "reader", posts, "politics", priority_ids=[]), posts)
        self.assertEqual(events, [])

    def test_image_priority_cli_distinguishes_absent_empty_and_valid_ids(self):
        self.assertIsNone(smoke.options([]).image_priority_ids)
        self.assertEqual(smoke.options(["--image-priority-ids", ""]).image_priority_ids, [])
        self.assertEqual(smoke.options(["--image-priority-ids", "t3_abc,t3_def"]).image_priority_ids, ["t3_abc", "t3_def"])
        for value in ("abc", "t3_ABC", "t3_abc,t3_abc", "t3_abc,", ",", ",".join(f"t3_item{index}" for index in range(26))):
            with self.assertRaises(SystemExit):
                smoke.options(["--image-priority-ids", value])

    def test_optional_block_or_challenge_stops_reads_and_preserves_posts(self):
        for access in ("blocked", "challenge"):
            posts = self.posts(3)
            page, events = self.page(posts)
            page.evaluate_read = lambda *_args: (_ for _ in ()).throw(AssertionError("Must stop before reading details"))
            budget = {"remaining": 4, "seconds": 25}
            with patch.object(smoke, "state", return_value=access):
                self.assertEqual(smoke.enrich_link_previews(page, "reader", posts, "politics", budget=budget), posts)
            self.assertEqual(len(events), 1)
            self.assertTrue(budget["disabled"])
            if access == "challenge":
                self.assertEqual(budget["failure"].code, "feed_challenge")
            else:
                self.assertNotIn("failure", budget)

    def test_unavailable_wrong_identity_or_unsafe_preview_keeps_listing_image(self):
        for error in ("navigation", "identity", "unsafe"):
            posts = self.posts()
            page, _events = self.page(posts)
            if error == "navigation":
                page.goto = lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("timeout"))
            else:
                detail = {**posts[0], "preview": {"images": [{"source": {"url": "https://evil.example/photo.jpg"}}]}}
                if error == "identity":
                    detail["attributes"] = {**detail["attributes"], "id": "t3_other"}
                page.evaluate_read = lambda *_args: [detail]
            with patch.object(smoke, "state", return_value="feed"):
                self.assertEqual(smoke.enrich_link_previews(page, "reader", posts, "politics"), posts)

    def test_budget_and_ineligible_media_skip_optional_navigation(self):
        posts = self.posts()
        page, events = self.page(posts)
        self.assertEqual(smoke.enrich_link_previews(page, "reader", posts, "politics", time_budget=0), posts)
        self.assertEqual(events, [])
        for post_type in ("gallery", "image", "video", "text"):
            posts[0]["attributes"]["post-type"] = post_type
            self.assertEqual(smoke.enrich_link_previews(page, "reader", posts, "politics"), posts)
        posts[0]["attributes"]["post-type"] = "link"
        posts[0]["thumbnail"] = "https://preview.redd.it/full.jpg?width=1080&s=published"
        self.assertEqual(smoke.enrich_link_previews(page, "reader", posts, "politics"), posts)
        self.assertEqual(events, [])


class BatchTests(unittest.TestCase):
    def setup_batch(self, directory, **overrides):
        feeds = json.loads(smoke.SUBREDDITS.read_text())
        fixture = SessionTests().session()
        stats = {"launches": 0, "pages": 0, "requests": [], "restores": 0, "closed": 0, "feeds": feeds}
        config = argparse.Namespace(subreddit=feeds[0], limit=1, all_feeds=True, authenticate=False,
                                    session_input=Path(directory) / "input.json", session_output=Path(directory) / "output.json",
                                    image_priority_map=None, batch_budget_seconds=130)
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
                pass
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

    def test_optional_429_retains_current_listing_and_stops_batch(self):
        with tempfile.TemporaryDirectory() as directory:
            config, stats, fixture, browser = self.setup_batch(directory)
            def optional(_page, _reader, posts, subreddit, **kwargs):
                if subreddit == stats["feeds"][1]:
                    kwargs["budget"]["failure"] = smoke.SessionError("Browser navigation was rejected", "navigation_rate_limited", 429, 60)
                return posts
            with patch.object(smoke, "enrich_link_previews", side_effect=optional):
                result = self.execute(config, stats, fixture, browser)
            self.assertEqual([item["subreddit"] for item in result["feeds"]], stats["feeds"][:2])
            self.assertEqual(result["batchFailure"]["subreddit"], stats["feeds"][1])
            self.assertEqual(result["batchFailure"]["stage"], "optional_preview")
            self.assertEqual(len(stats["requests"]), 2)

    def test_authenticated_batch_disables_optional_reads(self):
        with tempfile.TemporaryDirectory() as directory:
            config, stats, fixture, browser = self.setup_batch(directory, session_input=None, authenticate=True)
            module = types.SimpleNamespace(InvisiblePlaywright=browser)
            budgets = []
            def authenticate(page, url, **_kwargs):
                smoke.navigate(page, url)
                return "authenticated"
            def optional(_page, _reader, posts, _subreddit, **kwargs):
                budgets.append(kwargs["budget"]["disabled"])
                return posts
            with patch.dict(sys.modules, {"invisible_playwright": module}), patch.object(smoke, "state", return_value="feed"), patch.object(smoke, "authenticate_once", side_effect=authenticate) as login, patch.object(smoke, "enrich_link_previews", side_effect=optional):
                result = smoke.run(config)
            self.assertEqual(len(result["feeds"]), len(stats["feeds"]))
            self.assertEqual(login.call_count, 1)
            self.assertEqual(budgets, [True] * len(stats["feeds"]))
            self.assertEqual(len(stats["requests"]), len(stats["feeds"]))

    def test_optional_work_reserves_time_for_every_remaining_core_feed(self):
        with tempfile.TemporaryDirectory() as directory:
            feed_count = len(json.loads(smoke.SUBREDDITS.read_text()))
            config, stats, fixture, browser = self.setup_batch(directory, batch_budget_seconds=(feed_count - 1) * 10 + 26)
            clock = {"seconds": 0}
            stats["clock"] = clock
            spent = []
            def optional(_page, _reader, posts, _subreddit, **kwargs):
                budget = kwargs["budget"]
                available = max(0, kwargs["batch_deadline"] - clock["seconds"] - 1)
                duration = min(budget["seconds"], available)
                spent.append(duration)
                clock["seconds"] += duration
                budget["seconds"] -= duration
                return posts
            with patch.object(smoke.time, "monotonic", side_effect=lambda: clock["seconds"]), patch.object(smoke, "enrich_link_previews", side_effect=optional):
                result = self.execute(config, stats, fixture, browser)
            self.assertEqual(len(result["feeds"]), len(stats["feeds"]))
            self.assertNotIn("batchFailure", result)
            self.assertLess(spent[0], 25)
            self.assertLessEqual(sum(spent), 25)
            self.assertLessEqual(clock["seconds"], config.batch_budget_seconds - 5)

    def test_priority_allocation_rotates_fairly_and_skips_absent_map(self):
        feeds = json.loads(smoke.SUBREDDITS.read_text())
        mapping = {feed: ["t3_" + feed.lower(), "t3_" + feed.lower() + "2"] for feed in feeds}
        self.assertEqual(smoke.allocate_image_priorities(feeds, None), {feed: [] for feed in feeds})
        with patch.object(smoke.time, "time", return_value=300):
            result = smoke.allocate_image_priorities(feeds, mapping, maximum=len(feeds) - 1)
        self.assertEqual(result[feeds[0]], [])
        self.assertTrue(all(len(result[feed]) == 1 for feed in feeds[1:]))
        with patch.object(smoke.time, "time", return_value=0):
            result = smoke.allocate_image_priorities(feeds, {feeds[0]: ["t3_a", "t3_b", "t3_c"], feeds[1]: ["t3_d", "t3_e"]})
        self.assertEqual(result[feeds[0]], ["t3_a", "t3_b"])
        self.assertEqual(result[feeds[1]], ["t3_d", "t3_e"])
        self.assertEqual(sum(map(len, result.values())), 4)

    def test_persistent_missing_candidates_each_get_a_turn_across_feed_cycles(self):
        feeds = json.loads(smoke.SUBREDDITS.read_text())
        mapping = {feed: ["t3_" + feed + str(index) for index in range(3)] for feed in feeds}
        seen = {feed: [] for feed in feeds}
        # Leave every ID pending, including the first unrecoverable image.
        for bucket in range(len(feeds) * 3):
            with patch.object(smoke.time, "time", return_value=bucket * 300):
                allocated = smoke.allocate_image_priorities(feeds, mapping, maximum=1)
            selected = [(feed, item) for feed, ids in allocated.items() for item in ids]
            self.assertEqual(len(selected), 1)
            feed = feeds[bucket % len(feeds)]
            self.assertEqual(selected, [(feed, mapping[feed][bucket // len(feeds)])])
            seen[feed].append(selected[0][1])
        self.assertEqual(seen, mapping)

    def test_rotated_priorities_keep_caps_empty_inputs_and_duplicate_guards(self):
        feeds = json.loads(smoke.SUBREDDITS.read_text())
        mapping = {feeds[0]: ["t3_a", "t3_a", "t3_b"], feeds[1]: ["t3_a", "t3_c"], feeds[2]: []}
        with patch.object(smoke.time, "time", return_value=len(feeds) * 300):
            allocated = smoke.allocate_image_priorities(feeds, mapping, maximum=10)
        selected = [item for ids in allocated.values() for item in ids]
        self.assertEqual(set(selected), {"t3_a", "t3_b", "t3_c"})
        self.assertEqual(len(selected), 3)
        self.assertEqual(allocated[feeds[0]], ["t3_b", "t3_a"])
        self.assertEqual(smoke.allocate_image_priorities(feeds, mapping, maximum=0), {feed: [] for feed in feeds})
        self.assertEqual(smoke.allocate_image_priorities([], mapping), {})

    def test_initial_batch_detail_cap_is_one_while_single_mode_keeps_four(self):
        self.assertEqual(smoke.MAX_BATCH_OPTIONAL_DETAILS, 1)
        with tempfile.TemporaryDirectory() as directory:
            feeds = json.loads(smoke.SUBREDDITS.read_text())
            mapping = {feed: ["t3_" + feed + "0"] for feed in feeds}
            config, stats, fixture, browser = self.setup_batch(directory, image_priority_map=mapping)
            allocated = []
            def optional(_page, _reader, posts, _subreddit, **kwargs):
                allocated.extend(kwargs["priority_ids"])
                self.assertEqual(kwargs["budget"]["remaining"], 1)
                return posts
            with patch.object(smoke.time, "time", return_value=0), patch.object(smoke, "enrich_link_previews", side_effect=optional):
                result = self.execute(config, stats, fixture, browser)
            self.assertEqual(len(result["feeds"]), len(feeds))
            self.assertEqual(allocated, [mapping[feeds[0]][0]])

    def test_batch_cli_map_and_budget_validation(self):
        feeds = json.loads(smoke.SUBREDDITS.read_text())
        priorities = json.dumps({feeds[0]: [], feeds[-1]: ["t3_abc"]})
        config = smoke.options(["--all-feeds", "--image-priority-map", priorities, "--batch-budget-seconds", "126"])
        self.assertTrue(config.all_feeds)
        self.assertEqual(config.image_priority_map[feeds[-1]], ["t3_abc"])
        self.assertEqual(config.batch_budget_seconds, 126)
        for args in (["--all-feeds", "--image-priority-map", json.dumps({feeds[0].upper(): []})], ["--all-feeds", "--image-priority-map", '{"Economics":[]}'], ["--all-feeds", "--image-priority-map", json.dumps({feeds[0]: ["t3_a", "t3_a"]})], ["--all-feeds", "--image-priority-map", json.dumps({feeds[0]: None})], ["--all-feeds", "--batch-budget-seconds", "0"], ["--all-feeds", "--image-priority-ids", "t3_a"]):
            with self.assertRaises(SystemExit):
                smoke.options(args)


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
