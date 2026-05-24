const assert = require("assert");
const test = require("node:test");

const { createFetchPosts } = require("./index");

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
  log: () => {},
  warn: () => {},
});

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
