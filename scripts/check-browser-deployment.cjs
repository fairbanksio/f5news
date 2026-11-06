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
  const records = logRecords(metadata);
  const structuredErrors = records.filter((record) => record.errorMessage).map((record) => /^Mongo/.test(record.errorType || record.errorName || "") ? "Database operation failed" : clean(record.errorMessage));
  const startupLines = Buffer.from(metadata.LogResult || "", "base64").toString().split("\n").filter((line) => {
    if (/\bat\s+.*(?:\(|:\d)/.test(line)) return false;
    if (line.includes("{")) return false;
    return /\b(?:Error|TypeError|ReferenceError|SyntaxError):|\[FATAL\b|cannot open shared object|GLIBC_|Permission denied|No such file/i.test(line);
  }).map(clean);
  return {
    errorType,
    errorMessage: /^Mongo/.test(errorType) ? "Database operation failed" : clean(payload?.errorMessage || "Lambda invocation failed"),
    startupErrors: [...new Set([...structuredErrors, ...startupLines])].slice(0, 3),
    browserErrors: records.filter((record) => record.eventType === "BROWSER_PROGRESS" && !/\bat\s+.*(?:\(|:\d)/.test(record.message || "") && /Browser test failed|Browser page crashed|Failed to|not permitted|Permission denied|Sandbox|ENOENT|EACCES|EPERM|SIGSEGV|SIGABRT|Read-only|No such file/i.test(record.message || ""))
      .slice(-3).map((record) => clean(record.message)),
  };
}

function checkInvocation(metadata, { session = false } = {}) {
  assert.ok(!metadata.FunctionError, "Browser scraper invocation failed; inspect its CloudWatch logs");
  assert.equal(metadata.StatusCode, 200, "Lambda invocation did not succeed");
  const records = logRecords(metadata);
  const completed = records.findLast((entry) => entry.eventType === "SCRAPER_JOB_COMPLETED");
  assert.ok(completed, "Browser scraper did not report completion");
  assert.ok(["success", "degraded"].includes(completed.outcome), "Browser scraper reported failure");
  assert.ok(Number.isInteger(completed.fetchedCount) && completed.fetchedCount > 0 && completed.fetchedCount <= 25, "Browser scraper returned no usable posts");
  assert.equal(completed.savedCount, completed.fetchedCount, "Browser scraper did not save every extracted post");
  const summary = { outcome: completed.outcome, fetchedCount: completed.fetchedCount, savedCount: completed.savedCount };
  if (session) {
    assert.ok(["reused", "renewed"].includes(completed.sessionMode), "Browser scraper did not report session reuse or renewal");
    assert.match(completed.sessionGeneration || "", /^[A-Za-z0-9_-]{1,128}$/, "Browser scraper did not report a safe session generation");
    summary.sessionMode = completed.sessionMode;
    summary.sessionGeneration = completed.sessionGeneration;
  }
  return summary;
}

const FEEDS = ["politics", "worldnews", "europe", "news", "technology", "science", "health", "energy", "sports", "business", "Economics"];

async function verifyFeeds({ allFeeds = false, session = true, authenticate = false, renewSession = false, invoke, emit = console.log } = {}) {
  assert.ok(!(allFeeds && authenticate), "All-feed verification uses one shared session; authenticate is only available for a single bootstrap");
  assert.ok(!allFeeds || session, "All-feed verification requires session reuse");
  assert.ok(!renewSession || (session && !authenticate), "Session renewal requires shared-session verification without bootstrap authentication");
  const events = (allFeeds ? [...FEEDS, "politics"] : ["politics"]).map((subreddit, index) => ({
    subreddit,
    ...(authenticate ? { authenticate: true, session: false } : { session }),
    ...(renewSession && index === 0 ? { renewSession: true } : {}),
  }));
  const results = [];
  for (const event of events) {
    const result = checkInvocation(await invoke(event), { session: session && !authenticate });
    if (renewSession && results.length === 0) {
      assert.equal(result.sessionMode, "renewed", "Requested session renewal did not create a renewed session");
    }
    if (allFeeds && results.length) {
      assert.equal(result.sessionGeneration, results[0].sessionGeneration, "Feed verification did not retain one shared session generation");
      assert.ok(result.sessionMode !== "renewed" || !results.some((entry) => entry.sessionMode === "renewed"), "Feed verification renewed the session more than once");
    }
    const entry = { eventType: "BROWSER_LIVE_PROBE", subreddit: event.subreddit, repeated: results.length === FEEDS.length, ...result };
    results.push(entry);
    emit(JSON.stringify(entry));
  }
  if (allFeeds) {
    assert.equal(results.at(-1).sessionMode, "reused", "Repeated politics invocation did not reuse the shared session");
  }
  const summary = { eventType: "BROWSER_LIVE_PROBE_COMPLETED", feedCount: allFeeds ? FEEDS.length : 1,
    invocationCount: results.length, savedCount: results.reduce((sum, result) => sum + result.savedCount, 0),
    renewalRequested: renewSession,
    ...(session && !authenticate ? { sessionGeneration: results[0].sessionGeneration,
      renewedCount: results.filter((result) => result.sessionMode === "renewed").length,
      reusedCount: results.filter((result) => result.sessionMode === "reused").length } : {}),
  };
  emit(JSON.stringify(summary));
  return { results, summary };
}

function invokeLive(event) {
  const payloadFile = "/tmp/f5-browser-live-probe.json";
  const options = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, AWS_MAX_ATTEMPTS: "1" } };
  const result = JSON.parse(execFileSync("aws", ["lambda", "invoke", "--function-name", "scraper-dev-fetchPosts-browser",
    "--cli-binary-format", "raw-in-base64-out", "--payload", JSON.stringify(event),
    "--log-type", "Tail", "--cli-read-timeout", "260", payloadFile], options));
  if (result.FunctionError) {
    const error = JSON.parse(readFileSync(payloadFile, "utf8"));
    let logText = Buffer.from(result.LogResult || "", "base64").toString();
    try {
      const logs = JSON.parse(execFileSync("aws", ["logs", "filter-log-events", "--log-group-name", "/aws/lambda/scraper-dev-fetchPosts-browser",
        "--start-time", String(Date.now() - 300_000), "--limit", "50"], options));
      logText += "\n" + (logs.events || []).map((entry) => entry.message).join("\n");
    } catch { console.error("Initialization log lookup unavailable"); }
    console.error(JSON.stringify({ eventType: "BROWSER_LIVE_PROBE_FAILED", subreddit: event.subreddit,
      ...failureSummary({ ...result, LogResult: Buffer.from(logText).toString("base64") }, error) }));
  }
  return result;
}

if (require.main === module) {
  verifyFeeds({ allFeeds: process.env.F5_PROBE_ALL_FEEDS === "true",
    session: process.env.F5_PROBE_SESSION !== "false", authenticate: process.env.F5_PROBE_AUTHENTICATE === "true",
    renewSession: process.env.F5_PROBE_RENEW_SESSION === "true",
    invoke: invokeLive,
  }).catch((error) => {
    console.error(error instanceof assert.AssertionError ? error.message : "Unable to verify the browser scraper invocation");
    process.exitCode = 1;
  });
}

module.exports = { checkInvocation, failureSummary, verifyFeeds, FEEDS };
