const assert = require("assert");
const test = require("node:test");

const { get_subreddits: handler } = require("./index");

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

test("returns configured subreddit names", async () => {
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

test("rejects disallowed origins", async () => {
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

test("rejects requests with no origin", async () => {
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
