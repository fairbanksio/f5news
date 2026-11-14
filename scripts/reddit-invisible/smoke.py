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
from urllib.parse import urlsplit

# Preserve HTTP error responses so status diagnostics can distinguish denials.
BROWSER_EXTRA_PREFS = {"browser.http.blank_page_with_error_response.enabled": True}
CHALLENGE_LISTING_URL = "https://www.reddit.com/r/politics/rising/"
MAX_CHALLENGE_SCREENSHOT_BYTES = 256 * 1024
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
    parser.add_argument("--all-feeds", action="store_true")
    parser.add_argument("--batch-budget-seconds", type=int, choices=range(1, 181), default=130)
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


def capture_listing_challenge(page):
    target = os.environ.get("F5_CHALLENGE_SCREENSHOT_PATH")
    if not target:
        return
    try:
        if page.url != CHALLENGE_LISTING_URL:
            return
        os.environ.pop("F5_CHALLENGE_SCREENSHOT_PATH", None)
        image = page.screenshot(type="jpeg", quality=70, full_page=False, scale="css", timeout=1500)
        if (page.url != CHALLENGE_LISTING_URL or len(image) > MAX_CHALLENGE_SCREENSHOT_BYTES
                or not image.startswith(b"\xff\xd8\xff") or not image.endswith(b"\xff\xd9")):
            return
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as screenshot:
            screenshot.write(image)
    except Exception:
        # Optional evidence cannot change the scrape or its cooldown result.
        pass


def state(page):
    try:
        evidence = page.evaluate_read("""() => {
          if (!document.body) return { state: 'loading' };
          const hasPosts = Boolean(document.querySelector('shreddit-post'));
          const visibleText = hasPosts ? [] : [{ text: document.title }];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent || parent.closest('shreddit-post,script,style,noscript,template,[hidden],[aria-hidden="true"]') ||
                getComputedStyle(parent).visibility !== 'visible' || !node.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            if ([...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) {
              visibleText.push({ text: node.textContent.trim(), parent });
            }
          }
          const text = visibleText.map(part => part.text).join(' ');
          const rules = [
            ['prove_humanity', /prove your humanity/i],
            ['verify_human', /verify (that )?you('re| are) human/i],
            ['complete_challenge', /complete the challenge/i],
            ['network_security', /blocked by network security/i],
            ['blocked_text', /you.have been blocked/i],
          ];
          const rule = rules.find(([, pattern]) => pattern.test(text));
          if (!rule) return { state: hasPosts ? 'feed' : 'loading' };
          const [marker, pattern] = rule;
          const matchIndex = text.search(pattern);
          let offset = 0;
          const matchedPart = visibleText.find(part => {
            const containsMatch = matchIndex >= offset && matchIndex < offset + part.text.length;
            offset += part.text.length + 1;
            return containsMatch;
          });
          const dialogSelector = 'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';
          const verificationSelector = 'shreddit-captcha, shreddit-verification, shreddit-captcha-modal, ' +
            '[id*="captcha" i], [data-testid*="captcha" i], [data-testid*="challenge" i]';
          const parent = matchedPart?.parent;
          const regions = [
            ['verification', verificationSelector], ['dialog', dialogSelector],
            ['navigation', 'nav, header, [role="navigation"], [role="banner"]'],
            ['footer', 'footer, [role="contentinfo"]'], ['link', 'a[href]'],
            ['heading', 'h1, h2, h3, h4, h5, h6, [role="heading"]'], ['main', 'main, [role="main"]'],
          ];
          const matchedRegion = matchedPart && !parent ? 'title' :
            regions.find(([, selector]) => parent?.closest(selector))?.[0] ?? 'other';
          const visible = element => getComputedStyle(element).visibility === 'visible' &&
            [...element.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
          const dialogVisible = [...document.querySelectorAll(dialogSelector)].some(visible);
          const verificationControl = [...document.querySelectorAll(verificationSelector)].some(visible);
          const frames = [...document.querySelectorAll('iframe')].filter(frame => frame.getClientRects().length);
          const verificationFrame = frames.some(frame => {
            try {
              const host = new URL(frame.src, location.href).hostname;
              return ['challenges.cloudflare.com', 'hcaptcha.com', 'www.hcaptcha.com', 'newassets.hcaptcha.com',
                'www.google.com', 'www.recaptcha.net'].includes(host) && /challenge|captcha|turnstile/i.test(frame.src);
            } catch { return false; }
          });
          return {
            state: ['network_security', 'blocked_text'].includes(marker) ? 'blocked' : 'challenge',
            marker,
            hasPosts,
            titleMatch: rules.some(([name, pattern]) => name === marker && pattern.test(document.title)),
            dialogVisible,
            verificationFrame,
            matchedRegion,
            verificationControl,
          };
        }""")
        if evidence["state"] in ("challenge", "blocked"):
            log(json.dumps({"eventType": "BROWSER_PAGE_ACCESS", **evidence}, separators=(",", ":")))
        if evidence["state"] == "challenge":
            capture_listing_challenge(page)
        return evidence["state"]
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


def authenticate_once(page, feed_url, deadline=None, attempts=3):
    username = os.environ.get("REDDIT_USERNAME", "")
    password = os.environ.get("REDDIT_PASSWORD", "")
    if not username or not password:
        return "auth_credentials_missing"
    log("Opening Reddit website login for one account attempt.")
    navigate(page, "https://www.reddit.com/login/", wait_until="domcontentloaded", timeout=remaining_timeout(deadline))
    started = time.monotonic()
    while time.monotonic() - started < 30 and before_deadline(deadline):
        access = login_state(page)
        if access in ("blocked", "challenge", "failed"):
            return "auth_" + access
        if access == "login":
            break
        pause_with_deadline(deadline)
    else:
        ensure_remaining(deadline)
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
    username_field.fill(username, timeout=remaining_timeout(deadline, 5000))
    password_field.fill(password, timeout=remaining_timeout(deadline, 5000))
    try:
        submit.click(timeout=remaining_timeout(deadline, 5000))
    except Exception as error:
        message = str(error)
        if "action went out but did not reach the element:" not in message or "mouseup landed on " not in message:
            raise
        # Invisible reports this after dispatch. A second click could submit twice.
        log("Login click was dispatched. Checking its result without another submission.")
    started = time.monotonic()
    while time.monotonic() - started < 30 and before_deadline(deadline):
        access = login_state(page)
        if access in ("blocked", "challenge", "failed"):
            return "auth_" + access
        if has_account_session(page):
            break
        pause_with_deadline(deadline)
    else:
        ensure_remaining(deadline)
        return "auth_unverified"
    log("Checking authenticated access to the configured feed.")
    navigate(page, feed_url, wait_until="domcontentloaded", timeout=remaining_timeout(deadline), attempts=attempts)
    started = time.monotonic()
    while time.monotonic() - started < 60 and before_deadline(deadline):
        access = state(page)
        if access in ("blocked", "challenge"):
            return "auth_" + access
        if access == "feed":
            return "authenticated" if has_account_session(page) else "auth_unverified"
        pause_with_deadline(deadline)
    ensure_remaining(deadline)
    return "auth_feed_timeout"


MAX_SESSION_BYTES = 1024 * 1024


SESSION_REASONS = frozenset(("invalid_data", "input_file_invalid", "root_cookie_expired", "root_cookie_missing",
                             "restore_exception", "feed_cookie_missing", "feed_timeout", "feed_blocked", "feed_challenge", "navigation_network_error", "navigation_http_rejected", "navigation_rate_limited"))


class SessionError(RuntimeError):
    def __init__(self, message, code="invalid_data", http_status=None, retry_after_seconds=None):
        super().__init__(message)
        self.code = code if code in SESSION_REASONS else "invalid_data"
        self.http_status = http_status if type(http_status) is int and 400 <= http_status <= 599 else None
        self.retry_after_seconds = retry_after_seconds if type(retry_after_seconds) is int and 0 <= retry_after_seconds <= 86400 else None

    def diagnostics(self):
        result = {"sessionReason": self.code}
        if self.http_status is not None:
            result["httpStatus"] = self.http_status
        if self.retry_after_seconds is not None:
            result["retryAfterSeconds"] = self.retry_after_seconds
        return result


def navigate(page, url, wait_until="domcontentloaded", timeout=30000, now=time.monotonic, sleep=time.sleep, attempts=3):
    deadline = now() + timeout / 1000
    observed = {}
    listing_challenge = False
    active = True

    def header_integer(value, maximum):
        return int(value) if isinstance(value, str) and value.isascii() and value.isdigit() and len(value) <= 16 and int(value) <= maximum else None

    def response_observer(response):
        nonlocal listing_challenge
        if not active:
            return
        try:
            request = response.request
            request_url = request.url
            if (not request.is_navigation_request() or request.frame.parent_frame is not None
                    or urlsplit(request_url).hostname not in ("reddit.com", "www.reddit.com")):
                return
            status = response.status
            if type(status) is not int or not 400 <= status <= 599:
                return
        except Exception:
            return
        event = {"eventType": "BROWSER_NAVIGATION_HTTP", "status": status,
                 "retryAfterSeconds": None, "contentLength": None, "challenge": False}
        try:
            headers = response.headers
            event["retryAfterSeconds"] = header_integer(headers.get("retry-after", headers.get("Retry-After")), 86400)
            event["contentLength"] = header_integer(headers.get("content-length", headers.get("Content-Length")), 2**53 - 1)
            event["challenge"] = str(headers.get("cf-mitigated", headers.get("CF-Mitigated", ""))).lower() == "challenge"
        except Exception:
            pass
        observed.update(event)
        listing_challenge = request_url == CHALLENGE_LISTING_URL and event["challenge"]
        try:
            log(json.dumps(event))
        except Exception:
            pass

    def reject_explicit_http():
        status = observed.get("status")
        if status in (401, 403, 429) or observed.get("challenge"):
            if url == CHALLENGE_LISTING_URL and listing_challenge:
                capture_listing_challenge(page)
            if status == 429:
                code = "navigation_rate_limited"
            else:
                code = "feed_challenge" if observed.get("challenge") else "navigation_http_rejected"
            raise SessionError("Browser navigation was rejected", code, status, observed.get("retryAfterSeconds"))

    try:
        try:
            page.on("response", response_observer)
        except Exception:
            pass
        for attempt in range(attempts):
            observed.clear()
            listing_challenge = False
            remaining = deadline - now()
            if remaining <= 0:
                raise SessionError("Browser navigation failed", "navigation_network_error")
            try:
                result = page.goto(url, wait_until=wait_until, timeout=max(1, int(remaining * 1000)))
                if not observed:
                    response_observer(result)
                reject_explicit_http()
                if not 500 <= observed.get("status", 0) <= 599:
                    return result
            except SessionError:
                raise
            except Exception as error:
                reject_explicit_http()
                first_line = str(error).splitlines()[0] if str(error) else ""
                if not re.search(r"(?:^|:\s*)(?:NS_ERROR_NET_EMPTY_RESPONSE|NS_ERROR_NET_RESET|(?:net::)?ERR_CONNECTION_RESET)(?:\s|:|$)", first_line):
                    raise
            remaining = deadline - now()
            delay = attempt + 1
            if attempt + 1 == attempts or remaining <= delay:
                raise SessionError("Browser navigation failed", "navigation_network_error", observed.get("status"), observed.get("retryAfterSeconds")) from None
            log("Retrying a transient browser navigation.")
            sleep(delay)

    finally:
        active = False
        try:
            page.remove_listener("response", response_observer)
        except Exception:
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
        expired_account = False
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
                expired_account |= cookie["name"] == "reddit_session" and cookie["domain"].lstrip(".") == "reddit.com" and cookie["path"] == "/"
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
            raise SessionError("Session data is invalid", "root_cookie_expired" if expired_account else "root_cookie_missing")
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
    except SessionError:
        raise
    except Exception:
        raise SessionError("Session data is invalid") from None


def read_session(path):
    try:
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "r") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > MAX_SESSION_BYTES:
                raise ValueError()
            return validate_session(json.load(source))
    except SessionError:
        raise
    except Exception:
        raise SessionError("Session input is invalid", "input_file_invalid") from None


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
        # Firefox adds read-only metadata that add_cookies does not accept.
        cookies = [{key: value for key, value in cookie.items() if key not in ("size", "session")}
                   for cookie in page.context.cookies() if reddit_domain(cookie.get("domain"))]
        origin = page.evaluate_read("""() => ({origin: location.origin, localStorage: Object.entries(localStorage).map(([name, value]) => ({name, value}))})""")
        write_session(path, {"version": 1, "seed": seed, "cookies": cookies, "origins": [origin]})
    except Exception:
        raise SessionError("Session output could not be saved") from None


def reuse_session(page, session, feed_url, diagnostics=None, deadline=None, attempts=3):
    def invalid(reason, status="session_invalid"):
        if diagnostics is not None:
            diagnostics["sessionReason"] = reason
        return status

    try:
        # Firefox reads session expiry as -1 but drops cookies set with that value.
        cookies = [{key: value for key, value in cookie.items() if key != "expires" or value != -1}
                   for cookie in session["cookies"]]
        page.context.add_cookies(cookies)
        origins = json.dumps(session["origins"])
        script = "(() => { const records = " + origins + "; const record = records.find(item => item.origin === location.origin); if (record) for (const item of record.localStorage) localStorage.setItem(item.name, item.value); })();"
        with page.add_init_script(script=script):
            navigate(page, feed_url, wait_until="domcontentloaded", timeout=remaining_timeout(deadline), attempts=attempts)
            started = time.monotonic()
            while time.monotonic() - started < 60 and before_deadline(deadline):
                access = state(page)
                if access in ("blocked", "challenge"):
                    return invalid("feed_" + access, "session_" + access)
                if access == "feed":
                    return "reused" if has_account_session(page) else invalid("feed_cookie_missing")
                pause_with_deadline(deadline)
        ensure_remaining(deadline)
        return invalid("feed_timeout")
    except (SessionError, FeedFailure):
        raise
    except Exception:
        raise SessionError("Session could not be restored", "restore_exception") from None


CORE_ATTRIBUTES = ("id", "subreddit-name", "permalink", "content-href", "post-title", "author", "created-timestamp", "score", "comment-count", "post-type")


def read_posts(page, reader):
    posts = page.evaluate_read(reader, {"detail": False})
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


class FeedFailure(RuntimeError):
    def __init__(self, status, diagnostics=None):
        super().__init__(status)
        self.result = {"status": status, **(diagnostics or {})}


def before_deadline(deadline):
    return deadline is None or time.monotonic() < deadline - 1


def ensure_remaining(deadline):
    if not before_deadline(deadline):
        raise FeedFailure("loading_timeout")


def remaining_timeout(deadline, maximum=30000):
    ensure_remaining(deadline)
    return maximum if deadline is None else max(1, min(maximum, int((deadline - time.monotonic() - 1) * 1000)))


def pause_with_deadline(deadline, seconds=1):
    time.sleep(seconds if deadline is None else min(seconds, max(0, deadline - time.monotonic() - 1)))


def wait_batch_feed(page, authenticated, deadline):
    ready_deadline = min(deadline - 1, time.monotonic() + 10)
    while time.monotonic() < ready_deadline:
        access = state(page)
        if access == "feed":
            if authenticated and not has_account_session(page):
                raise FeedFailure("session_invalid", {"sessionReason": "feed_cookie_missing"})
            return
        if access in ("blocked", "challenge"):
            if authenticated:
                raise FeedFailure("session_" + access, {"sessionReason": "feed_" + access})
            raise FeedFailure("blocked" if access == "blocked" else "challenge_required")
        pause_with_deadline(ready_deadline + 1, 0.2)
    raise FeedFailure("loading_timeout")


def snapshot_posts(page, reader, subreddit, limit):
    posts = {}
    for raw in read_posts(page, reader):
        attrs = raw["attributes"]
        if (attrs.get("subreddit-name") or "").lower() != subreddit.lower() or not attrs.get("id"):
            continue
        validate_core(raw)
        posts[attrs["id"]] = raw
        if len(posts) == limit:
            break
    return list(posts.values())


def batch_failure(error, subreddit, reused=False):
    result = {"subreddit": subreddit}
    if isinstance(error, FeedFailure):
        result.update(error.result)
    elif isinstance(error, SessionError):
        result.update(status="session_invalid" if reused else "network_error", **error.diagnostics())
    else:
        result["status"] = "runtime_error"
    return result


def run_all_feeds(config, browser_factory=None):
    from invisible_playwright import InvisiblePlaywright

    feeds = json.loads(SUBREDDITS.read_text())
    source = READER.read_text().strip()
    if not source.startswith("export function readRenderedPosts("):
        raise RuntimeError("Unexpected shared browser reader format")
    reader = "(" + source.removeprefix("export ") + ")"
    deadline = time.monotonic() + getattr(config, "batch_budget_seconds", 130)
    session_input = getattr(config, "session_input", None)
    session_output = getattr(config, "session_output", None)
    authenticate = getattr(config, "authenticate", False)
    session = None
    if session_input:
        try:
            session = read_session(session_input)
        except SessionError as error:
            return {"status": "session_invalid", **error.diagnostics(), "subreddit": feeds[0], "posts": []}
    seed = session["seed"] if session else secrets.randbelow(2**31)
    launch_options = {"headless": True, "extra_prefs": BROWSER_EXTRA_PREFS}
    if session or authenticate:
        launch_options["seed"] = seed
    completed = []
    failure = None
    interrupted = False
    log("Launching one browser for the configured feed batch.")
    with (browser_factory or InvisiblePlaywright)(**launch_options) as browser:
        browser.on("disconnected", lambda *_args: log("Browser disconnected."))
        page = browser.new_page()
        page.on("crash", lambda *_args: log("Browser page crashed."))
        page.on("close", lambda *_args: log("Browser page closed."))
        for index, subreddit in enumerate(feeds):
            try:
                ensure_remaining(deadline)
                log(json.dumps({"eventType": "BROWSER_BATCH_FEED", "subreddit": subreddit, "stage": "loading"}))
                url = f"https://www.reddit.com/r/{subreddit}/rising/"
                if index == 0 and session:
                    diagnostics = {}
                    access = reuse_session(page, session, url, diagnostics=diagnostics, deadline=deadline, attempts=1)
                    if access != "reused":
                        raise FeedFailure(access, diagnostics)
                elif index == 0 and authenticate:
                    access = authenticate_once(page, url, deadline=deadline, attempts=1)
                    if access != "authenticated":
                        raise FeedFailure(access)
                else:
                    navigate(page, url, timeout=remaining_timeout(deadline), attempts=1)
                wait_batch_feed(page, bool(session or authenticate), deadline)
                if index == 0 and session_output:
                    export_session(page, seed, session_output)
                ensure_remaining(deadline)
                selected = snapshot_posts(page, reader, subreddit, config.limit)
                if not selected:
                    raise FeedFailure("empty")
                completed.append({"subreddit": subreddit, "posts": selected})
                log(json.dumps({"eventType": "BROWSER_BATCH_FEED", "subreddit": subreddit, "stage": "collected", "count": len(selected)}))
            except BrowserCancelled:
                interrupted = True
                failure = {"subreddit": subreddit, "status": "loading_timeout"}
                break
            except Exception as error:
                failure = batch_failure(error, subreddit, bool(session))
                break
        if completed and session_output and not interrupted:
            try:
                export_session(page, seed, session_output)
            except SessionError:
                log("Final session snapshot was unavailable. Keeping the verified initial snapshot.")
    if completed:
        result = {"status": "accessible", "feeds": completed}
        if failure:
            result["batchFailure"] = failure
        return result
    return {**(failure or {"status": "empty", "subreddit": feeds[0]}), "posts": []}


def run(config):
    if getattr(config, "all_feeds", False):
        return run_all_feeds(config)
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
        except SessionError as error:
            return {"status": "session_invalid", "sessionReason": error.code, "subreddit": config.subreddit, "posts": []}
    seed = session["seed"] if session else secrets.randbelow(2**31)
    launch_options = {"headless": True, "extra_prefs": BROWSER_EXTRA_PREFS}
    if session or getattr(config, "authenticate", False):
        launch_options["seed"] = seed
    log("Launching the isolated Firefox session.")
    with InvisiblePlaywright(**launch_options) as browser:
        browser.on("disconnected", lambda *_args: log("Browser disconnected."))
        page = browser.new_page()
        page.on("crash", lambda *_args: log("Browser page crashed."))
        page.on("close", lambda *_args: log("Browser page closed."))
        if session:
            diagnostics = {}
            try:
                access = reuse_session(page, session, url, diagnostics=diagnostics, attempts=1)
            except SessionError as error:
                access = "session_invalid"
                diagnostics.update(error.diagnostics())
            if access != "reused":
                return {"status": access, **diagnostics, "subreddit": config.subreddit, "posts": []}
        elif getattr(config, "authenticate", False):
            authentication = authenticate_once(page, url, attempts=1)
            if authentication != "authenticated":
                return {"status": authentication, "subreddit": config.subreddit, "posts": []}
        else:
            log("Loading the configured Reddit feed in a fresh browser session.")
            navigate(page, url, wait_until="domcontentloaded", timeout=30000, attempts=1)
        access_started = time.monotonic()
        last_report = access_started
        while time.monotonic() - access_started < 60:
            current = state(page)
            if time.monotonic() - last_report >= 10:
                log(f"Still waiting for feed access ({current}).")
                last_report = time.monotonic()
            if session and current in ("blocked", "challenge"):
                return {"status": "session_" + current, "sessionReason": "feed_" + current, "subreddit": config.subreddit, "posts": []}
            if current == "blocked":
                return {"status": "blocked", "subreddit": config.subreddit, "posts": []}
            if current == "feed":
                break
            if current == "challenge":
                return {"status": "challenge_required", "sessionReason": "feed_challenge", "subreddit": config.subreddit, "posts": []}
            time.sleep(1)
        else:
            return {"status": "session_invalid" if session else "loading_timeout", **({"sessionReason": "feed_timeout"} if session else {}), "subreddit": config.subreddit, "posts": []}

        if session_output:
            export_session(page, seed, session_output)
        selected = snapshot_posts(page, reader, config.subreddit, config.limit)
        return {"status": "accessible" if selected else "empty", "subreddit": config.subreddit,
                "posts": selected, "durationSeconds": round(time.monotonic() - started, 2)}


def main():
    config = options()
    try:
        with browser_lifecycle():
            result = run(config)
    except SessionError as error:
        if error.code not in ("navigation_network_error", "navigation_http_rejected", "navigation_rate_limited", "feed_challenge"):
            detail = redact(str(error))
            log(f"Browser test failed ({type(error).__name__}): {detail[:1200]}")
            return 1
        result = {"status": "session_invalid" if getattr(config, "session_input", None) else "network_error",
                  **error.diagnostics(), "subreddit": config.subreddit, "posts": []}
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
