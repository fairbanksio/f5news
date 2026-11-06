"""Isolated browser-access test. Produces the existing F5 reader's raw metadata."""

import argparse
import json
import os
import re
import signal
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urljoin, urlsplit

ROOT = Path(__file__).resolve().parent
SUBREDDITS = Path(os.environ.get("F5_SUBREDDITS_FILE", str(ROOT / "../../services/posts/subreddits.json")))
READER = Path(os.environ.get("F5_BROWSER_READER", str(ROOT / "../reddit-stagehand/browser-reader.js")))


def log(message):
    print(message, file=sys.stderr, flush=True)


class BrowserCancelled(BaseException):
    """Unwind browser cleanup when the supervising process cancels a run."""


def display_identity(process):
    if process is None or process.poll() is not None:
        return None
    # comm can contain spaces or parentheses. Fields after its final ')' start at state.
    try:
        fields = (Path("/proc") / str(process.pid) / "stat").read_text().rsplit(")", 1)[1].split()
    except FileNotFoundError:
        return None
    return {"pid": process.pid, "pgid": int(fields[2]), "startTime": fields[19]}


@contextmanager
def browser_lifecycle():
    from invisible_playwright import _session

    factory = _session.make_virtual_display
    previous = signal.getsignal(signal.SIGTERM)

    def cancel(_signal, _frame):
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        raise BrowserCancelled("Browser extraction was cancelled")

    class OwnedDisplay:
        def __init__(self, display):
            self.display = display
            self.identity = None

        def __getattr__(self, name):
            return getattr(self.display, name)

        def start(self):
            try:
                try:
                    self.display.start()
                finally:
                    self.identity = display_identity(getattr(self.display, "_proc", None))
                    if self.identity:
                        log(json.dumps({"eventType": "BROWSER_OWNED_DISPLAY", **self.identity}))
            except BaseException:
                self.stop()
                raise

        def stop(self):
            self.display.stop()
            if self.identity and getattr(self.display, "_proc", None) is None:
                log(json.dumps({"eventType": "BROWSER_DISPLAY_STOPPED", **self.identity}))

    def make_display():
        display = factory()
        return OwnedDisplay(display) if display is not None else None

    signal.signal(signal.SIGTERM, cancel)
    _session.make_virtual_display = make_display
    try:
        yield
    finally:
        _session.make_virtual_display = factory
        signal.signal(signal.SIGTERM, previous)


def log_resources():
    counters = {}
    for name in ("pids.events", "pids.peak", "pids.max", "memory.events", "memory.peak", "memory.max"):
        try:
            counters[name] = (Path("/sys/fs/cgroup") / name).read_text().strip()
        except OSError:
            pass
    log("Resource counters: " + json.dumps(counters))


def options(args=None):
    supported = json.loads(SUBREDDITS.read_text())
    names = {name.lower(): name for name in supported}
    parser = argparse.ArgumentParser()
    parser.add_argument("--subreddit", type=str.lower, default="politics", choices=names)
    parser.add_argument("--limit", type=int, choices=range(1, 26), default=25)
    result = parser.parse_args(args)
    result.subreddit = names[result.subreddit]
    return result


def state(page):
    try:
        return page.evaluate_read("""() => {
          const text = `${document.title}\n${document.body?.innerText || ''}`;
          if (/prove your humanity|verify (that )?you('re| are) human|complete the challenge/i.test(text)) return 'challenge';
          if (/blocked by network security|you.have been blocked/i.test(text)) return 'blocked';
          if (document.querySelector('shreddit-post')) return 'feed';
          return 'loading';
        }""")
    except Exception as error:
        if "Execution context was destroyed" in str(error) or "Cannot find context" in str(error):
            return "loading"
        raise


CORE_ATTRIBUTES = ("id", "subreddit-name", "permalink", "content-href", "post-title", "author", "created-timestamp", "score", "comment-count", "post-type")


def read_posts(page, reader, detail=False):
    posts = page.evaluate_read(reader, {"detail": detail})
    if not isinstance(posts, list):
        raise RuntimeError("Shared browser reader did not return a post list")
    for post in posts:
        if not isinstance(post, dict) or not isinstance(post.get("attributes"), dict):
            raise RuntimeError("Shared browser reader returned malformed post metadata")
    return posts


def validate_core(post):
    attrs = post["attributes"]
    missing = [key for key in CORE_ATTRIBUTES if not isinstance(attrs.get(key), str) or not attrs[key].strip()]
    if missing:
        raise RuntimeError("Post metadata is incomplete: " + ", ".join(missing))


def gallery_url(post, subreddit):
    attrs = post["attributes"]
    name = attrs["id"]
    if not re.fullmatch(r"t3_[a-z0-9]+", name):
        raise RuntimeError("Gallery has an invalid Reddit ID")
    target = urlsplit(urljoin("https://www.reddit.com", attrs["permalink"]))
    match = re.fullmatch(r"/r/([a-zA-Z0-9_]+)/comments/([a-z0-9]+)(?:/[^/?#]*)?/?", target.path)
    if (target.scheme not in ("http", "https") or target.hostname not in ("www.reddit.com", "reddit.com", "old.reddit.com", "sh.reddit.com")
            or target.username or target.password or target.query or target.fragment or target.port not in (None, 80, 443)
            or not match or match[1].lower() != subreddit.lower() or match[2] != name[3:]):
        raise RuntimeError("Gallery detail link does not match the requested listing")
    return "https://www.reddit.com" + target.path


def enrich_gallery(page, reader, post, subreddit):
    url = gallery_url(post, subreddit)
    log("Loading gallery detail metadata.")
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    started = time.monotonic()
    last_report = started
    while time.monotonic() - started < 60:
        current = state(page)
        if current in ("blocked", "challenge"):
            raise RuntimeError("Gallery detail requires browser access: " + current)
        if current == "feed":
            break
        if time.monotonic() - last_report >= 10:
            log("Still waiting for gallery detail access.")
            last_report = time.monotonic()
        time.sleep(1)
    else:
        raise RuntimeError("Gallery detail did not finish loading")
    details = read_posts(page, reader, detail=True)
    matches = [detail for detail in details if detail["attributes"].get("id") == post["attributes"]["id"]
               and (detail["attributes"].get("subreddit-name") or "").lower() == subreddit.lower()]
    if len(matches) != 1:
        raise RuntimeError("Gallery detail did not contain the requested post")
    detail = matches[0]
    images = detail.get("images")
    if detail.get("mediaComplete") is not True or not isinstance(images, list) or not images:
        raise RuntimeError("Gallery detail is missing complete image metadata")
    seen = set()
    for image in images:
        if not isinstance(image, dict) or not isinstance(image.get("id"), str) or not re.fullmatch(r"[a-zA-Z0-9_-]+", image["id"]):
            raise RuntimeError("Gallery detail has invalid image metadata")
        image_url = urlsplit(image.get("url") or "")
        if (image["id"] in seen or image_url.scheme not in ("http", "https") or not image_url.hostname
                or image_url.username or image_url.password):
            raise RuntimeError("Gallery detail has invalid image metadata")
        seen.add(image["id"])
    # Keep the listing's exact timestamps, counts, links, and other core values.
    return {**post, "images": images, "mediaComplete": True,
            "thumbnail": post.get("thumbnail") or detail.get("thumbnail") or images[0]["url"]}


def run(config):
    from invisible_playwright import InvisiblePlaywright

    source = READER.read_text().strip()
    if not source.startswith("export function readRenderedPosts("):
        raise RuntimeError("Unexpected shared browser reader format")
    reader = "(" + source.removeprefix("export ") + ")"
    url = f"https://www.reddit.com/r/{config.subreddit}/rising/"
    started = time.monotonic()
    log("Launching the isolated Firefox session.")
    with InvisiblePlaywright(headless=True) as browser:
        browser.on("disconnected", lambda *_args: log("Browser disconnected."))
        page = browser.new_page()
        page.on("crash", lambda *_args: log("Browser page crashed."))
        page.on("close", lambda *_args: log("Browser page closed."))
        log("Loading the configured Reddit feed in a fresh browser session.")
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        clicked = False
        access_started = time.monotonic()
        last_report = access_started
        while time.monotonic() - access_started < 60:
            current = state(page)
            if time.monotonic() - last_report >= 10:
                log(f"Still waiting for feed access ({current}).")
                last_report = time.monotonic()
            if current == "blocked":
                return {"status": "blocked", "subreddit": config.subreddit, "posts": []}
            if current == "feed":
                break
            if current == "challenge" and not clicked:
                checkbox = page.frame_locator('iframe[title="reCAPTCHA"]').locator("#recaptcha-anchor")
                if checkbox.is_visible(timeout=3000):
                    log("Clicking the visible checkbox once in the approved website workflow.")
                    checkbox.click(timeout=5000)
                    clicked = True
            time.sleep(1)
        else:
            return {"status": "challenge_required" if state(page) == "challenge" else "loading_timeout", "subreddit": config.subreddit, "checkboxClicked": clicked, "posts": []}

        posts = {}
        unchanged = 0
        for _ in range(12):
            previous = len(posts)
            for raw in read_posts(page, reader):
                attrs = raw.get("attributes", {})
                if (attrs.get("subreddit-name") or "").lower() == config.subreddit.lower() and attrs.get("id"):
                    validate_core(raw)
                    posts[attrs["id"]] = raw
            if len(posts) >= config.limit:
                break
            unchanged = unchanged + 1 if len(posts) == previous else 0
            if unchanged >= 3:
                break
            page.evaluate("() => window.scrollBy(0, window.innerHeight * 2)")
            time.sleep(1)
        selected = list(posts.values())[:config.limit]
        for index, post in enumerate(selected):
            if post["attributes"]["post-type"] == "gallery":
                selected[index] = enrich_gallery(page, reader, post, config.subreddit)
        return {"status": "accessible" if selected else "empty", "subreddit": config.subreddit, "checkboxClicked": clicked, "posts": selected, "durationSeconds": round(time.monotonic() - started, 2)}


def main():
    config = options()
    try:
        with browser_lifecycle():
            result = run(config)
    except (Exception, BrowserCancelled) as error:
        detail = re.sub(r"(https?://[^\s?]+)\?[^\s]+", r"\1?[redacted]", str(error))
        log(f"Browser test failed ({type(error).__name__}): {detail[:1200]}")
        return 1
    finally:
        log_resources()
    print(json.dumps(result), flush=True)
    return 0 if result["status"] == "accessible" else 2


if __name__ == "__main__":
    raise SystemExit(main())
