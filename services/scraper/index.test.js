const assert = require("assert");
const test = require("node:test");

const { backfillMissingPostImages, createFetchPosts } = require("./index");

const createFetcher = ({ accessToken = "token", posts = [] } = {}) => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });

    if (url === "https://www.reddit.com/api/v1/access_token") {
      return {
        json: async () => ({ access_token: accessToken }),
      };
    }

    return {
      json: async () => ({
        data: {
          children: posts,
        },
      }),
    };
  };

  return { calls, fetchImpl };
};

const createLogger = () => ({
  logs: [],
  warnings: [],
  log(...args) {
    this.logs.push(args);
  },
  error(...args) {
    this.logs.push(args);
  },
  warn(...args) {
    this.warnings.push(args);
    this.logs.push(args);
  },
});

const parseStructuredLogs = (logger, eventType) => {
  return logger.logs
    .map((args) => {
      if (args.length !== 1 || typeof args[0] !== "string") {
        return null;
      }

      try {
        return JSON.parse(args[0]);
      } catch (error) {
        return null;
      }
    })
    .filter((entry) => entry && (!eventType || entry.eventType === eventType));
};

const createDeferred = () => {
  let resolve;
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

const waitUntil = async (predicate) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for condition");
};

test("fetchPosts stores subreddit posts with resolved thumbnails", async () => {
  const posts = [
    {
      data: {
        title: "Story",
        author: "author",
        created_utc: 1710000000,
        thumbnail: "default",
        domain: "example.com",
        url: "https://example.com/story",
        permalink: "/r/news/comments/story",
        ups: 42,
        num_comments: 7,
        post_hint: "link",
        is_video: false,
        media: null,
        is_gallery: false,
        gallery_data: null,
        media_metadata: null,
        is_self: false,
        selftext: "",
        selftext_html: null,
        upvote_ratio: 0.91,
        rpan_video: null,
      },
    },
  ];
  const { calls, fetchImpl } = createFetcher({ posts });
  const writes = [];
  const handler = createFetchPosts({
    fetchImpl,
    imageSourceImpl: async () => "https://cdn.example.com/story.jpg",
    logger: createLogger(),
    mongooseClient: {
      connect: async () => {},
    },
    newPostModel: {
      findOneAndUpdate: async (...args) => {
        writes.push(args);
      },
    },
  });

  await handler({ subreddit: "worldnews" });

  assert.equal(calls[1].url, "https://oauth.reddit.com/r/worldnews/rising");
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0][0], {
    title: "Story",
    author: "author",
    created_utc: 1710000000,
  });
  assert.equal(writes[0][1].$set.thumbnail, undefined);
  assert.deepEqual(writes[0][2], { upsert: true });
  assert.equal(writes[1][1].$set.thumbnail, "https://cdn.example.com/story.jpg");
  assert.deepEqual(writes[1][2], { upsert: false });
});

test("fetchPosts stores full Reddit preview images instead of tiny thumbnails", async () => {
  const posts = [
    {
      data: {
        title: "Preview Story",
        author: "author",
        created_utc: 1710000000,
        thumbnail:
          "https://external-preview.redd.it/story.jpeg?width=140&height=93&auto=webp",
        preview: {
          images: [
            {
              source: {
                url: "https://external-preview.redd.it/story.jpeg?auto=webp&amp;s=fullsize",
              },
            },
          ],
        },
        domain: "example.com",
        url: "https://example.com/story",
        permalink: "/r/news/comments/story",
        ups: 42,
        num_comments: 7,
        post_hint: "link",
        is_video: false,
        media: null,
        is_gallery: false,
        gallery_data: null,
        media_metadata: null,
        is_self: false,
        selftext: "",
        selftext_html: null,
        upvote_ratio: 0.91,
        rpan_video: null,
      },
    },
  ];
  const { fetchImpl } = createFetcher({ posts });
  const writes = [];
  const handler = createFetchPosts({
    fetchImpl,
    logger: createLogger(),
    mongooseClient: {
      connect: async () => {},
    },
    newPostModel: {
      findOneAndUpdate: async (...args) => {
        writes.push(args);
      },
    },
  });

  await handler({ subreddit: "news" });

  assert.equal(writes.length, 2);
  assert.equal(writes[0][1].$set.thumbnail, undefined);
  assert.equal(
    writes[1][1].$set.thumbnail,
    "https://external-preview.redd.it/story.jpeg?auto=webp&s=fullsize"
  );
  assert.equal(writes[1][1].$set.thumbnail.includes("width=140"), false);
  assert.equal(writes[1][1].$set.thumbnail.includes("height=93"), false);
});

test("fetchPosts writes post records before resolving article thumbnails", async () => {
  const thumbnail = createDeferred();
  const posts = [
    {
      data: {
        title: "Breaking Story",
        author: "author",
        created_utc: 1710000000,
        thumbnail: "",
        domain: "example.com",
        url: "https://example.com/story",
        permalink: "/r/news/comments/story",
        ups: 42,
        num_comments: 7,
        post_hint: "link",
        is_video: false,
        media: null,
        is_gallery: false,
        gallery_data: null,
        media_metadata: null,
        is_self: false,
        selftext: "",
        selftext_html: null,
        upvote_ratio: 0.91,
        rpan_video: null,
      },
    },
  ];
  const { fetchImpl } = createFetcher({ posts });
  const writes = [];
  const handler = createFetchPosts({
    fetchImpl,
    imageSourceImpl: async () => thumbnail.promise,
    logger: createLogger(),
    mongooseClient: {
      connect: async () => {},
    },
    newPostModel: {
      findOneAndUpdate: async (...args) => {
        writes.push(args);
      },
    },
  });

  const handlerPromise = handler({ subreddit: "news" });
  await waitUntil(() => writes.length === 1);

  assert.equal(writes[0][1].$set.title, "Breaking Story");
  assert.deepEqual(writes[0][2], { upsert: true });

  thumbnail.resolve("https://cdn.example.com/story.jpg");
  await handlerPromise;

  assert.equal(writes.length, 2);
  assert.equal(writes[1][1].$set.thumbnail, "https://cdn.example.com/story.jpg");
});

test("fetchPosts stores posts without overwriting thumbnails with placeholders", async () => {
  const posts = [
    {
      data: {
        title: "Story",
        author: "author",
        created_utc: 1710000000,
        thumbnail: "default",
        domain: "example.com",
        url: "https://example.com/story",
        permalink: "/r/news/comments/story",
        ups: 42,
        num_comments: 7,
        post_hint: "link",
        is_video: false,
        media: null,
        is_gallery: false,
        gallery_data: null,
        media_metadata: null,
        is_self: false,
        selftext: "",
        selftext_html: null,
        upvote_ratio: 0.91,
        rpan_video: null,
      },
    },
  ];
  const { fetchImpl } = createFetcher({ posts });
  const writes = [];
  const handler = createFetchPosts({
    fetchImpl,
    imageSourceImpl: async () => "default",
    logger: createLogger(),
    mongooseClient: {
      connect: async () => {},
    },
    newPostModel: {
      findOneAndUpdate: async (...args) => {
        writes.push(args);
      },
    },
  });

  await handler({ subreddit: "news" });

  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].$set.thumbnail, undefined);
  assert.deepEqual(writes[0][2], { upsert: true });
});

test("fetchPosts creates brand-new external posts even when thumbnails are missing", async () => {
  const posts = [
    {
      data: {
        title: "External Story",
        author: "author",
        created_utc: 1710000000,
        thumbnail: "",
        domain: "example.com",
        url: "https://example.com/story",
        permalink: "/r/news/comments/story",
        ups: 42,
        num_comments: 7,
        post_hint: "link",
        is_video: false,
        media: null,
        is_gallery: false,
        gallery_data: null,
        media_metadata: null,
        is_self: false,
        selftext: "",
        selftext_html: null,
        upvote_ratio: 0.91,
        rpan_video: null,
      },
    },
  ];
  const { fetchImpl } = createFetcher({ posts });
  const writes = [];
  const handler = createFetchPosts({
    fetchImpl,
    imageSourceImpl: async () => "",
    logger: createLogger(),
    mongooseClient: {
      connect: async () => {},
    },
    newPostModel: {
      findOneAndUpdate: async (...args) => {
        writes.push(args);
      },
    },
  });

  await handler({ subreddit: "news" });

  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].$set.thumbnail, undefined);
  assert.deepEqual(writes[0][2], { upsert: true });
});

test("fetchPosts logs missing article image metrics for graphing", async () => {
  const posts = [
    {
      data: {
        id: "post1",
        title: "Reuters Story",
        author: "author",
        created_utc: 1710000000,
        thumbnail: "",
        domain: "reuters.com",
        url: "https://www.reuters.com/world/story",
        permalink: "/r/news/comments/story",
        ups: 42,
        num_comments: 7,
        post_hint: "link",
        is_video: false,
        media: null,
        is_gallery: false,
        gallery_data: null,
        media_metadata: null,
        is_self: false,
        selftext: "",
        selftext_html: null,
        upvote_ratio: 0.91,
        rpan_video: null,
      },
    },
  ];
  const { fetchImpl } = createFetcher({ posts });
  const logger = createLogger();
  const handler = createFetchPosts({
    fetchImpl,
    imageSourceImpl: async () => "",
    logger,
    mongooseClient: {
      connect: async () => {},
    },
    newPostModel: {
      findOneAndUpdate: async () => {},
    },
  });

  await handler({ subreddit: "news" });

  const missingLogs = parseStructuredLogs(
    logger,
    "POST_IMAGE_RESOLUTION_MISSING"
  );
  assert.equal(missingLogs.length, 1);
  assert.deepEqual(missingLogs[0], {
    eventType: "POST_IMAGE_RESOLUTION_MISSING",
    severity: "warn",
    subreddit: "news",
    domain: "reuters.com",
    postId: "post1",
    postUrl: "https://www.reuters.com/world/story",
    title: "Reuters Story",
    redditThumbnail: "",
  });

  const metricLog = parseStructuredLogs(logger).find((entry) => entry._aws);
  assert.equal(metricLog.Service, "scraper");
  assert.equal(metricLog.Subreddit, "news");
  assert.equal(metricLog.Operation, "scrape");
  assert.equal(metricLog.PostImageResolutionAttempts, 1);
  assert.equal(metricLog.PostImageResolutionResolved, 0);
  assert.equal(metricLog.PostImageResolutionMissing, 1);
  assert.equal(metricLog.PostImageResolutionErrors, 0);
  assert.equal(
    metricLog._aws.CloudWatchMetrics[0].Namespace,
    "F5News/Scraper"
  );
});

test("fetchPosts includes article image failure details in missing logs", async () => {
  const posts = [
    {
      data: {
        id: "post1",
        title: "Reuters Story",
        author: "author",
        created_utc: 1710000000,
        thumbnail: "",
        domain: "reuters.com",
        url: "https://www.reuters.com/world/story",
        permalink: "/r/news/comments/story",
        ups: 42,
        num_comments: 7,
        post_hint: "link",
        is_video: false,
        media: null,
        is_gallery: false,
        gallery_data: null,
        media_metadata: null,
        is_self: false,
        selftext: "",
        selftext_html: null,
        upvote_ratio: 0.91,
        rpan_video: null,
      },
    },
  ];
  const { fetchImpl } = createFetcher({ posts });
  const logger = createLogger();
  const handler = createFetchPosts({
    fetchImpl,
    imageSourceImpl: async (post, options) => {
      options.onArticleImageFailure({
        url: post.url,
        reason: "http_status",
        status: 401,
        contentType: "text/html;charset=utf-8",
        server: "CloudFront",
        xDatadome: "protected",
        retryCount: 0,
      });
      return "";
    },
    logger,
    mongooseClient: {
      connect: async () => {},
    },
    newPostModel: {
      findOneAndUpdate: async () => {},
    },
  });

  await handler({ subreddit: "news" });

  const [missingLog] = parseStructuredLogs(
    logger,
    "POST_IMAGE_RESOLUTION_MISSING"
  );
  assert.deepEqual(missingLog.imageResolutionFailures, [
    {
      url: "https://www.reuters.com/world/story",
      reason: "http_status",
      status: 401,
      contentType: "text/html;charset=utf-8",
      server: "CloudFront",
      xDatadome: "protected",
      retryCount: 0,
    },
  ]);
});

test("fetchPosts logs image resolution errors separately from missing thumbnails", async () => {
  const posts = [
    {
      data: {
        name: "t3_post2",
        title: "Blocked Publisher Story",
        author: "author",
        created_utc: 1710000000,
        thumbnail: "",
        domain: "publisher.example",
        url: "https://publisher.example/story",
        permalink: "/r/news/comments/story",
        ups: 42,
        num_comments: 7,
        post_hint: "link",
        is_video: false,
        media: null,
        is_gallery: false,
        gallery_data: null,
        media_metadata: null,
        is_self: false,
        selftext: "",
        selftext_html: null,
        upvote_ratio: 0.91,
        rpan_video: null,
      },
    },
  ];
  const { fetchImpl } = createFetcher({ posts });
  const logger = createLogger();
  const handler = createFetchPosts({
    fetchImpl,
    imageSourceImpl: async () => {
      throw new Error("publisher blocked metadata fetch");
    },
    logger,
    mongooseClient: {
      connect: async () => {},
    },
    newPostModel: {
      findOneAndUpdate: async () => {},
    },
  });

  await handler({ subreddit: "news" });

  const errorLogs = parseStructuredLogs(
    logger,
    "POST_IMAGE_RESOLUTION_ERROR"
  );
  assert.equal(errorLogs.length, 1);
  assert.ok(errorLogs[0].stack.includes("index.test.js"));
  assert.deepEqual({ ...errorLogs[0], stack: undefined }, {
    stack: undefined,
    severity: "error",
    eventType: "POST_IMAGE_RESOLUTION_ERROR",
    subreddit: "news",
    domain: "publisher.example",
    postId: "t3_post2",
    postUrl: "https://publisher.example/story",
    title: "Blocked Publisher Story",
    errorName: "Error",
    errorMessage: "publisher blocked metadata fetch",
  });

  const metricLog = parseStructuredLogs(logger).find((entry) => entry._aws);
  assert.equal(metricLog.Operation, "scrape");
  assert.equal(metricLog.PostImageResolutionAttempts, 1);
  assert.equal(metricLog.PostImageResolutionResolved, 0);
  assert.equal(metricLog.PostImageResolutionMissing, 1);
  assert.equal(metricLog.PostImageResolutionErrors, 1);
});

test("fetchPosts backfills recent posts with missing thumbnails", async () => {
  const posts = [];
  const { fetchImpl } = createFetcher({ posts });
  const logger = createLogger();
  const writes = [];
  const findCalls = [];
  const recentMissingPost = {
    _id: "mongo-id-1",
    title: "Reuters Story",
    author: "author",
    created_utc: 1710000000,
    thumbnail: "",
    domain: "reuters.com",
    url: "https://www.reuters.com/world/story",
    sub: "news",
    is_self: false,
    is_video: false,
  };
  const query = {
    sortArgs: null,
    limitArg: null,
    sort(args) {
      this.sortArgs = args;
      return this;
    },
    limit(arg) {
      this.limitArg = arg;
      return this;
    },
    then(resolve) {
      return Promise.resolve([recentMissingPost]).then(resolve);
    },
  };
  const handler = createFetchPosts({
    fetchImpl,
    imageSourceImpl: async (post) =>
      post.url.includes("reuters.com") ? "https://cdn.example.com/reuters.jpg" : "",
    logger,
    mongooseClient: {
      connect: async () => {},
    },
    newPostModel: {
      find: (args) => {
        findCalls.push(args);
        return query;
      },
      findOneAndUpdate: async (...args) => {
        writes.push(args);
      },
    },
    now: () => new Date("2024-03-10T12:00:00Z"),
  });

  await handler({ subreddit: "news" });

  assert.equal(findCalls.length, 1);
  assert.deepEqual(findCalls[0], {
    sub: "news",
    created_utc: { $gt: 1710043200 },
    is_self: { $ne: true },
    is_video: { $ne: true },
    url: { $exists: true, $ne: "" },
    $or: [
      { thumbnail: { $exists: false } },
      { thumbnail: null },
      { thumbnail: "" },
      { thumbnail: { $in: ["default", "self", "spoiler", "nsfw", "image"] } },
    ],
  });
  assert.deepEqual(query.sortArgs, { created_utc: -1 });
  assert.equal(query.limitArg, 25);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], [
    { _id: "mongo-id-1" },
    { $set: { thumbnail: "https://cdn.example.com/reuters.jpg" } },
    { upsert: false },
  ]);

  const [completion] = parseStructuredLogs(logger, "SCRAPER_JOB_COMPLETED");
  assert.equal(completion.imageAttempts, 1);
  assert.equal(completion.imageMissing, 0);
  assert.equal(completion.outcome, "success");
  assert.equal(parseStructuredLogs(logger, "POST_IMAGE_BACKFILL_RESOLVED").length, 0);

  const metricLog = parseStructuredLogs(logger).find(
    (entry) => entry._aws && entry.Operation === "backfill"
  );
  assert.equal(metricLog.PostImageResolutionAttempts, 1);
  assert.equal(metricLog.PostImageResolutionResolved, 1);
  assert.equal(metricLog.PostImageResolutionMissing, 0);
  assert.equal(metricLog.PostImageResolutionErrors, 0);
});

test("backfill processes Reddit posts and advances to older eligible articles", async (t) => {
  const matches = (post, filter) => Object.entries(filter).every(([field, condition]) => {
    if (field === "$or") return condition.some((clause) => matches(post, clause));
    if (condition === null) return post[field] == null;
    if (typeof condition !== "object") return post[field] === condition;
    return Object.entries(condition).every(([operator, value]) => {
      switch (operator) {
        case "$ne": return post[field] !== value;
        case "$gt": return post[field] > value;
        case "$exists": return (post[field] !== undefined) === value;
        case "$in": return value.includes(post[field]);
        default: throw new Error(`Unsupported query operator: ${operator}`);
      }
    });
  });
  const now = new Date("2024-03-10T12:00:00Z");
  const basePost = {
    sub: "news", thumbnail: "", url: "https://publisher.example/story",
    created_utc: Math.floor(now.getTime() / 1000) - 100,
  };

  for (const hidden of [
    { spoiler: true }, { over_18: true }, { preview_disabled: true },
    { thumbnail: "spoiler" }, { thumbnail: "nsfw" },
  ]) {
    await t.test(JSON.stringify(hidden), async () => {
      const posts = [
        ...Array.from({ length: 25 }, (_, index) => ({
          ...basePost, ...hidden, _id: `hidden-${index}`, created_utc: basePost.created_utc + index + 1,
        })),
        { ...basePost, _id: "legacy-visible" },
        { ...basePost, _id: "visible", spoiler: false, over_18: false, preview_disabled: false },
      ];
      const resolved = [];
      const writes = [];
      const options = {
        now: () => now,
        logger: createLogger(),
        imageSourceImpl: async (post) => {
          resolved.push(post._id);
          return "https://cdn.example.com/story.jpg";
        },
        newPostModel: {
          find: (filter) => {
            let selected = posts.filter((post) => matches(post, filter));
            return {
              sort(order) {
                assert.deepEqual(order, { created_utc: -1 });
                selected.sort((a, b) => b.created_utc - a.created_utc);
                return this;
              },
              limit(count) {
                assert.equal(count, 25);
                selected = selected.slice(0, count);
                return this;
              },
              then(resolve) { return Promise.resolve(selected).then(resolve); },
            };
          },
          findOneAndUpdate: async (key, update) => {
            writes.push(key._id);
            Object.assign(posts.find(post => post._id === key._id), update.$set);
          },
        },
      };
      await backfillMissingPostImages("news", options);
      assert.equal(resolved.length, 25);
      assert.ok(resolved.every(id => id.startsWith("hidden-")));
      resolved.length = 0;
      writes.length = 0;
      await backfillMissingPostImages("news", options);
      assert.deepEqual(resolved.sort(), ["legacy-visible", "visible"]);
      assert.deepEqual(writes.sort(), ["legacy-visible", "visible"]);
    });
  }
});

test("backfillMissingPostImages logs missing and error outcomes without writing unusable thumbnails", async () => {
  const logger = createLogger();
  const writes = [];
  const posts = [
    {
      _id: "missing-id",
      title: "Missing Story",
      author: "author",
      created_utc: 1710000000,
      thumbnail: "",
      domain: "apnews.com",
      url: "https://apnews.com/story",
      sub: "news",
      is_self: false,
      is_video: false,
    },
    {
      _id: "error-id",
      title: "Error Story",
      author: "author",
      created_utc: 1710000001,
      thumbnail: "",
      domain: "cnn.com",
      url: "https://cnn.com/story",
      sub: "news",
      is_self: false,
      is_video: false,
    },
  ];

  await backfillMissingPostImages("news", {
    imageSourceImpl: async (post, options) => {
      if (post._id === "error-id") {
        throw new Error("metadata blocked");
      }
      options.onArticleImageFailure({
        url: post.url,
        reason: "no_meta_image",
        status: 200,
        contentType: "text/html",
      });
      return "";
    },
    logger,
    newPostModel: {
      find: () => ({
        sort() {
          return this;
        },
        limit() {
          return this;
        },
        then(resolve) {
          return Promise.resolve(posts).then(resolve);
        },
      }),
      findOneAndUpdate: async (...args) => {
        writes.push(args);
      },
    },
  });

  assert.equal(writes.length, 0);
  assert.equal(
    parseStructuredLogs(logger, "POST_IMAGE_BACKFILL_MISSING").length,
    1
  );
  assert.deepEqual(
    parseStructuredLogs(logger, "POST_IMAGE_BACKFILL_MISSING")[0]
      .imageResolutionFailures,
    [
      {
        url: "https://apnews.com/story",
        reason: "no_meta_image",
        status: 200,
        contentType: "text/html",
      },
    ]
  );
  assert.equal(
    parseStructuredLogs(logger, "POST_IMAGE_BACKFILL_ERROR").length,
    1
  );

  const metricLog = parseStructuredLogs(logger).find((entry) => entry._aws);
  assert.equal(metricLog.Operation, "backfill");
  assert.equal(metricLog.PostImageResolutionAttempts, 2);
  assert.equal(metricLog.PostImageResolutionResolved, 0);
  assert.equal(metricLog.PostImageResolutionMissing, 2);
  assert.equal(metricLog.PostImageResolutionErrors, 1);
});

test("fetchPosts defaults to politics when event has no subreddit", async () => {
  const { calls, fetchImpl } = createFetcher();
  const handler = createFetchPosts({
    fetchImpl,
    logger: createLogger(),
    mongooseClient: {
      connect: async () => {},
    },
    newPostModel: {
      findOneAndUpdate: async () => {},
    },
  });

  await handler({});

  assert.equal(calls[1].url, "https://oauth.reddit.com/r/politics/rising");
});

test("fetchPosts accepts node-fetch default export module shape", async () => {
  const { calls, fetchImpl } = createFetcher();
  const handler = createFetchPosts({
    fetchImpl: { default: fetchImpl },
    imageSourceImpl: async () => "",
    logger: createLogger(),
    mongooseClient: {
      connect: async () => {},
    },
    newPostModel: {
      findOneAndUpdate: async () => {},
    },
  });

  await handler({ subreddit: "science" });

  assert.equal(calls[0].url, "https://www.reddit.com/api/v1/access_token");
  assert.equal(calls[1].url, "https://oauth.reddit.com/r/science/rising");
});

test("fetchPosts does not write posts and surfaces token fetch failures", async () => {
  let writeCount = 0;
  const handler = createFetchPosts({
    fetchImpl: async () => {
      throw new Error("reddit auth failed");
    },
    logger: createLogger(),
    mongooseClient: {
      connect: async () => {},
    },
    newPostModel: {
      findOneAndUpdate: async () => {
        writeCount += 1;
      },
    },
  });

  await assert.rejects(handler({ subreddit: "news" }), /reddit auth failed/);

  assert.equal(writeCount, 0);
});

test("fetchPosts does not write posts when reddit listing is malformed", async () => {
  let writeCount = 0;
  let requestCount = 0;
  const handler = createFetchPosts({
    fetchImpl: async () => {
      requestCount += 1;

      if (requestCount === 1) {
        return {
          json: async () => ({ access_token: "token" }),
        };
      }

      return {
        json: async () => ({ data: {} }),
      };
    },
    logger: createLogger(),
    mongooseClient: {
      connect: async () => {},
    },
    newPostModel: {
      findOneAndUpdate: async () => {
        writeCount += 1;
      },
    },
  });

  await assert.rejects(handler({ subreddit: "news" }), /Reddit listing response missing posts/);

  assert.equal(writeCount, 0);
});

test("preserves existing thumbnails and logs batch counts without raw records", async () => {
  const posts = [{ data: { id: 'hidden-post', title: 'Story', selftext: 'private-marker', spoiler: true, thumbnail: 'spoiler', preview: { images: [{ source: { url: 'https://publisher.example/photo.jpg' } }] } } }];
  const logger = createLogger();
  const writes = [];
  const handler = createFetchPosts({
    fetchImpl: createFetcher({ posts }).fetchImpl,
    logger,
    mongooseClient: { connect: async () => {} },
    newPostModel: { findOneAndUpdate: async (...args) => { writes.push(args); }, find: async () => [] },
  });
  await handler({ subreddit: 'news' });
  assert.equal(writes[0][1].$set.spoiler, undefined);
  assert.equal(writes[0][1].$set.thumbnail, undefined);
  assert.equal(writes[1][1].$set.thumbnail, "https://publisher.example/photo.jpg");
  assert.ok(!JSON.stringify(logger.logs).includes('private-marker'));
  assert.deepEqual(parseStructuredLogs(logger, 'POST_BATCH'), [{ eventType: 'POST_BATCH', subreddit: 'news', count: 1 }]);
});

test("stores ordinary thumbnails without deriving suppression from preview.enabled", async () => {
  const thumbnail = "https://publisher.example/photo.jpg";
  const posts = [{ data: {
    id: "ordinary-post", title: "Story", spoiler: false, over_18: false,
    thumbnail, preview: { enabled: false, images: [{ source: { url: thumbnail } }] },
  } }];
  const writes = [];
  const handler = createFetchPosts({
    fetchImpl: createFetcher({ posts }).fetchImpl,
    logger: createLogger(),
    mongooseClient: { connect: async () => {} },
    newPostModel: { findOneAndUpdate: async (...args) => { writes.push(args); }, find: async () => [] },
  });
  await handler({ subreddit: "news" });
  assert.equal(writes[0][1].$set.preview_disabled, undefined);
  assert.equal(writes[0][1].$set.thumbnail, undefined);
  assert.equal(writes[1][1].$set.thumbnail, thumbnail);
});

const diagnosticPost = (id = "post1") => ({ data: {
  id, title: "Story", author: "author", created_utc: 1710000000,
  domain: "publisher.example", url: "https://reader:password@publisher.example/story?token=url-secret#fragment",
  thumbnail: "", is_self: false, is_video: false,
} });

const diagnosticHandler = (overrides = {}) => createFetchPosts({
  fetchImpl: createFetcher({ posts: [diagnosticPost()] }).fetchImpl,
  imageSourceImpl: async () => "",
  mongooseClient: { connect: async () => {} },
  newPostModel: { findOneAndUpdate: async () => {}, find: async () => [] },
  ...overrides,
});

test("listing, auth and database failures reject with one sanitized job failure", async (t) => {
  for (const [stage, overrides] of [
    ["database_connect", { mongooseClient: { connect: async () => { throw Object.assign(new Error("connect mongodb+srv://reader:db-secret@mongo.example/db"), { code: "ECONNREFUSED", cause: new Error("private-cause") }); } } }],
    ["reddit_auth", { fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: "private-body" }) }) }],
    ["reddit_listing", { fetchImpl: async (url) => url.includes("access_token") ? { json: async () => ({ access_token: "token" }) } : { ok: false, status: 503 } }],
    ["post_write", { newPostModel: { findOneAndUpdate: async () => { throw new Error("write https://reader:password@publisher.example/story?token=url-secret"); } } }],
  ]) {
    await t.test(stage, async () => {
      const logger = createLogger();
      let rejection;
      await assert.rejects(diagnosticHandler({ logger, ...overrides })({ subreddit: "news", payload: "private-event" }, { awsRequestId: "request1" }), (error) => {
        rejection = error;
        return true;
      });
      const failures = parseStructuredLogs(logger, "SCRAPER_JOB_FAILED");
      assert.equal(failures.length, 1);
      assert.equal(failures[0].stage, stage);
      assert.equal(failures[0].outcome, "failed");
      assert.equal(failures[0].requestId, "request1");
      assert.ok(Number.isFinite(failures[0].durationMs));
      assert.equal(parseStructuredLogs(logger, "SCRAPER_JOB_COMPLETED").length, 0);
      const emitted = JSON.stringify(logger.logs) + rejection.stack;
      for (const secret of ["db-secret", "url-secret", "reader:", "private-cause", "private-event", "private-body"]) assert.ok(!emitted.includes(secret), secret);
      if (stage === "database_connect") assert.equal(failures[0].errorCode, "ECONNREFUSED");
    });
  }
});

test("job failure waits for concurrent writes and records partial progress", async () => {
  const pending = createDeferred();
  const logger = createLogger();
  let delayedStarted = false;
  // Post keys use the existing title/author/created identity.
  const fetcher = createFetcher({ posts: [
    { data: { ...diagnosticPost().data, title: "broken" } },
    { data: { ...diagnosticPost().data, title: "delayed" } },
  ] });
  const run = createFetchPosts({
    fetchImpl: fetcher.fetchImpl, logger, imageSourceImpl: async () => "",
    mongooseClient: { connect: async () => {} },
    newPostModel: {
      findOneAndUpdate: async (key) => {
        if (key.title === "broken") throw new Error("database unavailable");
        delayedStarted = true;
        await pending.promise;
      },
    },
  })({ subreddit: "news" });
  const rejected = assert.rejects(run, /database unavailable/);
  await waitUntil(() => delayedStarted);
  assert.equal(parseStructuredLogs(logger, "SCRAPER_JOB_FAILED").length, 0);
  pending.resolve();
  await rejected;
  const [failure] = parseStructuredLogs(logger, "SCRAPER_JOB_FAILED");
  assert.equal(failure.fetchedCount, 2);
  assert.equal(failure.savedCount, 1);
  assert.equal(parseStructuredLogs(logger).at(-1).eventType, "SCRAPER_JOB_FAILED");
});

test("optional thumbnail writes and backfill query failure complete degraded", async () => {
  const logger = createLogger();
  const handler = diagnosticHandler({
    logger,
    imageSourceImpl: async () => "https://cdn.example/photo.jpg",
    newPostModel: {
      findOneAndUpdate: async (key, update, options) => { if (!options.upsert) throw new Error("thumbnail write failed"); },
      find: async () => { throw new Error("backfill query failed"); },
    },
  });
  await handler({ subreddit: "news" });
  const [completion] = parseStructuredLogs(logger, "SCRAPER_JOB_COMPLETED");
  assert.equal(completion.outcome, "degraded");
  assert.equal(completion.savedCount, 1);
  assert.equal(completion.imageUpdateErrors, 1);
  assert.equal(completion.backfillQueryErrors, 1);
  assert.equal(parseStructuredLogs(logger, "POST_IMAGE_UPDATE_ERROR").length, 1);
});

test("terminal dependency failures count once with compatible EMF dimensions", async () => {
  const { imageSource, fetchArticleImage } = require("./imageSource");
  const logger = createLogger();
  let requests = 0;
  await diagnosticHandler({
    logger,
    imageSourceImpl: (post, options) => imageSource(post, { ...options,
      fetchArticleImageImpl: (url, callbacks) => fetchArticleImage(url, { ...callbacks,
        resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
        fetchImpl: async () => { requests += 1; return { ok: false, status: 503, headers: { get: () => "" } }; },
      }),
    }),
  })({ subreddit: "news" });
  assert.equal(requests, 2);
  const [missing] = parseStructuredLogs(logger, "POST_IMAGE_RESOLUTION_MISSING");
  assert.equal(missing.postUrl, "https://publisher.example/story");
  assert.equal(missing.imageResolutionFailures[0].url, "https://publisher.example/story");
  assert.equal(missing.imageResolutionFailures[0].retryCount, 1);
  const metric = parseStructuredLogs(logger).find((entry) => entry._aws);
  assert.equal(metric.PostImageDependencyFailures, 1);
  assert.equal(metric.PostImageResolutionErrors, 0);
  assert.equal(metric.PostImageResolutionMissing, 1);
  assert.deepEqual(metric._aws.CloudWatchMetrics[0].Dimensions, [["Service", "Subreddit", "Operation"]]);
  for (const definition of metric._aws.CloudWatchMetrics[0].Metrics) {
    assert.equal(definition.Unit, "Count");
    assert.ok(Number.isFinite(metric[definition.Name]));
  }
  assert.equal(parseStructuredLogs(logger, "SCRAPER_JOB_COMPLETED")[0].outcome, "degraded");
});

test("recovered article retries resolve without counting terminal dependency failure", async () => {
  const { imageSource, fetchArticleImage } = require("./imageSource");
  const logger = createLogger();
  let requests = 0;
  await diagnosticHandler({
    logger,
    imageSourceImpl: (post, options) => imageSource(post, { ...options,
      fetchArticleImageImpl: (url, callbacks) => fetchArticleImage(url, { ...callbacks,
        resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
        fetchImpl: async () => {
          requests += 1;
          if (requests === 1) throw new Error("temporary network failure");
          return { ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => '<meta property="og:image" content="https://cdn.example/photo.jpg">' };
        },
      }),
    }),
  })({ subreddit: "news" });
  assert.equal(requests, 2);
  const metric = parseStructuredLogs(logger).find((entry) => entry._aws);
  assert.equal(metric.PostImageDependencyFailures, 0);
  assert.equal(metric.PostImageResolutionErrors, 0);
  assert.equal(metric.PostImageResolutionResolved, 1);
  assert.equal(parseStructuredLogs(logger, "SCRAPER_JOB_COMPLETED")[0].outcome, "success");
});

test("known environment secrets are redacted from job and Lambda rejection diagnostics", async () => {
  const logger = createLogger();
  const env = {
    MONGO_CONNECTION_STRING: "unprefixed-db-value",
    REDDIT_CLIENT_ID: "unprefixed-client-value",
    REDDIT_SECRET_KEY: "unprefixed-secret-value",
    REDDIT_USERNAME: "unprefixed-user-value",
    REDDIT_PASSWORD: "unprefixed-password-value",
  };
  let runtimeError;
  await assert.rejects(diagnosticHandler({
    logger, env,
    mongooseClient: { connect: async () => {
      throw Object.assign(new Error(`Failed with ${Object.values(env).join(" ")}`), { code: "ETIMEDOUT" });
    } },
  })({ subreddit: "news" }), (error) => { runtimeError = error; return true; });
  const emitted = JSON.stringify(logger.logs) + runtimeError.stack + runtimeError.message;
  for (const secret of Object.values(env)) assert.ok(!emitted.includes(secret), secret);
  assert.match(emitted, /\[redacted\]/);
  const [failure] = parseStructuredLogs(logger, "SCRAPER_JOB_FAILED");
  assert.equal(failure.severity, "error");
  assert.equal(failure.errorCode, "ETIMEDOUT");
  assert.match(failure.stack, /index.test.js/);
});

test("image exceptions emit one diagnostic and retain missing/error metric overlap", async () => {
  const logger = createLogger();
  await diagnosticHandler({ logger, imageSourceImpl: async () => { throw new Error("image resolver failed"); } })({ subreddit: "news" });
  assert.equal(parseStructuredLogs(logger, "POST_IMAGE_RESOLUTION_ERROR").length, 1);
  assert.equal(parseStructuredLogs(logger, "POST_IMAGE_RESOLUTION_MISSING").length, 0);
  assert.equal(logger.warnings.filter((args) => String(args[0]).includes("Error resolving post image")).length, 0);
  const metric = parseStructuredLogs(logger).find((entry) => entry._aws);
  assert.equal(metric.PostImageResolutionErrors, 1);
  assert.equal(metric.PostImageResolutionMissing, 1);
});

test("unexpected article adapter exceptions retain sanitized terminal diagnostics", async () => {
  const { imageSource } = require("./imageSource");
  const logger = createLogger();
  await diagnosticHandler({ logger, imageSourceImpl: (post, options) => imageSource(post, {
    ...options,
    fetchArticleImageImpl: async () => { throw new Error("Failed https://reader:password@publisher.example/story?token=url-secret"); },
  }) })({ subreddit: "news" });
  const [missing] = parseStructuredLogs(logger, "POST_IMAGE_RESOLUTION_MISSING");
  assert.equal(missing.imageResolutionFailures[0].reason, "fetch_error");
  assert.equal(missing.imageResolutionFailures[0].errorName, "Error");
  assert.ok(!JSON.stringify(logger.logs).includes("url-secret"));
  const metric = parseStructuredLogs(logger).find((entry) => entry._aws);
  assert.equal(metric.PostImageResolutionErrors, 0);
  assert.equal(metric.PostImageDependencyFailures, 1);
});

test("backfill thumbnail write failures stay optional and report degraded counts", async () => {
  const logger = createLogger();
  const post = { ...diagnosticPost().data, _id: "backfill1" };
  const handler = diagnosticHandler({ logger,
    fetchImpl: createFetcher().fetchImpl,
    imageSourceImpl: async () => "https://cdn.example/photo.jpg",
    newPostModel: {
      find: async () => [post],
      findOneAndUpdate: async () => { throw new Error("optional image write failed"); },
    },
  });
  await handler({ subreddit: "news" });
  const [completion] = parseStructuredLogs(logger, "SCRAPER_JOB_COMPLETED");
  assert.equal(completion.outcome, "degraded");
  assert.equal(completion.imageResolved, 1);
  assert.equal(completion.imageUpdateErrors, 1);
  const [error] = parseStructuredLogs(logger, "POST_IMAGE_UPDATE_ERROR");
  assert.equal(error.operation, "backfill");
  assert.equal(error.postId, "post1");
});
