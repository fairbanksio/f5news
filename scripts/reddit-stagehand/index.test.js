import assert from "node:assert/strict";
import test from "node:test";
import { checkChrome, createProgress, extractRising, failureMessage, readOptions, waitForReddit } from "./index.js";

const post = {
  attributes: {
    id: "t3_abc123", "subreddit-name": "news", "post-type": "link",
    "post-title": "Example Story", permalink: "/r/news/comments/abc123/example_story/",
    "content-href": "https://example.com/story", author: "example", domain: "example.com",
    score: "42", "comment-count": "12", "upvote-ratio": "0.9",
    "created-timestamp": "2026-11-06T05:42:36.512000+0000",
  },
  thumbnail: null, images: [], video: null, selftext: "", selftextHtml: "", mediaComplete: true,
};
const env = {};
const quietProgress = { log() {}, step: async (_label, operation) => operation() };
const options = (args = []) => readOptions(["--limit", "1", ...args], env);

test("Reddit human checks wait for the user and fail without inference when unresolved", async () => {
  let now = 0;
  const states = ["challenge", "ready"];
  const logs = [];
  const progress = { log: (line) => logs.push(line) };
  await waitForReddit({ evaluate: async () => states.shift() }, progress, { now: () => now, sleep: async () => { now += 2_000; } });
  assert.equal(logs.length, 1);
  await assert.rejects(waitForReddit({ evaluate: async () => "blocked" }, progress), /No results were saved/);
  await assert.rejects(waitForReddit({ evaluate: async () => "challenge" }, progress, { now: () => now, sleep: async () => { now += 2_000; }, timeoutMs: 2_000 }), /human check is still present/);
});

test("Chrome preflight fails clearly for a missing endpoint or invalid service", async () => {
  await assert.rejects(checkChrome("http://127.0.0.1:9222", async () => { throw new Error("ECONNREFUSED"); }), /Chrome DevTools is unavailable/);
  await assert.rejects(checkChrome("http://127.0.0.1:9222", async () => ({ ok: true, json: async () => ({}) })), /Chrome DevTools is unavailable/);
  await checkChrome("http://127.0.0.1:9222", async (url, options) => {
    assert.equal(url.pathname, "/json/version");
    assert.ok(options.signal);
    return { ok: true, json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/test" }) };
  });
});

test("Chrome in-session debugging resolves its active browser target without HTTP discovery", async () => {
  const fetchImpl = async () => ({ status: 404 });
  const endpoint = await checkChrome("http://127.0.0.1:9222", fetchImpl, async () => "9222\n/devtools/browser/test-browser\n");
  assert.equal(endpoint, "ws://127.0.0.1:9222/devtools/browser/test-browser");
  await assert.rejects(checkChrome("http://127.0.0.1:9222", fetchImpl, async () => "9223\n/devtools/browser/wrong\n"), /unavailable/);
  await assert.rejects(checkChrome("http://127.0.0.1:9222", fetchImpl, async () => "9222\n/invalid\n"), /unavailable/);
});

test("progress reports long waits and stops the heartbeat after success or failure", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const lines = [];
  let now = 0;
  const progress = createProgress({ write: (line) => lines.push(line), now: () => now });
  let finish;
  const pending = progress.step("Connecting to Chrome", () => new Promise((resolve) => { finish = resolve; }));
  now = 10_000;
  t.mock.timers.tick(10_000);
  assert.match(lines.at(-1), /Still waiting: connecting to chrome/);
  finish();
  await pending;
  assert.match(lines.at(-1), /done \(10.0s\)/);
  const count = lines.length;
  t.mock.timers.tick(10_000);
  assert.equal(lines.length, count);
  await assert.rejects(progress.step("Extracting posts", async () => { throw new Error("secret-details"); }));
  assert.match(lines.at(-1), /Extracting posts: failed/);
  assert.ok(!lines.join("\n").includes("secret-details"));
  const failedCount = lines.length;
  t.mock.timers.tick(10_000);
  assert.equal(lines.length, failedCount);
});

test("errors identify prerequisites without exposing SDK request details", () => {
  assert.match(failureMessage(new Error("ECONNREFUSED sk-secret")), /Cannot connect to Chrome/);
  assert.match(failureMessage(new Error("Extensions.loadUnpacked failed sk-secret")), /Stagehand extension/);
  assert.match(failureMessage(new Error("CDP websocket failed to open")), /extension's WebSocket origin/);
  assert.match(failureMessage(new Error("401 apiKey=sk-secret")), /Extraction failed/);
  assert.ok(!failureMessage(new Error("request with sk-secret failed")).includes("sk-secret"));

});

test("options restrict navigation and keep extraction bounded", () => {
  assert.equal(readOptions([], env).subreddit, "news");
  assert.equal(readOptions([], env).limit, 25);
  assert.equal(readOptions(["--limit", "25"], env).limit, 25);
  assert.throws(() => readOptions(["--subreddit", "news/../../login"], env));
  assert.throws(() => readOptions(["--limit", "26"], env));
  assert.throws(() => readOptions([], { ...env, CHROME_CDP_URL: "https://example.com" }));
  assert.equal(readOptions([], {}).subreddit, "news");
  assert.equal(readOptions(["--help"], {}).help, true);
});

function mockSdk({ failAt, posts = [post] } = {}) {
  const calls = [];
  let evaluations = 0;
  let navigations = 0;
  const page = {
    evaluate: async () => evaluations++ === 0 ? "ready" : posts,
    goto: async (url) => {
      calls.push(url);
      if (navigations++ > 0 && failAt === "detail") throw new Error("detail failed");
      return { ok: () => true };
    },
    close: async () => { calls.push("tab.close"); if (failAt === "close") throw new Error("close failed"); },
  };
  const browser = {
    context: { newPage: async () => page },
    close: async () => { throw new Error("Must never close Chrome"); },
    disconnect: async () => { calls.push("disconnect"); },
  };
  return {
    calls,
    localBrowser: { connect: async () => browser },
    Stagehand: { create: async (configuration) => {
      assert.equal(configuration.browser, browser);
      assert.equal(configuration.model, undefined);
      assert.equal(configuration.apiKey, undefined);
      if (failAt === "create") throw new Error("init failed");
      return new Proxy({}, { get: (_target, key) => { if (key === "then") return undefined; throw new Error("No model operation is allowed"); } });
    } },
  };
}

test("exact extraction needs no API key or model operation and closes its own tab", async () => {
  const sdk = mockSdk();
  const result = await extractRising(options(), sdk, quietProgress);
  assert.equal(result.sort, "rising");
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].upvoteCount, 42);
  assert.equal(result.posts[0].created_utc, 1793943756);
  assert.equal(result.redditListing.data.children[0].data.ups, 42);
  assert.equal(result.readyForImport, true);
  assert.equal(result.completeness[0].ready, true);
  assert.deepEqual(sdk.calls, ["https://www.reddit.com/r/news/rising/", "tab.close", "disconnect"]);
});

test("incomplete records remain inspectable and are excluded from the import listing", async () => {
  const incomplete = { ...post, attributes: { ...post.attributes, score: null } };
  const result = await extractRising(options(), mockSdk({ posts: [incomplete] }), quietProgress);
  assert.equal(result.posts[0].upvoteCount, null);
  assert.equal(result.redditListing.data.children.length, 0);
  assert.equal(result.readyForImport, false);
  assert.equal(result.completeness[0].id, "abc123");
  assert.ok(result.completeness[0].missingFields.includes("upvoteCount"));
});

test("launch mode uses the installed Chrome and closes only the browser it owns", async () => {
  const sdk = mockSdk();
  let launchOptions;
  sdk.localBrowser.launch = async (configuration) => {
    launchOptions = configuration;
    const browser = await sdk.localBrowser.connect();
    browser.close = async () => sdk.calls.push("prototype.close");
    return browser;
  };
  const result = await extractRising(options(["--launch"]), sdk, quietProgress);
  assert.equal(launchOptions.executablePath, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  assert.equal(launchOptions.headless, false);
  assert.ok(launchOptions.userDataDir.endsWith(".chrome-profile"));
  assert.equal(result.posts.length, 1);
  assert.equal(sdk.calls.at(-1), "prototype.close");
  assert.ok(!sdk.calls.includes("disconnect"));
});

for (const failAt of ["create", "close", "detail"]) {
  test(`Chrome stays open when ${failAt} fails`, async () => {
    const posts = failAt === "detail" ? [{ ...post, attributes: { ...post.attributes, "post-type": "gallery" } }] : [post];
    const sdk = mockSdk({ failAt, posts });
    await assert.rejects(extractRising(options(), sdk, quietProgress));
    assert.equal(sdk.calls.at(-1), "disconnect");
    if (failAt === "detail") assert.equal(sdk.calls.at(-2), "tab.close");
  });
}
