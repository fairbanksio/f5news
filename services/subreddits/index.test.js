const assert = require("assert");
const test = require("node:test");

const { createGetSubreddits } = require("./index");

const createPostModel = (subreddits = []) => {
  const calls = [];
  const distinctQuery = {
    exec: async () => subreddits,
  };

  return {
    calls,
    distinct(field, filter) {
      calls.push({ method: "distinct", args: [field, filter] });
      return distinctQuery;
    },
  };
};

const getJsonBody = (response) => JSON.parse(response.body);

const allowedEvent = (event = {}) => ({
  ...event,
  headers: {
    origin: "https://f5.news",
    ...(event.headers || {}),
  },
});

const createHandler = ({
  now = new Date("2024-03-10T12:00:00.000Z"),
  subreddits = ["news", "politics"],
  mongooseClient,
  postModel,
} = {}) => {
  let connectCount = 0;
  const model = postModel || createPostModel(subreddits);
  const handler = createGetSubreddits({
    mongooseClient: mongooseClient || {
      connect: async () => {
        connectCount += 1;
      },
    },
    postModel: model,
    now: () => now,
  });

  return {
    handler,
    postModel: model,
    get connectCount() {
      return connectCount;
    },
  };
};

test("returns configured and database-known subreddit names", async () => {
  const context = createHandler();

  const response = await context.handler({
    headers: {
      origin: "https://www.f5.news",
    },
  });

  assert.equal(context.connectCount, 1);
  assert.deepEqual(context.postModel.calls, [
    {
      method: "distinct",
      args: ["sub", {}],
    },
  ]);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Access-Control-Allow-Origin"], "https://www.f5.news");
  assert.equal(response.headers.Vary, "Origin");
  assert.equal(response.headers["Access-Control-Allow-Credentials"], undefined);
  assert.deepEqual(getJsonBody(response), {
    success: true,
    count: 8,
    data: [
      "politics",
      "worldnews",
      "news",
      "technology",
      "science",
      "environment",
      "business",
      "Economics",
    ],
  });
});

test("rejects disallowed origins before querying subreddits", async () => {
  const context = createHandler();

  const response = await context.handler({
    headers: {
      origin: "https://evil.example",
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

test("rejects requests with no origin before querying subreddits", async () => {
  const context = createHandler();

  const response = await context.handler({
    headers: {},
  });

  assert.equal(response.statusCode, 403);
  assert.equal(context.connectCount, 0);
  assert.equal(response.headers["Access-Control-Allow-Origin"], undefined);
  assert.deepEqual(getJsonBody(response), {
    success: false,
    error: "Forbidden origin",
  });
});

test("returns configured subreddits when no posts have been stored yet", async () => {
  const context = createHandler({ subreddits: [] });

  const response = await context.handler(allowedEvent());

  assert.equal(response.statusCode, 200);
  assert.deepEqual(getJsonBody(response), {
    success: true,
    count: 8,
    data: [
      "politics",
      "worldnews",
      "news",
      "technology",
      "science",
      "environment",
      "business",
      "Economics",
    ],
  });
});

test("includes database-only subreddit names after configured subreddits", async () => {
  const context = createHandler({ subreddits: ["news", "LocalNews"] });

  const response = await context.handler(allowedEvent());

  assert.deepEqual(getJsonBody(response), {
    success: true,
    count: 9,
    data: [
      "politics",
      "worldnews",
      "news",
      "technology",
      "science",
      "environment",
      "business",
      "Economics",
      "LocalNews",
    ],
  });
});

test("queries all known subreddits when no clock is injected", async () => {
  const postModel = createPostModel([]);
  const handler = createGetSubreddits({
    mongooseClient: {
      connect: async () => {},
    },
    postModel,
  });

  const response = await handler(allowedEvent());

  assert.equal(response.statusCode, 200);
  assert.deepEqual(postModel.calls[0].args, ["sub", {}]);
});

test("returns a server error response when the subreddit query fails", async () => {
  const context = createHandler({
    postModel: {
      distinct() {
        throw new Error("query failed");
      },
    },
  });

  const response = await context.handler(allowedEvent());

  assert.equal(response.statusCode, 500);
  assert.deepEqual(getJsonBody(response), {
    success: false,
    error: "Failed to fetch subreddits",
  });
});
