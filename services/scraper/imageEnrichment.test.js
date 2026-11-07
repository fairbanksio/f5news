const test = require("node:test");
const assert = require("node:assert/strict");
const { createFetchPosts, backfillMissingPostImages } = require("./index");
const { hasUsableThumbnail, isSmallRedditThumbnail } = require("./imageSource");
const feeds = require("../posts/subreddits.json");
const small = "https://external-preview.redd.it/story.jpg?width=140";
const large = "https://cdn.example/sharp.jpg";
const child = (subreddit, overrides = {}) => ({ kind: "t3", data: {
  id: `p${subreddit}`, title: `${subreddit} Story`, author: "author", created_utc: Math.floor(Date.now() / 1000) - 100,
  subreddit, domain: "publisher.example", url: `https://publisher.example/${subreddit}`, permalink: `/r/${subreddit}/comments/p${subreddit}/story/`,
  thumbnail: "default", is_self: false, is_video: false, post_hint: "link", ups: 10, num_comments: 2, ...overrides,
} });
const identity = (post) => JSON.stringify([post.title, post.author, post.created_utc]);

const harness = ({ children = feeds.map((feed) => child(feed)), stored = [], resolve = async () => "", beforeThumbnailWrite = () => {} } = {}) => {
  const records = stored.map((post) => ({ ...post }));
  const logs = [];
  const calls = [];
  const writes = [];
  const query = (filter) => {
    let priority = false;
    let limit = 25;
    return {
      sort() { return this; }, limit(value) { limit = value; return this; },
      select() { priority = true; return this; }, maxTimeMS() { return this; }, setOptions() { return this; },
      then(done) { return Promise.resolve(priority ? [] : records.filter((post) => post.sub === filter.sub &&
        (!hasUsableThumbnail(post.thumbnail) || isSmallRedditThumbnail(post.thumbnail))).slice(0, limit).map((post) => ({ ...post }))).then(done); },
    };
  };
  const handler = createFetchPosts({
    env: {}, mongooseClient: { connect: async () => {} },
    logger: { log: (line) => logs.push(JSON.parse(line)), warn: (line) => logs.push(JSON.parse(line)), error: (line) => logs.push(JSON.parse(line)) },
    scrapePostsImpl: async ({ subreddit }) => children.filter((entry) => entry.data.subreddit === subreddit),
    scrapeBatchImpl: async () => ({ feeds: feeds.map((subreddit) => ({ subreddit, children: children.filter((entry) => entry.data.subreddit === subreddit) })),
      sessionMode: "reused", sessionGeneration: "generation-1", failures: [] }),
    imageSourceImpl: async (post, options) => { calls.push({ post, coreCount: writes.filter((entry) => entry.options.upsert).length }); return resolve(post, options); },
    newPostModel: {
      find: query,
      async findOneAndUpdate(filter, update, options) {
        writes.push({ filter, update, options });
        let post = records.find((entry) => filter._id ? entry._id === filter._id : identity(entry) === identity(filter));
        if (!post && !options.upsert) return null;
        if (update.$set.thumbnail) beforeThumbnailWrite(post);
        if (filter.$or && post && hasUsableThumbnail(post.thumbnail) && !isSmallRedditThumbnail(post.thumbnail)) return null;
        if (Object.hasOwn(filter, "thumbnail")) {
          if (filter.thumbnail?.$exists === false ? post?.thumbnail !== undefined : post?.thumbnail !== filter.thumbnail) return null;
        }
        const previous = post ? { ...post } : null;
        if (!post) { post = { _id: `row-${records.length}` }; records.push(post); }
        Object.assign(post, update.$set);
        return previous;
      },
    },
  });
  return { handler, records, logs, calls, writes };
};

const storedRow = (entry, thumbnail = large) => ({ ...entry.data, _id: entry.data.id, sub: entry.data.subreddit, thumbnail });

test("stored sharp thumbnails avoid publisher work in both single-feed and batch enrichment", async () => {
  for (const batch of [false, true]) {
    const children = feeds.map((feed) => child(feed, { thumbnail: small }));
    const fixture = harness({ children, stored: children.map((entry) => storedRow(entry)), resolve: async () => assert.fail("A retained sharp image must not trigger publisher enrichment") });
    await fixture.handler(batch ? { allFeeds: true } : { subreddit: feeds[0] });
    assert.equal(fixture.calls.length, 0);
    assert.ok(fixture.records.every((row) => row.thumbnail === large));
    assert.ok(fixture.logs.filter((entry) => entry.eventType === "SCRAPER_JOB_COMPLETED").every((entry) => entry.outcome === "success"));
  }
});

test("new sharp listing previews still replace stored images without publisher requests", async () => {
  const replacement = "https://preview.redd.it/replacement.jpg?width=1080";
  const entry = child(feeds[0], { preview: { images: [{ source: { url: replacement } }] } });
  const fixture = harness({ children: [entry], stored: [storedRow(entry)], resolve: async () => assert.fail("Published previews need no publisher request") });
  await fixture.handler({ subreddit: feeds[0] });
  assert.equal(fixture.records[0].thumbnail, replacement);
  assert.equal(fixture.calls.length, 0);
});

test("missing batch images get one attempt each after every core row is saved", async () => {
  const fixture = harness();
  const result = await fixture.handler({ allFeeds: true });
  assert.equal(fixture.calls.length, feeds.length);
  assert.ok(fixture.calls.every((call) => call.coreCount === feeds.length));
  assert.ok(result.feedResults.every((feed) => feed.outcome === "degraded"));
  for (const terminal of fixture.logs.filter((entry) => entry.eventType === "SCRAPER_JOB_COMPLETED")) {
    assert.equal(terminal.imageAttempts, 1);
    assert.equal(terminal.imageMissing, 1);
    assert.equal(terminal.imageErrors, 0);
  }
});

test("failed scrape enrichment stays degraded and is not retried immediately by backfill", async () => {
  const entry = child(feeds[0]);
  const fixture = harness({ children: [entry], resolve: async () => { throw new Error("Publisher unavailable"); } });
  await fixture.handler({ subreddit: feeds[0] });
  assert.equal(fixture.calls.length, 1);
  const terminal = fixture.logs.find((record) => record.eventType === "SCRAPER_JOB_COMPLETED");
  assert.equal(terminal.outcome, "degraded");
  assert.equal(terminal.imageAttempts, 1);
  assert.equal(terminal.imageMissing, 1);
  assert.equal(terminal.imageErrors, 1);
});

test("deduplication retains backfill for a different eligible post", async () => {
  const entry = child(feeds[0]);
  const older = child(feeds[0], { id: "older", title: "Older Story", created_utc: entry.data.created_utc - 100 });
  const fixture = harness({ children: [entry], stored: [storedRow(older, "")] });
  await fixture.handler({ subreddit: feeds[0] });
  assert.equal(fixture.calls.length, 2);
  assert.deepEqual(new Set(fixture.calls.map((call) => call.post.title)), new Set([entry.data.title, older.data.title]));
});

test("usable fallbacks retain dependency failure counts and emit sanitized degraded diagnostics", async () => {
  const entry = child(feeds[0], { thumbnail: small });
  const fixture = harness({ children: [entry], resolve: async (post, options) => {
    options.onArticleImageFailure({ reason: "http_status", status: 403, url: "https://reader:password@publisher.example/story?token=private-token", retryCount: 1 });
    return small;
  } });
  await fixture.handler({ subreddit: feeds[0] });
  assert.equal(fixture.calls.length, 1);
  const diagnostic = fixture.logs.find((record) => record.eventType === "POST_IMAGE_RESOLUTION_DEGRADED");
  assert.equal(diagnostic.severity, "warn");
  assert.equal(diagnostic.imageResolutionFailures[0].status, 403);
  assert.equal(JSON.stringify(diagnostic).includes("private-token"), false);
  assert.equal(JSON.stringify(diagnostic).includes("reader:password"), false);
  const terminal = fixture.logs.find((record) => record.eventType === "SCRAPER_JOB_COMPLETED");
  assert.equal(terminal.outcome, "degraded");
  assert.equal(terminal.imageResolved, 1);
  assert.equal(terminal.imageMissing, 0);
  assert.equal(terminal.imageErrors, 0);
  assert.equal(terminal.imageDependencyFailures, 1);
});


test("backfill fallback diagnostics stay bounded and preserve missing and error metric semantics", async () => {
  const logs = [];
  const entry = storedRow(child(feeds[0]), "");
  const metrics = await backfillMissingPostImages(feeds[0], {
    newPostModel: { find: async () => [entry], findOneAndUpdate: async () => {} },
    logger: { log: (line) => logs.push(JSON.parse(line)), warn: (line) => logs.push(JSON.parse(line)) },
    imageSourceImpl: async (post, options) => {
      for (let attempt = 0; attempt < 5; attempt += 1) options.onArticleImageFailure({ reason: "http_status", status: 429,
        url: `https://reader:password@publisher.example/${attempt}?token=private-token` });
      return small;
    },
  });
  const diagnostic = logs.find((record) => record.eventType === "POST_IMAGE_BACKFILL_DEGRADED");
  assert.equal(diagnostic.imageResolutionFailures.length, 3);
  assert.equal(JSON.stringify(diagnostic).includes("private-token"), false);
  assert.equal(metrics.resolved, 1);
  assert.equal(metrics.dependencyFailures, 1);
  assert.equal(metrics.missing, 0);
  assert.equal(metrics.errors, 0);
});


test("known-width listing updates never downgrade stored images and still accept larger previews", async () => {
  for (const batch of [false, true]) {
    for (const [priorWidth, nextWidth] of [[1080, 640], [1080, 500], [640, 1080]]) {
      const previous = `https://preview.redd.it/story.jpg?width=${priorWidth}`;
      const candidate = `https://preview.redd.it/story.jpg?width=${nextWidth}`;
      const children = feeds.map((feed) => child(feed, { preview: { images: [{ source: { url: candidate } }] } }));
      const fixture = harness({ children, stored: children.map((entry) => storedRow(entry, previous)),
        resolve: async () => assert.fail("Known listing previews do not need publisher work") });
      await fixture.handler(batch ? { allFeeds: true } : { subreddit: feeds[0] });
      const checked = batch ? fixture.records : fixture.records.filter((row) => row.sub === feeds[0]);
      assert.ok(checked.every((row) => row.thumbnail === (nextWidth > priorWidth ? candidate : previous)));
      assert.equal(fixture.calls.length, 0);
    }
  }
});


test("concurrent upgrades survive intermediate-width batch core and optional writes", async () => {
  const previous = "https://preview.redd.it/story.jpg?width=640";
  const candidate = "https://preview.redd.it/story.jpg?width=800";
  const upgraded = "https://preview.redd.it/story.jpg?width=1080";
  const children = feeds.map((feed) => child(feed, { preview: { images: [{ source: { url: candidate } }] } }));
  const fixture = harness({ children, stored: children.map((entry) => storedRow(entry, previous)),
    beforeThumbnailWrite: (post) => { post.thumbnail = upgraded; },
    resolve: async () => assert.fail("Published previews need no publisher work"),
  });
  await fixture.handler({ allFeeds: true });
  assert.ok(fixture.records.every((row) => row.thumbnail === upgraded));
  assert.ok(fixture.writes.filter((write) => write.update.$set.thumbnail).every((write) => write.filter.thumbnail === previous));
});
