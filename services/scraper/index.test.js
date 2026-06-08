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
  warn(...args) {
    this.warnings.push(args);
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
  assert.deepEqual(errorLogs[0], {
    eventType: "POST_IMAGE_RESOLUTION_ERROR",
    subreddit: "news",
    domain: "publisher.example",
    postId: "t3_post2",
    postUrl: "https://publisher.example/story",
    title: "Blocked Publisher Story",
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

  const resolvedLogs = parseStructuredLogs(
    logger,
    "POST_IMAGE_BACKFILL_RESOLVED"
  );
  assert.equal(resolvedLogs.length, 1);
  assert.deepEqual(resolvedLogs[0], {
    eventType: "POST_IMAGE_BACKFILL_RESOLVED",
    subreddit: "news",
    domain: "reuters.com",
    postId: "mongo-id-1",
    postUrl: "https://www.reuters.com/world/story",
    title: "Reuters Story",
  });

  const metricLog = parseStructuredLogs(logger).find(
    (entry) => entry._aws && entry.Operation === "backfill"
  );
  assert.equal(metricLog.PostImageResolutionAttempts, 1);
  assert.equal(metricLog.PostImageResolutionResolved, 1);
  assert.equal(metricLog.PostImageResolutionMissing, 0);
  assert.equal(metricLog.PostImageResolutionErrors, 0);
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
    2
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

  await handler({ subreddit: "news" });

  assert.equal(writeCount, 0);
});
