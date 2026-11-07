const assert = require("assert");
const test = require("node:test");

const { backfillMissingPostImages, createFetchPosts, findImagePriorityIds } = require("./index");

const createScraper = ({ posts = [] } = {}) => {
  const calls = [];
  const scrapePostsImpl = async (options) => {
    calls.push(options);
    return posts;
  };

  return { calls, scrapePostsImpl };
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

const batchSubreddits = require("../posts/subreddits.json");
const batchChild = (subreddit) => ({ kind: "t3", data: {
  id: `p${subreddit.toLowerCase()}`, subreddit, title: "Batch story", domain: "example.com", author: "author",
  url: "https://example.com/story", permalink: `/r/${subreddit}/comments/p${subreddit.toLowerCase()}/story/`,
  created_utc: 1710000000, ups: 4, num_comments: 2, thumbnail: "default", is_self: false,
} });
const batchResult = (names = batchSubreddits) => ({
  feeds: names.map((subreddit) => ({ subreddit, children: [batchChild(subreddit)] })), failures: [],
  sessionMode: "reused", sessionGeneration: "batch-generation",
});
const batchHarness = (overrides = {}) => {
  const logger = createLogger();
  const writes = [];
  const calls = [];
  const images = [];
  const handler = createFetchPosts({
    env: { F5_REDDIT_SESSION_ENABLED: "true" }, logger,
    mongooseClient: { connect: async () => {} },
    newPostModel: { find: () => [], findOneAndUpdate: async (...args) => { writes.push(args); } },
    scrapePostsImpl: async () => { throw new Error("Unexpected single-feed extraction"); },
    scrapeBatchImpl: async (options) => { calls.push(options); return batchResult(); },
    imageSourceImpl: async (post) => { images.push({ post, coreWrites: writes.filter(([, , options]) => options.upsert).length }); return ""; },
    ...overrides,
  });
  return { handler, logger, writes, calls, images };
};

test("allFeeds extracts once, persists every core feed before optional images, and returns safe summaries", async () => {
  const { handler, logger, writes, calls, images } = batchHarness();
  const result = await handler({ allFeeds: true, scheduled: true }, { getRemainingTimeInMillis: () => 240000 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].subreddits, batchSubreddits);
  assert.equal(calls[0].timeoutMs <= 160000, true);
  assert.equal(calls[0].renewSession, false);
  assert.deepEqual(calls[0].imagePriorityIdsBySubreddit, Object.fromEntries(batchSubreddits.map((name) => [name, []])));
  assert.equal(writes.filter(([, , options]) => options.upsert).length, batchSubreddits.length);
  assert.equal(images.every(({ coreWrites }) => coreWrites === batchSubreddits.length), true);
  assert.equal(writes.every(([, , options]) => options.timeoutMS <= 10000 && options.maxTimeMS <= 5000), true);
  assert.deepEqual(Object.keys(result).sort(), ["feedResults", "sessionGeneration", "sessionMode"]);
  assert.deepEqual(result.feedResults.map(({ subreddit }) => subreddit), batchSubreddits);
  for (const feed of result.feedResults) {
    assert.deepEqual(Object.keys(feed).sort(), ["fetchedCount", "outcome", "savedCount", "sessionGeneration", "sessionMode", "subreddit"]);
    assert.equal(feed.savedCount, 1);
    assert.equal(feed.sessionGeneration, "batch-generation");
  }
  const terminals = parseStructuredLogs(logger).filter(({ eventType }) => /^SCRAPER_JOB_/.test(eventType));
  assert.equal(terminals.length, batchSubreddits.length);
  assert.equal(terminals.every(({ trigger, eventType }) => trigger === "schedule" && eventType === "SCRAPER_JOB_COMPLETED"), true);
});

test("allFeeds saves a valid prefix after 429 and fails every unattempted feed without another extraction", async () => {
  let calls = 0;
  let imageCalls = 0;
  const { handler, writes, logger } = batchHarness({ imageSourceImpl: async () => { imageCalls += 1; return ""; }, scrapeBatchImpl: async () => {
    calls += 1;
    const value = batchResult(batchSubreddits.slice(0, 1));
    value.feeds.forEach(({ children }) => { children[0].data.thumbnail = "https://external-preview.redd.it/story.jpg?width=140"; });
    return { ...value, batchFailure: { subreddit: batchSubreddits[1], status: "network_error", httpStatus: 429, sessionReason: "navigation_rate_limited" } };
  } });
  await assert.rejects(handler({ allFeeds: true }), /2 feeds incomplete; stopped: navigation_rate_limited, HTTP 429/);
  assert.equal(calls, 1);
  assert.equal(writes.filter(([, , options]) => options.upsert).length, 1);
  assert.equal(writes.filter(([, update]) => update.$set.thumbnail).length, 1);
  assert.equal(imageCalls, 0);
  assert.equal(parseStructuredLogs(logger, "SCRAPER_JOB_COMPLETED").length, 1);
  const failures = parseStructuredLogs(logger, "SCRAPER_JOB_FAILED");
  assert.equal(failures.length, 2);
  assert.equal(failures[0].sourceStatus, "source_failed");
  assert.equal(failures[0].httpStatus, 429);
  assert.equal(failures[1].sourceStatus, "not_attempted");
});

test("allFeeds retains the current listing when its optional preview is rate limited", async () => {
  const { handler, writes, logger } = batchHarness({ scrapeBatchImpl: async () => ({
    ...batchResult(batchSubreddits.slice(0, 1)),
    batchFailure: { subreddit: batchSubreddits[0], stage: "optional_preview", status: "network_error", httpStatus: 429, sessionReason: "navigation_rate_limited" },
  }) });
  await assert.rejects(handler({ allFeeds: true }), /2 feeds incomplete/);
  assert.equal(writes.filter(([, , options]) => options.upsert).length, 1);
  const [completed] = parseStructuredLogs(logger, "SCRAPER_JOB_COMPLETED");
  assert.equal(completed.outcome, "degraded");
  assert.equal(completed.sourceStatus, "optional_preview_failed");
  assert.equal(completed.httpStatus, 429);
});

test("allFeeds isolates malformed completed feed metadata", async () => {
  const value = batchResult();
  value.feeds[2].children = [null];
  const { handler, writes, logger } = batchHarness({ scrapeBatchImpl: async () => value });
  await assert.rejects(handler({ allFeeds: true }), /1 feeds incomplete/);
  assert.equal(writes.filter(([, , options]) => options.upsert).length, batchSubreddits.length - 1);
  assert.equal(parseStructuredLogs(logger, "SCRAPER_JOB_FAILED")[0].sourceStatus, "metadata_invalid");
});

test("allFeeds emits a failed terminal for every configured feed if collection fails before its first feed", async () => {
  const { handler, logger, writes } = batchHarness({ scrapeBatchImpl: async () => { throw new Error("Browser unavailable"); } });
  await assert.rejects(handler({ allFeeds: true }), /3 feeds incomplete/);
  assert.equal(writes.length, 0);
  assert.equal(parseStructuredLogs(logger, "SCRAPER_JOB_FAILED").length, batchSubreddits.length);
  assert.equal(parseStructuredLogs(logger, "SCRAPER_JOB_COMPLETED").length, 0);
});

test("allFeeds preserves published listing thumbnails when the optional deadline is exhausted", async () => {
  const originalNow = Date.now;
  let clock = originalNow();
  const writes = [];
  const logger = createLogger();
  Date.now = () => clock;
  try {
    const handler = createFetchPosts({ env: {}, logger, mongooseClient: { connect: async () => {} },
      newPostModel: { find: () => [], findOneAndUpdate: async (...args) => { writes.push(args); } },
      scrapeBatchImpl: async () => {
        clock += 230000;
        const value = batchResult();
        value.feeds.forEach(({ children }) => { children[0].data.thumbnail = "https://external-preview.redd.it/story.jpg?width=140"; });
        return value;
      },
      imageSourceImpl: async () => { throw new Error("Optional network work must be deferred"); },
    });
    const result = await handler({ allFeeds: true }, { getRemainingTimeInMillis: () => 240000 });
    assert.equal(writes.filter(([, , options]) => options.upsert).length, batchSubreddits.length);
    const thumbnails = writes.filter(([, update]) => update.$set.thumbnail);
    assert.equal(thumbnails.length, batchSubreddits.length);
    assert.equal(thumbnails.every(([query]) => Array.isArray(query.$or)), true);
    assert.equal(result.feedResults.every(({ outcome }) => outcome === "degraded"), true);
  } finally { Date.now = originalNow; }
});

test("allFeeds bounds priority queries to three and core feed writes to two", async () => {
  let priorities = 0;
  let maxPriorities = 0;
  let pendingWrites = 0;
  let maxWrites = 0;
  let sourceStarted = false;
  const { handler } = batchHarness({
    newPostModel: {
      find: async () => {
        if (sourceStarted) return [];
        priorities += 1;
        maxPriorities = Math.max(maxPriorities, priorities);
        await new Promise((resolve) => setTimeout(resolve, 1));
        priorities -= 1;
        return [];
      },
      findOneAndUpdate: async () => {
        pendingWrites += 1;
        maxWrites = Math.max(maxWrites, pendingWrites);
        await new Promise((resolve) => setTimeout(resolve, 1));
        pendingWrites -= 1;
      },
    },
    scrapeBatchImpl: async () => { sourceStarted = true; assert.equal(priorities, 0); return batchResult(); },
  });
  await handler({ allFeeds: true });
  assert.equal(maxPriorities, 3);
  assert.equal(maxWrites, 2);
  assert.equal(pendingWrites, 0);
});

test("allFeeds drains writes and completes other feeds after one core write fails", async () => {
  let active = 0;
  let successes = 0;
  const logger = createLogger();
  const { handler } = batchHarness({ logger, newPostModel: {
    find: () => [],
    findOneAndUpdate: async (_query, update) => {
      active += 1;
      try {
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (update.$set.sub === batchSubreddits[0]) throw new Error("Post write rejected");
        successes += 1;
      } finally { active -= 1; }
    },
  } });
  await assert.rejects(handler({ allFeeds: true }), /1 feeds incomplete/);
  assert.equal(active, 0);
  assert.equal(successes, batchSubreddits.length - 1);
  assert.equal(parseStructuredLogs(logger, "SCRAPER_JOB_COMPLETED").length, batchSubreddits.length - 1);
  const [failed] = parseStructuredLogs(logger, "SCRAPER_JOB_FAILED");
  assert.equal(failed.stage, "post_write");
  assert.equal(failed.savedCount, 0);
});

test("allFeeds omits unavailable priority entries and isolates source mapping failures", async () => {
  let captured;
  const value = batchResult(batchSubreddits.slice(1));
  value.failures = [{ subreddit: batchSubreddits[0], status: "metadata_invalid" }];
  const { handler, logger } = batchHarness({
    newPostModel: { find: () => { throw new Error("Private query information"); }, findOneAndUpdate: async () => {} },
    scrapeBatchImpl: async (options) => { captured = options; return value; },
  });
  await assert.rejects(handler({ allFeeds: true }), /1 feeds incomplete/);
  assert.deepEqual(captured.imagePriorityIdsBySubreddit, {});
  const [failed] = parseStructuredLogs(logger, "SCRAPER_JOB_FAILED");
  assert.equal(failed.subreddit, batchSubreddits[0]);
  assert.equal(failed.sourceStatus, "metadata_invalid");
  assert.equal(parseStructuredLogs(logger, "SCRAPER_JOB_COMPLETED").length, batchSubreddits.length - 1);
});

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
  const { calls, scrapePostsImpl } = createScraper({ posts });
  const writes = [];
  const handler = createFetchPosts({
    scrapePostsImpl,
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

  assert.equal(calls[0].subreddit, "worldnews");
  assert.equal(calls[0].limit, 25);
  assert.ok(calls[0].timeoutMs > 0 && calls[0].timeoutMs <= 90000);
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
  const { scrapePostsImpl } = createScraper({ posts });
  const writes = [];
  const handler = createFetchPosts({
    scrapePostsImpl,
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
  const { scrapePostsImpl } = createScraper({ posts });
  const writes = [];
  const handler = createFetchPosts({
    scrapePostsImpl,
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
  const { scrapePostsImpl } = createScraper({ posts });
  const writes = [];
  const handler = createFetchPosts({
    scrapePostsImpl,
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
  const { scrapePostsImpl } = createScraper({ posts });
  const writes = [];
  const handler = createFetchPosts({
    scrapePostsImpl,
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
  const { scrapePostsImpl } = createScraper({ posts });
  const logger = createLogger();
  const handler = createFetchPosts({
    scrapePostsImpl,
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
  const { scrapePostsImpl } = createScraper({ posts });
  const logger = createLogger();
  const handler = createFetchPosts({
    scrapePostsImpl,
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
  const { scrapePostsImpl } = createScraper({ posts });
  const logger = createLogger();
  const handler = createFetchPosts({
    scrapePostsImpl,
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
  const { scrapePostsImpl } = createScraper({ posts });
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
    scrapePostsImpl,
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

  assert.equal(findCalls.length, 2);
  assert.deepEqual({ ...findCalls[1], $or: findCalls[1].$or.slice(0, 4) }, {
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
    if (field === "$and") return condition.every((clause) => matches(post, clause));
    if (condition === null) return post[field] == null;
    if (typeof condition !== "object") return post[field] === condition;
    return Object.entries(condition).every(([operator, value]) => {
      switch (operator) {
        case "$ne": return post[field] !== value;
        case "$gt": return post[field] > value;
        case "$lt": return post[field] < value;
        case "$exists": return (post[field] !== undefined) === value;
        case "$in": return value.includes(post[field]);
        case "$nin": return !value.includes(post[field]);
        case "$regex": return new RegExp(value, condition.$options).test(post[field] || "");
        case "$options": return true;
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
  const { calls, scrapePostsImpl } = createScraper();
  const handler = createFetchPosts({
    scrapePostsImpl,
    logger: createLogger(),
    mongooseClient: {
      connect: async () => {},
    },
    newPostModel: {
      findOneAndUpdate: async () => {},
    },
  });

  await handler({});

  assert.equal(calls[0].subreddit, "politics");
});

test("fetchPosts reserves Lambda time after browser extraction", async () => {
  const { calls, scrapePostsImpl } = createScraper();
  const logger = createLogger();
  const handler = createFetchPosts({
    scrapePostsImpl,
    logger,
    mongooseClient: { connect: async () => {} },
    newPostModel: { findOneAndUpdate: async () => {} },
  });

  await handler({ subreddit: "news" }, {
    getRemainingTimeInMillis: () => 65000,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].subreddit, "news");
  assert.equal(calls[0].limit, 25);
  assert.equal(calls[0].timeoutMs, 45000);
  assert.equal(calls[0].logger, logger);
});

test("fetchPosts does not write posts when browser extraction fails", async () => {
  let writeCount = 0;
  const handler = createFetchPosts({
    scrapePostsImpl: async () => {
      throw new Error("browser extraction failed");
    },
    logger: createLogger(),
    mongooseClient: { connect: async () => {} },
    newPostModel: {
      findOneAndUpdate: async () => { writeCount += 1; },
    },
  });

  await assert.rejects(handler({ subreddit: "news" }), /browser extraction failed/);
  assert.equal(writeCount, 0);
});

test("fetchPosts does not write posts when browser extraction returns malformed posts", async () => {
  let writeCount = 0;
  const handler = createFetchPosts({
    scrapePostsImpl: async () => ({ data: {} }),
    logger: createLogger(),
    mongooseClient: { connect: async () => {} },
    newPostModel: {
      findOneAndUpdate: async () => { writeCount += 1; },
    },
  });

  await assert.rejects(handler({ subreddit: "news" }), /missing posts/);
  assert.equal(writeCount, 0);
});

test("preserves existing thumbnails and logs batch counts without raw records", async () => {
  const posts = [{ data: { id: 'hidden-post', title: 'Story', selftext: 'private-marker', spoiler: true, thumbnail: 'spoiler', preview: { images: [{ source: { url: 'https://publisher.example/photo.jpg' } }] } } }];
  const logger = createLogger();
  const writes = [];
  const handler = createFetchPosts({
    scrapePostsImpl: createScraper({ posts }).scrapePostsImpl,
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
    scrapePostsImpl: createScraper({ posts }).scrapePostsImpl,
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
  scrapePostsImpl: createScraper({ posts: [diagnosticPost()] }).scrapePostsImpl,
  imageSourceImpl: async () => "",
  mongooseClient: { connect: async () => {} },
  newPostModel: { findOneAndUpdate: async () => {}, find: async () => [] },
  ...overrides,
});

test("browser and database failures reject with one sanitized job failure", async (t) => {
  for (const [stage, overrides] of [
    ["database_connect", { mongooseClient: { connect: async () => { throw Object.assign(new Error("connect mongodb+srv://reader:db-secret@mongo.example/db"), { code: "ECONNREFUSED", cause: new Error("private-cause") }); } } }],
    ["browser_extract", { scrapePostsImpl: async () => { throw new Error("browser failed https://reader:password@publisher.example/story?token=url-secret"); } }],
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
  const fetcher = createScraper({ posts: [
    { data: { ...diagnosticPost().data, title: "broken" } },
    { data: { ...diagnosticPost().data, title: "delayed" } },
  ] });
  const run = createFetchPosts({
    scrapePostsImpl: fetcher.scrapePostsImpl, logger, imageSourceImpl: async () => "",
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
    scrapePostsImpl: createScraper().scrapePostsImpl,
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


test("approved account authentication requires an explicit boolean event flag", async () => {
  const calls = [];
  const handler = createFetchPosts({
    scrapePostsImpl: async (options) => { calls.push(options); return []; },
    logger: createLogger(), mongooseClient: { connect: async () => {} },
    newPostModel: { find: async () => [] },
  });
  await handler({ subreddit: "politics", authenticate: "true" }, { getRemainingTimeInMillis: () => 240000 });
  await handler({ subreddit: "politics", authenticate: true }, { getRemainingTimeInMillis: () => 240000 });
  assert.equal(calls[0].authenticate, false);
  assert.equal(calls[0].timeoutMs, 90000);
  assert.equal(calls[1].authenticate, true);
  assert.equal(calls[1].timeoutMs, 150000);
});

test("scheduled sessions inherit the runtime default and report reuse metadata", async () => {
  const calls = [];
  const logger = createLogger();
  const handler = createFetchPosts({ env: { F5_REDDIT_SESSION_ENABLED: "true" },
    scrapePostsImpl: async (options) => { calls.push(options); const posts = []; posts.sessionMode = "reused"; posts.sessionGeneration = "fixture-generation"; return posts; },
    logger, mongooseClient: { connect: async () => {} }, newPostModel: { find: async () => [] },
  });
  await handler({ subreddit: "politics", renewSession: true, scheduled: true }, { getRemainingTimeInMillis: () => 240000 });
  await handler({ subreddit: "politics", session: false }, { getRemainingTimeInMillis: () => 240000 });
  assert.equal(calls[0].session, true);
  assert.equal(calls[0].renewSession, true);
  assert.equal(calls[0].timeoutMs, 210000);
  assert.equal(calls[1].session, false);
  assert.equal(calls[1].timeoutMs, 90000);
  const terminal = parseStructuredLogs(logger, "SCRAPER_JOB_COMPLETED")[0];
  assert.equal(terminal.trigger, "schedule");
  assert.equal(terminal.sessionMode, "reused");
  assert.equal(terminal.sessionGeneration, "fixture-generation");
});

test("session diagnostics read metadata without running a scrape or writing posts", async () => {
  const calls = [];
  const logger = createLogger();
  const handler = createFetchPosts({ logger, mongooseClient: { connect: async () => calls.push("connect") },
    inspectSessionImpl: async () => { calls.push("inspect"); return { statePresent: true, cookieCount: 2 }; },
    scrapePostsImpl: async () => { throw new Error("Unexpected scrape"); },
  });
  assert.deepEqual(await handler({ inspectSession: true }), { statePresent: true, cookieCount: 2 });
  assert.deepEqual(calls, ["connect", "inspect"]);
  assert.equal(parseStructuredLogs(logger, "BROWSER_SESSION_DIAGNOSTICS").length, 1);
  assert.equal(parseStructuredLogs(logger, "SCRAPER_JOB_COMPLETED").length, 0);
});

test("image detail priorities query recent missing or small link images without the article cooldown", async () => {
  const calls = {};
  const small = "https://external-preview.redd.it/story.jpg?width=140";
  const rows = [
    { commentLink: "/r/politics/comments/abc/story/", thumbnail: small },
    { commentLink: "/r/POLITICS/comments/def/another/", thumbnail: small },
    { commentLink: "/r/politics/comments/abc/duplicate/", thumbnail: small },
    { commentLink: "/r/news/comments/foreign/story/", thumbnail: small },
    { commentLink: "https://evil.example/r/politics/comments/abc/story/", thumbnail: small },
    { commentLink: "/r/politics/comments/bad-id/story/", thumbnail: small },
    { commentLink: "/r/politics/comments/large/story/", thumbnail: "https://preview.redd.it/photo.jpg?width=1080" },
    { commentLink: "/r/politics/comments/missing/story/" },
    { commentLink: "/r/politics/comments/nullimage/story/", thumbnail: null },
    { commentLink: "/r/politics/comments/empty/story/", thumbnail: "" },
    { commentLink: "/r/politics/comments/placeholder/story/", thumbnail: "default" },
    { commentLink: "/r/politics/comments/unusable/story/", thumbnail: "ftp://cdn.example/image.jpg" },
  ];
  const query = {
    sort(value) { calls.sort = value; return this; },
    limit(value) { calls.limit = value; return this; },
    select(value) { calls.select = value; return this; },
    maxTimeMS(value) { calls.maxTimeMS = value; return this; },
    then(resolve) { return Promise.resolve(rows).then(resolve); },
  };
  const ids = await findImagePriorityIds({ find: (filter) => { calls.filter = filter; return query; } }, "POLITICS", {
    now: () => new Date("2026-11-06T20:00:00Z"), logger: createLogger(),
  });
  assert.deepEqual(ids, ["t3_abc", "t3_def", "t3_missing", "t3_nullimage", "t3_empty", "t3_placeholder", "t3_unusable"]);
  assert.equal(calls.filter.sub, "politics");
  assert.deepEqual(calls.filter.created_utc, { $gt: Date.parse("2026-11-06T12:00:00Z") / 1000 });
  for (const field of ["is_self", "is_video", "is_gallery"]) assert.deepEqual(calls.filter[field], { $ne: true });
  assert.deepEqual(calls.filter.post_hint, { $nin: ["image", "rich:video"] });
  assert.equal(calls.filter.thumbnailQualityCheckedAt, undefined);
  assert.ok(calls.filter.$or.some((clause) => clause.thumbnail === null));
  assert.ok(calls.filter.$or.some((clause) => clause.thumbnail === ""));
  assert.ok(calls.filter.$or.some((clause) => clause.thumbnail?.$exists === false));
  assert.ok(calls.filter.$or.some((clause) => clause.thumbnail?.$not?.$regex === "^https?://"));
  assert.ok(calls.filter.$or.some((clause) => typeof clause.thumbnail?.$regex === "string"));
  assert.ok(new RegExp(calls.filter.url.$regex, "i").test("https://publisher.example/story"));
  assert.ok(!new RegExp(calls.filter.url.$regex, "i").test("https://www.reddit.com/r/politics/"));
  assert.deepEqual(calls.sort, { upvoteCount: -1 });
  assert.equal(calls.limit, 25);
  assert.equal(calls.select, "commentLink thumbnail");
  assert.equal(calls.maxTimeMS, 1500);
});

test("image priorities explicitly skip details when no eligible stored images exist", async () => {
  assert.deepEqual(await findImagePriorityIds({ find: async () => [] }, "politics"), []);
  assert.deepEqual(await findImagePriorityIds({ find: () => { throw new Error("Unexpected query"); } }, "unsupported"), []);
  const rows = Array.from({ length: 40 }, (_, index) => ({ commentLink: `/r/politics/comments/a${index}/story/`, thumbnail: "https://preview.redd.it/photo.jpg?width=140" }));
  assert.equal((await findImagePriorityIds({ find: () => rows }, "politics")).length, 25);
});

test("optional image priority failure logs no database details and does not fail the scrape", async () => {
  const logger = createLogger();
  let queries = 0;
  let options;
  const handler = createFetchPosts({
    scrapePostsImpl: async (value) => { options = value; return []; },
    newPostModel: { find: async () => { if (++queries === 1) throw new Error("Private database details"); return []; } },
    mongooseClient: { connect: async () => {} }, logger,
  });
  await handler({ subreddit: "politics" });
  assert.equal(options.imagePriorityIds, undefined);
  assert.equal(logger.warnings.length, 1);
  assert.ok(!logger.warnings[0][0].includes("Private database details"));
  assert.equal(parseStructuredLogs(logger, "SCRAPER_JOB_COMPLETED")[0].outcome, "success");
});

test("image priority queries have a hard optional deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const logger = createLogger();
  const result = findImagePriorityIds({ find: () => new Promise(() => {}) }, "politics", { logger });
  t.mock.timers.tick(1500);
  assert.equal(await result, undefined);
  assert.equal(logger.warnings.length, 1);
});

test("normal scrapes pass validated stored image priorities to the browser", async () => {
  let options;
  const handler = createFetchPosts({
    scrapePostsImpl: async (value) => { options = value; return []; },
    newPostModel: { find: async (filter) => filter.url?.$regex ? [{ commentLink: "/r/politics/comments/abc/story/", thumbnail: "https://preview.redd.it/photo.jpg?width=140" }] : [] },
    mongooseClient: { connect: async () => {} }, logger: createLogger(),
  });
  await handler({ subreddit: "politics" });
  assert.deepEqual(options.imagePriorityIds, ["t3_abc"]);
});

test("deferred proactive renewal keeps successful collection visible as degraded", async () => {
  const logger = createLogger();
  const posts = [];
  posts.sessionMode = "reused";
  posts.sessionGeneration = "fixture-generation";
  posts.sessionRenewalDeferred = true;
  const handler = createFetchPosts({ logger, mongooseClient: { connect: async () => {} },
    scrapePostsImpl: async () => posts, newPostModel: { find: async () => [] },
  });
  await handler({ subreddit: "politics", session: true }, { getRemainingTimeInMillis: () => 240000 });
  const terminal = parseStructuredLogs(logger, "SCRAPER_JOB_COMPLETED")[0];
  assert.equal(terminal.outcome, "degraded");
  assert.equal(terminal.sessionMode, "reused");
  assert.equal(terminal.sessionRenewalDeferred, true);
});
