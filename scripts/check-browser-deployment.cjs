const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const assert = require("node:assert/strict");

function checkInvocation(metadata) {
  assert.ok(!metadata.FunctionError, "Browser scraper invocation failed; inspect its CloudWatch logs");
  assert.equal(metadata.StatusCode, 200, "Lambda invocation did not succeed");
  const records = Buffer.from(metadata.LogResult || "", "base64").toString().split("\n").flatMap((line) => {
    try { return [JSON.parse(line.slice(line.indexOf("{")))]; } catch { return []; }
  });
  const completed = records.findLast((entry) => entry.eventType === "SCRAPER_JOB_COMPLETED");
  assert.ok(completed, "Browser scraper did not report completion");
  assert.ok(["success", "degraded"].includes(completed.outcome), "Browser scraper reported failure");
  assert.ok(Number.isInteger(completed.fetchedCount) && completed.fetchedCount > 0 && completed.fetchedCount <= 25, "Browser scraper returned no usable posts");
  assert.equal(completed.savedCount, completed.fetchedCount, "Browser scraper did not save every extracted post");
  return { outcome: completed.outcome, fetchedCount: completed.fetchedCount, savedCount: completed.savedCount };
}

if (require.main === module) {
  try {
    const payloadFile = "/tmp/f5-browser-live-probe.json";
    const result = JSON.parse(execFileSync("aws", ["lambda", "invoke", "--function-name", "scraper-dev-fetchPosts-browser",
      "--cli-binary-format", "raw-in-base64-out", "--payload", JSON.stringify({ subreddit: "politics" }),
      "--log-type", "Tail", "--cli-read-timeout", "260", payloadFile], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    if (result.FunctionError) {
      const error = JSON.parse(readFileSync(payloadFile, "utf8"));
      const reason = String(error.errorMessage).match(/Browser extraction failed: (blocked|empty|loading_timeout|challenge_required|runtime_error)/)?.[0];
      if (reason) console.error(reason);
    }
    console.log(JSON.stringify({ eventType: "BROWSER_LIVE_PROBE", subreddit: "politics", ...checkInvocation(result) }));
  } catch (error) {
    console.error(error instanceof assert.AssertionError ? error.message : "Unable to verify the browser scraper invocation");
    process.exitCode = 1;
  }
}

module.exports = { checkInvocation };
