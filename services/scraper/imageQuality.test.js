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
    if (operator === "$in") return operand.includes(post[field]);
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
