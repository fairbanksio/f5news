const assert = require("node:assert/strict");
const test = require("node:test");
const { probeRedditOAuth } = require("./oauth-probe");

const ssm = { send: async ({ input }) => {
  assert.deepEqual(input, { Names: ["reddit_client_id", "reddit_secret_key"], WithDecryption: true });
  return { Parameters: [
    { Name: "reddit_secret_key", Value: "fixture-secret" },
    { Name: "reddit_client_id", Value: "fixture-id" },
  ] };
} };

test("uses the saved OAuth client to read one post without returning sensitive data", async () => {
  const requests = [];
  const result = await probeRedditOAuth({ ssm, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return requests.length === 1
      ? Response.json({ access_token: "fixture-token" })
      : Response.json({ kind: "Listing", data: { children: [{ data: { title: "Fixture story" } }] } });
  } });
  assert.deepEqual(result, { stage: "listing", outcome: "success", tokenStatus: 200, listingStatus: 200, postCount: 1 });
  assert.equal(requests[0].options.body, "grant_type=client_credentials");
  assert.equal(requests[0].options.headers.Authorization, "Basic " + Buffer.from("fixture-id:fixture-secret").toString("base64"));
  assert.equal(requests[1].url, "https://oauth.reddit.com/r/politics/rising?limit=1");
  assert.equal(requests[1].options.headers.Authorization, "Bearer fixture-token");
});

test("does not request the listing if Reddit rejects the client", async () => {
  let requests = 0;
  const result = await probeRedditOAuth({ ssm, fetchImpl: async () => {
    requests++;
    return new Response("", { status: 401 });
  } });
  assert.equal(requests, 1);
  assert.deepEqual(result, { stage: "token", outcome: "rejected", tokenStatus: 401 });
});
