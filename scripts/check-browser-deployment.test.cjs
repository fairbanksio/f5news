const test = require("node:test");
const assert = require("node:assert/strict");
const { checkInvocation } = require("./check-browser-deployment.cjs");
const response = (fields = {}) => ({ StatusCode: 200, LogResult: Buffer.from('request prefix\t' + JSON.stringify({ eventType: "SCRAPER_JOB_COMPLETED", outcome: "success", fetchedCount: 25, savedCount: 25, ...fields })).toString("base64") });
test("deployment probe accepts saved posts and optional image degradation", () => {
  assert.equal(checkInvocation(response()).savedCount, 25);
  assert.equal(checkInvocation(response({ outcome: "degraded" })).outcome, "degraded");
});
test("deployment probe rejects Lambda errors despite HTTP success", () => {
  assert.throws(() => checkInvocation({ ...response(), FunctionError: "Unhandled" }));
});
test("deployment probe rejects missing terminal logs and incomplete writes", () => {
  for (const result of [{ StatusCode: 200 }, response({ fetchedCount: 0, savedCount: 0 }), response({ savedCount: 24 }), response({ outcome: "failed" })]) assert.throws(() => checkInvocation(result));
});
