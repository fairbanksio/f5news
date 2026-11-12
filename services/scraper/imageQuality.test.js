const assert = require("node:assert/strict");
const test = require("node:test");
const { createFetchPosts, backfillMissingPostImages } = require("./index");

const logger = { log() {}, warn() {}, error() {} };
const small = "https://external-preview.redd.it/story.jpg?width=140&s=original";
const large = "https://external-preview.redd.it/story.jpg?width=1080&s=published";
const now = new Date("2026-11-06T20:00:00Z");
const record = (overrides = {}) => ({
  _id: "fixture", title: "Story", author: "fixture", created_utc: now.getTime() / 1000 - 100,
  sub: "politics", domain: "publisher.example", url: "https://publisher.example/story", thumbnail: small,
  ...overrides,
});

const matches = (post, filter) => Object.entries(filter).every(([field, value]) => {
  if (field === "$or") return value.some((clause) => matches(post, clause));
  if (field === "$and") return value.every((clause) => matches(post, clause));
  if (value === null) return post[field] == null;
  if (typeof value !== "object") return post[field] === value;
  return Object.entries(value).every(([operator, operand]) => {
    if (operator === "$exists") return (post[field] !== undefined) === operand;
    if (operator === "$ne") return post[field] !== operand;
    if (operator === "$in") return operand.includes(post[field] ?? null);
    if (operator === "$nin") return !operand.includes(post[field]);
    if (operator === "$gt") return post[field] > operand;
    if (operator === "$lt") return post[field] < operand;
    if (operator === "$regex") return new RegExp(operand, value.$options).test(post[field] || "");
    if (operator === "$options") return true;
    throw new Error(`Unsupported query operator ${operator}`);
  });
});

const model = (posts) => ({
  find(filter) {
    let selected = posts.filter((post) => matches(post, filter));
    return {
      sort() { selected.sort((a, b) => b.created_utc - a.created_utc); return this; },
      limit(count) { selected = selected.slice(0, count); return this; },
      then(resolve) { return Promise.resolve(selected.map((post) => ({ ...post }))).then(resolve); },
    };
  },
  async findOneAndUpdate(filter, update) {
    const post = posts.find((candidate) => matches(candidate, filter));
    if (post) Object.assign(post, update.$set);
    return post || null;
  },
});

test("small scrape fallbacks never overwrite large or unknown existing images", async () => {
  for (const thumbnail of [large, "https://cdn.example/original.jpg", "https://external-preview.redd.it/original.jpg", `${small}&width=1080`]) {
    const stored = record({ thumbnail });
    const handler = createFetchPosts({
      scrapePostsImpl: async () => [{ data: record() }],
      imageSourceImpl: async () => small,
      mongooseClient: { connect: async () => {} }, newPostModel: model([stored]), logger,
      now: () => now,
    });
    await handler({ subreddit: "politics" });
    assert.equal(stored.thumbnail, thumbnail);
  }
});

test("a new post can keep its small fallback and a later source can upgrade it", async () => {
  const stored = record({ thumbnail: undefined });
  let selected = small;
  const handler = createFetchPosts({
    scrapePostsImpl: async () => [{ data: record() }], imageSourceImpl: async () => selected,
    mongooseClient: { connect: async () => {} }, newPostModel: model([stored]), logger, now: () => now,
  });
  await handler({ subreddit: "politics" });
  assert.equal(stored.thumbnail, small);
  selected = large;
  await handler({ subreddit: "politics" });
  assert.equal(stored.thumbnail, large);
});

test("a concurrent image upgrade survives a stale low-resolution scrape write", async () => {
  const stored = record();
  const handler = createFetchPosts({
    scrapePostsImpl: async () => [{ data: record() }], imageSourceImpl: async () => { stored.thumbnail = large; return small; },
    mongooseClient: { connect: async () => {} }, newPostModel: model([stored]), logger, now: () => now,
  });
  await handler({ subreddit: "politics" });
  assert.equal(stored.thumbnail, large);
});

test("recent small-image repairs verify larger bytes and respect the hourly cooldown", async () => {
  for (const width of [1080, 140, null]) {
    const stored = record();
    let attempts = 0;
    let probes = 0;
    const options = {
      newPostModel: model([stored]), logger, now: () => now,
      imageSourceImpl: async (_post, preferences) => { assert.equal(preferences.preferArticleImage, true); attempts += 1; return "https://cdn.example/original.jpg"; },
      fetchImageWidthImpl: async () => { probes += 1; return width; },
    };
    await backfillMissingPostImages("politics", options);
    assert.equal(stored.thumbnail, width === 1080 ? "https://cdn.example/original.jpg" : small);
    assert.equal(stored.thumbnailQualityCheckedAt.getTime(), now.getTime());
    await backfillMissingPostImages("politics", options);
    assert.equal(attempts, 1);
    assert.equal(probes, 1);
  }
});

test("old, large, unknown-size, and native-media records are excluded from quality repair", async () => {
  const posts = [
    record({ _id: "old", created_utc: now.getTime() / 1000 - 9 * 3600 }),
    record({ _id: "large", thumbnail: large }),
    record({ _id: "unknown", thumbnail: "https://external-preview.redd.it/original.jpg" }),
    record({ _id: "image", post_hint: "image" }),
    record({ _id: "gallery", is_gallery: true }),
  ];
  await backfillMissingPostImages("politics", {
    newPostModel: model(posts), logger, now: () => now,
    imageSourceImpl: async () => { throw new Error("Unexpected image repair"); },
    fetchImageWidthImpl: async () => { throw new Error("Unexpected image probe"); },
  });
  assert.ok(posts.every((post) => post.thumbnailQualityCheckedAt === undefined));
});

test("a concurrent better image also survives the backfill repair write", async () => {
  const stored = record();
  await backfillMissingPostImages("politics", {
    newPostModel: model([stored]), logger, now: () => now,
    imageSourceImpl: async () => "https://cdn.example/replacement.jpg",
    fetchImageWidthImpl: async () => { stored.thumbnail = large; return 1200; },
  });
  assert.equal(stored.thumbnail, large);
});

test("manual publisher backfill repairs only verified external images without reading Reddit", async () => {
  const improved = "https://cdn.example/large.jpg";
  const posts = [
    record({ _id: "small", title: "Small" }),
    record({ _id: "missing", title: "Missing", thumbnail: undefined }),
    record({ _id: "unverified", title: "Unverified" }),
    record({ _id: "concurrent", title: "Concurrent", thumbnail: undefined }),
    record({ _id: "reddit", url: "https://www.reddit.com./r/politics/comments/a", thumbnail: undefined }),
    record({ _id: "gallery", is_gallery: true, thumbnail: undefined }),
    record({ _id: "otherfeed", sub: "news" }),
    record({ _id: "large", thumbnail: large }),
  ];
  const calls = [];
  const neverReadReddit = () => { throw new Error("Unexpected Reddit read"); };
  const handler = createFetchPosts({
    scrapePostsImpl: neverReadReddit, scrapeBatchImpl: neverReadReddit, inspectSessionImpl: neverReadReddit,
    newPostModel: model(posts), mongooseClient: { connect: async () => {} }, logger, now: () => now,
    imageSourceImpl: async (post, options) => {
      assert.equal(options.publisherOnly, true);
      calls.push(post._id);
      return `${improved}?id=${post._id}`;
    },
    fetchImageWidthImpl: async (url, options) => {
      assert.equal(options.publisherOnly, true);
      const id = new URL(url).searchParams.get("id");
      if (id === "concurrent") posts[3].thumbnail = large;
      return id === "unverified" ? 140 : 1200;
    },
  });
  const event = { publisherImageBackfill: true, subreddit: "politics" };
  const result = await handler(event);
  assert.deepEqual(result, { eventType: "PUBLISHER_IMAGE_BACKFILL_COMPLETED", subreddit: "politics",
    candidates: 4, attempts: 4, updated: 2, errors: 0, dependencyFailures: 0, deferred: false });
  assert.deepEqual(calls.sort(), ["concurrent", "missing", "small", "unverified"]);
  assert.equal(posts[0].thumbnail, `${improved}?id=small`);
  assert.equal(posts[1].thumbnail, `${improved}?id=missing`);
  assert.equal(posts[2].thumbnail, small);
  assert.equal(posts[3].thumbnail, large);
  assert.equal((await handler(event)).attempts, 0);
  await assert.rejects(handler({ ...event, scheduled: true }), /standalone manual/);
  await assert.rejects(handler({ ...event, subreddit: "unsupported" }), /configured subreddit/);
  await assert.rejects(handler(event, { getRemainingTimeInMillis: () => 5000 }), /Insufficient time/);
});

test("manual publisher backfill caps work at ten records", async () => {
  const posts = Array.from({ length: 14 }, (_, id) => record({ _id: String(id), title: `Story ${id}`, thumbnail: undefined }));
  const handler = createFetchPosts({
    newPostModel: model(posts), mongooseClient: { connect: async () => {} }, logger, now: () => now,
    imageSourceImpl: async () => "",
  });
  const result = await handler({ publisherImageBackfill: true, subreddit: "politics" });
  assert.equal(result.candidates, 10);
  assert.equal(result.attempts, 10);
  assert.equal(result.updated, 0);
  assert.equal(posts.filter((post) => post.thumbnailQualityCheckedAt).length, 10);
});


test("a concurrent sharp upgrade survives an intermediate-width optional fallback", async () => {
  const stored = record();
  const intermediate = "https://external-preview.redd.it/story.jpg?width=640&s=fallback";
  const handler = createFetchPosts({
    scrapePostsImpl: async () => [{ data: record() }],
    imageSourceImpl: async () => { stored.thumbnail = large; return intermediate; },
    mongooseClient: { connect: async () => {} }, newPostModel: model([stored]), logger, now: () => now,
  });
  await handler({ subreddit: "politics" });
  assert.equal(stored.thumbnail, large);
});

test("targeted publisher backfill verifies one recent external post and skips the article fetch", async () => {
  const thumbnail = "https://cdn.example/public-story.jpg";
  const posts = [
    record({ _id: "selected", commentLink: "/r/politics/comments/abc/story/", thumbnailQualityCheckedAt: now }),
    record({ _id: "different", commentLink: "/r/politics/comments/abcd/story/" }),
    record({ _id: "wrongFeed", sub: "news", commentLink: "/r/news/comments/abc/story/" }),
    record({ _id: "old", commentLink: "/r/politics/comments/abc/story/", created_utc: now.getTime() / 1000 - 9 * 3600 }),
  ];
  const writes = [];
  const postModel = model(posts);
  const handler = createFetchPosts({
    newPostModel: { ...postModel, findOneAndUpdate: (...args) => { writes.push(args[0]); return postModel.findOneAndUpdate(...args); } },
    mongooseClient: { connect: async () => {} }, logger, now: () => now,
    imageSourceImpl: () => { throw new Error("Unexpected article fetch"); },
    scrapePostsImpl: () => { throw new Error("Unexpected Reddit read"); },
    fetchImageWidthImpl: async (url, options) => {
      assert.equal(url, thumbnail);
      assert.deepEqual(options, { publisherOnly: true, httpsOnly: true });
      return 1200;
    },
  });
  const event = { publisherImageBackfill: true, subreddit: "politics", publisherPostId: "abc", publisherImageUrl: thumbnail };
  const result = await handler(event);
  assert.equal(result.publisherPostId, "abc");
  assert.equal(result.candidates, 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.updated, 1);
  assert.deepEqual(writes, [{ _id: "selected", thumbnail: small }]);
  assert.deepEqual(posts.map((post) => post.thumbnail), [thumbnail, small, small, small]);
  assert.equal((await handler(event)).candidates, 0);
});

test("targeted publisher backfill rejects unsafe input and preserves the existing cover on failed verification or a concurrent update", async () => {
  const stored = record({ commentLink: "/r/politics/comments/abc/story/" });
  let concurrent = false;
  const handler = createFetchPosts({
    newPostModel: model([stored]), mongooseClient: { connect: async () => {} }, logger, now: () => now,
    fetchImageWidthImpl: async () => {
      if (concurrent) stored.thumbnail = large;
      return concurrent ? 1200 : 320;
    },
  });
  const event = { publisherImageBackfill: true, subreddit: "politics", publisherPostId: "abc", publisherImageUrl: "https://cdn.example/public.jpg" };
  for (const publisherImageUrl of ["http://cdn.example/story.jpg", "https://cdn.example:8443/story.jpg",
    "https://user:password@cdn.example/story.jpg", "https://preview.redd.it/story.jpg", undefined]) {
    await assert.rejects(handler({ ...event, publisherImageUrl }), /public HTTPS/);
  }
  await assert.rejects(handler({ ...event, publisherImageBackfill: false }), /requires publisher image backfill/);
  assert.equal((await handler(event)).updated, 0);
  assert.equal(stored.thumbnail, small);
  assert.equal(stored.thumbnailQualityCheckedAt, undefined);
  concurrent = true;
  assert.equal((await handler(event)).updated, 0);
  assert.equal(stored.thumbnail, large);
});
