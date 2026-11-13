const assert = require("node:assert/strict");
const test = require("node:test");
const { createRedditOAuthSource } = require("./reddit-oauth-source");

const env = { REDDIT_CLIENT_ID: "test-client", REDDIT_SECRET_KEY: "test-secret", REDDIT_USERNAME: "test_account", REDDIT_PASSWORD: "test-password" };
const token = () => Response.json({ access_token: "test-token", token_type: "bearer" });
const child = (subreddit, overrides = {}) => ({ kind: "t3", data: {
  id: "abc", subreddit, title: "Story", domain: "example.com", author: "author",
  url: "https://example.com/story", permalink: `/r/${subreddit}/comments/abc/story/`,
  created_utc: 1710000000, ups: 20, num_comments: 3, thumbnail: "https://i.redd.it/story.png",
  selftext: "body not used by F5", unrelated: "not retained", ...overrides,
} });
const listing = (subreddit, headers, children = [child(subreddit)]) => Response.json({ kind: "Listing", data: { children } }, { headers });

test("one token serves three validated Rising listings under a shared deadline", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? token() : listing(url.split("/")[4]);
  };
  const result = await createRedditOAuthSource({ env, fetchImpl })();
  assert.deepEqual(result.feeds.map(({ subreddit }) => subreddit), ["politics", "news", "worldnews"]);
  assert.equal(result.feeds[0].children[0].data.thumbnail, "https://i.redd.it/story.png");
  assert.equal(result.feeds[0].children[0].data.selftext, undefined);
  assert.equal(result.feeds[0].children[0].data.unrelated, undefined);
  assert.equal(calls[0].url, "https://www.reddit.com/api/v1/access_token");
  assert.equal(calls[0].options.body.get("grant_type"), "password");
  assert.match(calls[0].options.headers["User-Agent"], /^linux:f5\.news:[\d.]+ \(by \/u\/test_account\)$/);
  assert.ok(calls.every(({ options }) => options.signal === calls[0].options.signal && options.redirect === "error"));
  assert.ok(calls.slice(1).every(({ url, options }) => url.startsWith("https://oauth.reddit.com/") &&
    url.endsWith("/rising?limit=25&raw_json=1") && options.headers.Authorization === "Bearer test-token"));
});

test("HTTP 429 preserves completed feeds and stops further requests", async () => {
  let calls = 0;
  const scrape = createRedditOAuthSource({ env, fetchImpl: async () => {
    calls += 1;
    if (calls === 1) return token();
    if (calls === 2) return listing("politics");
    return new Response("private upstream body", { status: 429, headers: { "retry-after": "30" } });
  } });
  const result = await scrape();
  assert.equal(calls, 3);
  assert.deepEqual(result.feeds.map(({ subreddit }) => subreddit), ["politics"]);
  assert.deepEqual(result.batchFailure, { subreddit: "news", status: "network_error", oauthStage: "listing",
    oauthReason: "http_error", httpStatus: 429, retryAfterSeconds: 30 });
  assert.doesNotMatch(JSON.stringify(result), /private upstream body/);
});

test("exhausted rate-limit header stops reads even on HTTP 200", async () => {
  for (const subreddits of [["politics"], ["politics", "news"]]) {
    let calls = 0;
    const scrape = createRedditOAuthSource({ env, fetchImpl: async () => ++calls === 1 ? token() :
      listing("politics", { "x-ratelimit-remaining": "0.0", "x-ratelimit-reset": "52" }) });
    const result = await scrape({ subreddits });
    assert.equal(calls, 2);
    assert.equal(result.feeds.length, 1);
    if (subreddits.length === 1) assert.deepEqual(result.rateLimit, { retryAfterSeconds: 52 });
    else assert.equal(result.batchFailure.oauthReason, "rate_limit_exhausted");
  }
});

test("invalid, duplicate, or cross-feed listing rows reject", async () => {
  for (const rows of [[null], [child("news")], [child("politics"), child("politics")],
    [child("politics", { url: "javascript:alert(1)" })], [child("politics", { permalink: "/r/politics/comments/wrong/story/" })]]) {
    let calls = 0;
    const scrape = createRedditOAuthSource({ env, fetchImpl: async () => ++calls === 1 ? token() : listing("politics", undefined, rows) });
    await assert.rejects(scrape({ subreddits: ["politics"] }), { oauthStage: "listing", oauthReason: "invalid_post" });
  }
});

test("missing credentials and token rejection surface safe errors", async () => {
  await assert.rejects(createRedditOAuthSource({ env: {}, fetchImpl: async () => assert.fail("Unexpected request") })(),
    { oauthStage: "token", oauthReason: "configuration_missing" });
  const scrape = createRedditOAuthSource({ env, fetchImpl: async () => new Response("private token response", { status: 403 }) });
  await assert.rejects(scrape(), (error) => error.httpStatus === 403 && error.oauthStage === "token" &&
    !error.message.includes("private") && !error.message.includes(env.REDDIT_SECRET_KEY));
});

test("upstream deadline failure is normalized without exposing request data", async () => {
  const scrape = createRedditOAuthSource({ env, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("upstream failed")), 100);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  }) });
  await assert.rejects(scrape({ timeoutMs: 5 }), { oauthStage: "token", oauthReason: "timeout" });
});
