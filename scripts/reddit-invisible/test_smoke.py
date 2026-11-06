import argparse
import json
import os
import signal
import subprocess
import sys
import tempfile
import types
import unittest
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
