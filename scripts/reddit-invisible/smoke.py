"""Isolated browser-access test. Produces the existing F5 reader's raw metadata."""

import argparse
import json
import os
import re
import math
import secrets
import stat
import tempfile
import signal
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urljoin, urlsplit

ROOT = Path(__file__).resolve().parent
SUBREDDITS = Path(os.environ.get("F5_SUBREDDITS_FILE", str(ROOT / "../../services/posts/subreddits.json")))
READER = Path(os.environ.get("F5_BROWSER_READER", str(ROOT / "../reddit-stagehand/browser-reader.js")))


def redact(message):
    result = str(message)
    names = ("MONGO_CONNECTION_STRING", "REDDIT_USERNAME", "REDDIT_PASSWORD", "REDDIT_CLIENT_ID", "REDDIT_SECRET_KEY")
    for value in sorted({os.environ.get(name, "") for name in names} - {""}, key=len, reverse=True):
        result = result.replace(value, "[redacted]")
    return re.sub(r"(https?://[^\s?]+)\?[^\s]+", r"\1?[redacted]", result)


def log(message):
    print(redact(message), file=sys.stderr, flush=True)


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
    parser.add_argument("--authenticate", action="store_true", help="Try the configured Reddit website account once")
    parser.add_argument("--session-input", type=Path)
    parser.add_argument("--session-output", type=Path)
    result = parser.parse_args(args)
    if result.session_input and result.authenticate:
        parser.error("Use session reuse or authentication, not both")
    if result.session_output and not (result.authenticate or result.session_input):
        parser.error("Session output requires authentication or session input")
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


def login_state(page):
    try:
        return page.evaluate_read("""() => {
      const text = `${document.title}\n${document.body?.innerText || ''}`;
      if (/prove your humanity|verify (that )?you('re| are) human|complete the challenge/i.test(text)) return 'challenge';
      if (/blocked by network security|you.have been blocked/i.test(text)) return 'blocked';
      const errors = [...document.querySelectorAll('[role="alert"], faceplate-form#login [slot="error"]')];
      if (errors.some(element => element.getClientRects().length && element.textContent.trim()) ||
          /invalid (username|password)|incorrect (username|password)|wrong (username|password)|too many (requests|attempts)/i.test(text)) return 'failed';
      return document.querySelector('faceplate-form#login') ? 'login' : 'loading';
    }""")

    except Exception as error:
        if "Execution context was destroyed" in str(error) or "Cannot find context" in str(error):
            return "loading"
        raise


def has_account_session(page):
    return any(cookie.get("name") == "reddit_session" and cookie.get("value")
               and (cookie.get("domain") or "").lstrip(".") == "reddit.com"
               for cookie in page.context.cookies())


def authenticate_once(page, feed_url):
    username = os.environ.get("REDDIT_USERNAME", "")
    password = os.environ.get("REDDIT_PASSWORD", "")
    if not username or not password:
        return "auth_credentials_missing"
    log("Opening Reddit website login for one account attempt.")
    page.goto("https://www.reddit.com/login/", wait_until="domcontentloaded", timeout=30000)
    started = time.monotonic()
    while time.monotonic() - started < 30:
        access = login_state(page)
        if access in ("blocked", "challenge", "failed"):
            return "auth_" + access
        if access == "login":
            break
        time.sleep(1)
    else:
        return "auth_login_unavailable"
    target = urlsplit(page.url)
    if target.scheme != "https" or target.hostname not in ("www.reddit.com", "reddit.com") or target.username or target.password:
        return "auth_login_unavailable"
    # Selectors were checked against the public login form and its open shadow roots.
    username_field = page.locator('faceplate-text-input#login-username input[name="username"]')
    password_field = page.locator('faceplate-text-input#login-password input[name="password"]')
    submit = page.locator('faceplate-form#login').get_by_role("button", name="Log In", exact=True)
    if any(field.count() != 1 or not field.is_visible() for field in (username_field, password_field, submit)):
        return "auth_login_unavailable"
    username_field.fill(username, timeout=5000)
    password_field.fill(password, timeout=5000)
    try:
        submit.click(timeout=5000)
    except Exception as error:
        message = str(error)
        if "action went out but did not reach the element:" not in message or "mouseup landed on " not in message:
            raise
        # Invisible reports this after dispatch. A second click could submit twice.
        log("Login click was dispatched. Checking its result without another submission.")
    started = time.monotonic()
    while time.monotonic() - started < 30:
        access = login_state(page)
        if access in ("blocked", "challenge", "failed"):
            return "auth_" + access
        if has_account_session(page):
            break
        time.sleep(1)
    else:
        return "auth_unverified"
    log("Checking authenticated access to the configured feed.")
    page.goto(feed_url, wait_until="domcontentloaded", timeout=30000)
    started = time.monotonic()
    while time.monotonic() - started < 60:
        access = state(page)
        if access in ("blocked", "challenge"):
            return "auth_" + access
        if access == "feed":
            return "authenticated" if has_account_session(page) else "auth_unverified"
        time.sleep(1)
    return "auth_feed_timeout"


MAX_SESSION_BYTES = 1024 * 1024


class SessionError(RuntimeError):
    pass


def reddit_domain(value):
    return isinstance(value, str) and re.fullmatch(r"\.?(?:[a-z0-9-]+\.)*reddit\.com", value) is not None


def validate_session(session):
    try:
        if not isinstance(session, dict) or set(session) != {"version", "seed", "cookies", "origins"}:
            raise ValueError()
        if type(session["version"]) is not int or session["version"] != 1 or type(session["seed"]) is not int or not 0 <= session["seed"] < 2**53:
            raise ValueError()
        if not isinstance(session["cookies"], list) or not isinstance(session["origins"], list):
            raise ValueError()
        seen = set()
        account = False
        usable_cookies = []
        for cookie in session["cookies"]:
            if not isinstance(cookie, dict) or not {"name", "value", "domain", "path"} <= set(cookie) or set(cookie) - {"name", "value", "domain", "path", "expires", "httpOnly", "secure", "sameSite"}:
                raise ValueError()
            if not reddit_domain(cookie["domain"]) or not isinstance(cookie["name"], str) or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", cookie["name"]):
                raise ValueError()
            if not isinstance(cookie["value"], str) or len(cookie["value"]) > 65536 or any(char in cookie["value"] for char in "\r\n") or not isinstance(cookie["path"], str) or not cookie["path"].startswith("/"):
                raise ValueError()
            expires = cookie.get("expires", -1)
            if type(expires) not in (int, float) or not math.isfinite(expires):
                raise ValueError()
            if expires != -1 and expires <= time.time():
                if cookie["name"] == "reddit_session":
                    raise ValueError()
                continue
            if any(key in cookie and type(cookie[key]) is not bool for key in ("secure", "httpOnly")) or cookie.get("sameSite", "Lax") not in ("Lax", "None", "Strict"):
                raise ValueError()
            identity = (cookie["name"], cookie["domain"], cookie["path"])
            if identity in seen:
                raise ValueError()
            seen.add(identity)
            usable_cookies.append(cookie)
            account |= cookie["name"] == "reddit_session" and bool(cookie["value"]) and cookie["domain"].lstrip(".") == "reddit.com" and cookie["path"] == "/"
        if not account:
            raise ValueError()
        origins = set()
        for origin in session["origins"]:
            if not isinstance(origin, dict) or set(origin) != {"origin", "localStorage"} or origin["origin"] not in ("https://www.reddit.com", "https://reddit.com") or origin["origin"] in origins or not isinstance(origin["localStorage"], list):
                raise ValueError()
            origins.add(origin["origin"])
            names = set()
            for item in origin["localStorage"]:
                if not isinstance(item, dict) or set(item) != {"name", "value"} or not isinstance(item["name"], str) or not isinstance(item["value"], str) or item["name"] in names:
                    raise ValueError()
                names.add(item["name"])
        if len(json.dumps(session)) > MAX_SESSION_BYTES:
            raise ValueError()
        return {**session, "cookies": usable_cookies}
    except Exception:
        raise SessionError("Session data is invalid") from None


def read_session(path):
    try:
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "r") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > MAX_SESSION_BYTES:
                raise ValueError()
            return validate_session(json.load(source))
    except Exception:
        raise SessionError("Session input is invalid") from None


def write_session(path, session):
    temporary = None
    try:
        session = validate_session(session)
        with tempfile.NamedTemporaryFile(mode="w", dir=Path(path).parent, delete=False) as output:
            temporary = output.name
            os.fchmod(output.fileno(), 0o600)
            json.dump(session, output)
        os.replace(temporary, path)
    except Exception:
        raise SessionError("Session output could not be saved") from None
    finally:
        if temporary:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
            except OSError:
                raise SessionError("Session temporary file could not be removed") from None


def export_session(page, seed, path):
    try:
        cookies = [cookie for cookie in page.context.cookies() if reddit_domain(cookie.get("domain"))]
        origin = page.evaluate_read("""() => ({origin: location.origin, localStorage: Object.entries(localStorage).map(([name, value]) => ({name, value}))})""")
        write_session(path, {"version": 1, "seed": seed, "cookies": cookies, "origins": [origin]})
    except Exception:
        raise SessionError("Session output could not be saved") from None


def reuse_session(page, session, feed_url):
    try:
        page.context.add_cookies(session["cookies"])
        origins = json.dumps(session["origins"])
        script = "(() => { const records = " + origins + "; const record = records.find(item => item.origin === location.origin); if (record) for (const item of record.localStorage) localStorage.setItem(item.name, item.value); })();"
        with page.add_init_script(script=script):
            page.goto(feed_url, wait_until="domcontentloaded", timeout=30000)
            started = time.monotonic()
            while time.monotonic() - started < 60:
                access = state(page)
                if access in ("blocked", "challenge"):
                    return "session_" + access
                if access == "feed":
                    return "reused" if has_account_session(page) else "session_invalid"
                time.sleep(1)
        return "session_invalid"
    except Exception:
        raise SessionError("Session could not be restored") from None


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
    session = None
    session_input = getattr(config, "session_input", None)
    session_output = getattr(config, "session_output", None)
    if session_input:
        try:
            session = read_session(session_input)
        except SessionError:
            return {"status": "session_invalid", "subreddit": config.subreddit, "posts": []}
    seed = session["seed"] if session else secrets.randbelow(2**31)
    launch_options = {"headless": True}
    if session or getattr(config, "authenticate", False):
        launch_options["seed"] = seed
    log("Launching the isolated Firefox session.")
    with InvisiblePlaywright(**launch_options) as browser:
        browser.on("disconnected", lambda *_args: log("Browser disconnected."))
        page = browser.new_page()
        page.on("crash", lambda *_args: log("Browser page crashed."))
        page.on("close", lambda *_args: log("Browser page closed."))
        if session:
            try:
                access = reuse_session(page, session, url)
            except SessionError:
                access = "session_invalid"
            if access != "reused":
                return {"status": access, "subreddit": config.subreddit, "posts": []}
        elif getattr(config, "authenticate", False):
            authentication = authenticate_once(page, url)
            if authentication != "authenticated":
                return {"status": authentication, "subreddit": config.subreddit, "posts": []}
        else:
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
            if session and current in ("blocked", "challenge"):
                return {"status": "session_" + current, "subreddit": config.subreddit, "posts": []}
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
            return {"status": "session_invalid" if session else "challenge_required" if state(page) == "challenge" else "loading_timeout", "subreddit": config.subreddit, "checkboxClicked": clicked, "posts": []}

        if session_output:
            export_session(page, seed, session_output)
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
        detail = redact(str(error))
        log(f"Browser test failed ({type(error).__name__}): {detail[:1200]}")
        return 1
    finally:
        log_resources()
    print(json.dumps(result), flush=True)
    return 0 if result["status"] == "accessible" else 2


if __name__ == "__main__":
    raise SystemExit(main())
