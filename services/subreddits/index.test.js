const assert = require("assert");
const test = require("node:test");

const { createGetSubreddits } = require("./index");

const configuredSubreddits = [
  "politics",
  "worldnews",
  "europe",
  "news",
  "technology",
  "science",
  "health",
  "energy",
  "sports",
  "business",
  "Economics",
];

const getJsonBody = (response) => JSON.parse(response.body);

const allowedEvent = (event = {}) => ({
  ...event,
  headers: {
    origin: "https://f5.news",
    ...(event.headers || {}),
  },
});

const createHandler = () => createGetSubreddits();

test("returns configured subreddit names", async () => {
  const handler = createHandler();

  const response = await handler({
    headers: {
      origin: "https://www.f5.news",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Access-Control-Allow-Origin"], "https://www.f5.news");
  assert.equal(response.headers.Vary, "Origin");
  assert.equal(response.headers["Access-Control-Allow-Credentials"], undefined);
  assert.deepEqual(getJsonBody(response), {
    success: true,
    count: configuredSubreddits.length,
    data: configuredSubreddits,
  });
});

test("rejects disallowed origins before querying subreddits", async () => {
  const handler = createHandler();

  const response = await handler({
    headers: {
      origin: "https://evil.example",
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(response.headers["Access-Control-Allow-Credentials"], undefined);
  assert.deepEqual(getJsonBody(response), {
    success: false,
    error: "Forbidden origin",
  });
});

test("rejects requests with no origin before querying subreddits", async () => {
  const handler = createHandler();

  const response = await handler({
    headers: {},
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.headers["Access-Control-Allow-Origin"], undefined);
  assert.deepEqual(getJsonBody(response), {
    success: false,
    error: "Forbidden origin",
  });
});

test("ignores injected database-only subreddit names", async () => {
  const handler = createGetSubreddits({
    postModel: {
      distinct: () => ({
        exec: async () => ["StockMarket", "LocalNews"],
      }),
    },
  });

  const response = await handler(allowedEvent());

  assert.equal(response.statusCode, 200);
  assert.deepEqual(getJsonBody(response), {
    success: true,
    count: configuredSubreddits.length,
    data: configuredSubreddits,
  });
});
