const test = require("node:test");
const assert = require("node:assert/strict");
const { checkInvocation, failureSummary } = require("./check-browser-deployment.cjs");
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


test("failed probe summaries omit secrets, URLs, and stacks", () => {
  const result = failureSummary({}, { errorType: "Runtime.ImportModuleError", errorMessage: "missing handler bearer private-token https://private.example/path?token=hidden password=hidden env-secret-value", stack: "private-stack" }, { API_KEY: "env-secret-value" });
  const output = JSON.stringify(result);
  for (const secret of ["private-token", "private.example", "hidden", "env-secret-value", "private-stack"]) assert.ok(!output.includes(secret));
  assert.equal(result.errorType, "Runtime.ImportModuleError");
  assert.equal(failureSummary({}, { errorType: "MongoServerSelectionError", errorMessage: "private database host" }).errorMessage, "Database operation failed");
});

test("failed probe summaries include only browser failure messages", () => {
  const logs = [
    { eventType: "POST_BATCH", privateData: "private-post" },
    { eventType: "BROWSER_PROGRESS", message: "Launching browser." },
    { eventType: "BROWSER_PROGRESS", message: "Browser test failed (PermissionError): Read-only filesystem" },
  ];
  const summary = failureSummary({ LogResult: Buffer.from(logs.map(JSON.stringify).join("\n")).toString("base64") }, {});
  assert.deepEqual(summary.browserErrors, [logs[2].message]);
  assert.ok(!JSON.stringify(summary).includes("private-post"));
});


test("bootstrap diagnostics keep error messages and omit stack frames", () => {
  const lines = [
    "Error: Cannot find module /var/task/index", "    at privateStack (/private/stack.js:10)",
    JSON.stringify({ errorType: "Runtime.ImportModuleError", errorMessage: "missing handler https://private.example/path?token=hidden", stack: ["private-stack"] }),
  ];
  const result = failureSummary({ LogResult: Buffer.from(lines.join("\n")).toString("base64") }, {});
  assert.ok(result.startupErrors.includes(lines[0]));
  const output = JSON.stringify(result);
  for (const secret of ["privateStack", "private-stack", "private.example", "hidden"]) assert.ok(!output.includes(secret));
});
