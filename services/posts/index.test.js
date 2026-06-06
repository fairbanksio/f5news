const assert = require("assert");
const test = require("node:test");

const { createGetPostsBySubreddit } = require("./index");

const createPostModel = (posts = []) => {
  const calls = [];
  const query = {
    sort(sortOptions) {
      calls.push({ method: "sort", args: [sortOptions] });
      return query;
    },
    limit(limitCount) {
      calls.push({ method: "limit", args: [limitCount] });
      return posts;
    },
  };

  return {
    calls,
    find(findOptions) {
      calls.push({ method: "find", args: [findOptions] });
      return query;
    },
  };
};

const getJsonBody = (response) => JSON.parse(response.body);

const getFindCall = (postModel) => postModel.calls.find((call) => call.method === "find");

const expectedCutoff = (date, seconds) => Math.floor(date.getTime() / 1000) - seconds;

const allowedEvent = (event = {}) => ({
  ...event,
  headers: {
    origin: "https://f5.news",
    ...(event.headers || {}),
  },
});

const createHandler = ({
  now,
  posts = [{ title: "Story" }],
  mongooseClient,
  postModel,
} = {}) => {
  let connectCount = 0;
  const model = postModel || createPostModel(posts);
  const handler = createGetPostsBySubreddit({
    mongooseClient: mongooseClient || {
      connect: async () => {
        connectCount += 1;
      },
    },
    postModel: model,
    now: () => now || new Date("2024-03-10T12:00:00.000Z"),
  });

  return {
    handler,
    postModel: model,
    get connectCount() {
      return connectCount;
    },
  };
};

test("queries recent popular posts for the requested subreddit", async () => {
  const now = new Date("2024-03-10T12:00:00.000Z");
  const context = createHandler({ now });

  const response = await context.handler({
    headers: {
      origin: "https://f5.news",
    },
    pathParameters: {
      subreddit: "worldnews",
    },
  });

  assert.equal(context.connectCount, 1);
  assert.deepEqual(context.postModel.calls, [
    {
      method: "find",
      args: [
        {
          created_utc: { $gt: 1710057600 },
          upvoteCount: { $gt: 5 },
          sub: "worldnews",
        },
      ],
    },
    {
      method: "sort",
      args: [{ upvoteCount: -1, created_utc: 1 }],
    },
    {
      method: "limit",
      args: [20],
    },
  ]);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Access-Control-Allow-Origin"], "https://f5.news");
  assert.equal(response.headers.Vary, "Origin");
  assert.equal(response.headers["Access-Control-Allow-Credentials"], undefined);
  assert.deepEqual(getJsonBody(response), {
    success: true,
    count: 1,
    data: [{ title: "Story" }],
  });
});

test("rejects disallowed origins before querying posts", async () => {
  const context = createHandler();

  const response = await context.handler({
    headers: {
      origin: "https://evil.example",
    },
    pathParameters: {
      subreddit: "worldnews",
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(context.connectCount, 0);
  assert.equal(response.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(response.headers["Access-Control-Allow-Credentials"], undefined);
  assert.deepEqual(getJsonBody(response), {
    success: false,
    error: "Forbidden origin",
  });
});

test("returns an empty successful response when no posts match", async () => {
  const context = createHandler({ posts: [] });

  const response = await context.handler(allowedEvent({
    pathParameters: {
      subreddit: "worldnews",
    },
  }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(getJsonBody(response), {
    success: true,
    count: 0,
    data: [],
  });
});

test("uses the default clock when no clock is injected", async () => {
  const postModel = createPostModel([]);
  const handler = createGetPostsBySubreddit({
    mongooseClient: {
      connect: async () => {},
    },
    postModel,
  });

  const response = await handler(allowedEvent({
    pathParameters: {
      subreddit: "worldnews",
    },
  }));

  assert.equal(response.statusCode, 200);
  assert.equal(typeof getFindCall(postModel).args[0].created_utc.$gt, "number");
});

test("uses an eight hour cutoff before the UTC daytime window", async () => {
  const now = new Date("2024-03-10T10:00:00.000Z");
  const context = createHandler({ now });

  await context.handler(allowedEvent({
    pathParameters: {
      subreddit: "news",
    },
  }));

  assert.deepEqual(context.postModel.calls[0], {
    method: "find",
    args: [
      {
        created_utc: { $gt: 1710036000 },
        upvoteCount: { $gt: 5 },
        sub: "news",
      },
    ],
  });
});

test("uses the four hour cutoff at the start of the UTC daytime window", async () => {
  const now = new Date("2024-03-10T11:00:00.000Z");
  const context = createHandler({ now });

  await context.handler(allowedEvent({
    pathParameters: {
      subreddit: "news",
    },
  }));

  assert.equal(
    getFindCall(context.postModel).args[0].created_utc.$gt,
    expectedCutoff(now, 14400)
  );
});

test("uses the four hour cutoff at the end of the UTC daytime window", async () => {
  const now = new Date("2024-03-10T23:00:00.000Z");
  const context = createHandler({ now });

  await context.handler(allowedEvent({
    pathParameters: {
      subreddit: "news",
    },
  }));

  assert.equal(
    getFindCall(context.postModel).args[0].created_utc.$gt,
    expectedCutoff(now, 14400)
  );
});

test("returns a bad request response when the subreddit path parameter is missing", async () => {
  const context = createHandler();

  const response = await context.handler(allowedEvent({
    pathParameters: {},
  }));

  assert.equal(response.statusCode, 400);
  assert.equal(context.connectCount, 0);
  assert.deepEqual(getJsonBody(response), {
    success: false,
    error: "Missing subreddit path parameter",
  });
});

test("returns a bad request response when path parameters are missing", async () => {
  const context = createHandler();

  const response = await context.handler(allowedEvent());

  assert.equal(response.statusCode, 400);
  assert.equal(context.connectCount, 0);
  assert.deepEqual(getJsonBody(response), {
    success: false,
    error: "Missing subreddit path parameter",
  });
});

test("returns a server error response when the post query fails", async () => {
  const context = createHandler({
    postModel: {
      find() {
        throw new Error("query failed");
      },
    },
  });

  const response = await context.handler(allowedEvent({
    pathParameters: {
      subreddit: "news",
    },
  }));

  assert.equal(response.statusCode, 500);
  assert.deepEqual(getJsonBody(response), {
    success: false,
    error: "Failed to fetch posts",
  });
});
