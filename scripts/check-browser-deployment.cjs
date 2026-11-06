const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const assert = require("node:assert/strict");

function logRecords(metadata) {
  return Buffer.from(metadata.LogResult || "", "base64").toString().split("\n").flatMap((line) => {
    try {
      const record = JSON.parse(line.slice(line.indexOf("{")));
      if (typeof record.message === "string" && record.message.startsWith("{")) return [JSON.parse(record.message)];
      return [record];
    } catch { return []; }
  });
}

function failureSummary(metadata, payload, env = process.env) {
  const clean = (value) => {
    let text = String(value || "");
    for (const [key, secret] of Object.entries(env)) {
      if (/SECRET|TOKEN|PASSWORD|CONNECTION|API_KEY|ACCESS_KEY/.test(key) && typeof secret === "string" && secret.length >= 8) text = text.split(secret).join("[redacted]");
    }
    return text.replace(/(?:https?|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi, "[redacted-url]")
      .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, "$1 [redacted]")
      .replace(/\b(password|token|secret|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").slice(0, 500);
  };
  const errorType = clean(payload?.errorType || "LambdaInvocationError");
  return {
    errorType,
    errorMessage: /^Mongo/.test(errorType) ? "Database operation failed" : clean(payload?.errorMessage || "Lambda invocation failed"),
    browserErrors: logRecords(metadata).filter((record) => record.eventType === "BROWSER_PROGRESS" && /Browser test failed|Browser page crashed/.test(record.message || ""))
      .slice(-2).map((record) => clean(record.message)),
  };
}

function checkInvocation(metadata) {
  assert.ok(!metadata.FunctionError, "Browser scraper invocation failed; inspect its CloudWatch logs");
  assert.equal(metadata.StatusCode, 200, "Lambda invocation did not succeed");
  const records = logRecords(metadata);
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
      console.error(JSON.stringify({ eventType: "BROWSER_LIVE_PROBE_FAILED", ...failureSummary(result, error) }));
    }
    console.log(JSON.stringify({ eventType: "BROWSER_LIVE_PROBE", subreddit: "politics", ...checkInvocation(result) }));
  } catch (error) {
    console.error(error instanceof assert.AssertionError ? error.message : "Unable to verify the browser scraper invocation");
    process.exitCode = 1;
  }
}

module.exports = { checkInvocation, failureSummary };
