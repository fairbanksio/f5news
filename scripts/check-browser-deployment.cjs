const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const assert = require("node:assert/strict");
const { createPublicKey, randomBytes, createCipheriv, publicEncrypt, constants } = require("node:crypto");

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

async function verifyFeeds({ allFeeds = false, subreddit = "politics", session = true, authenticate = false, renewSession = false, invoke, emit = console.log } = {}) {
  assert.ok(FEEDS.includes(subreddit), "Select a configured subreddit for browser verification");
  assert.ok(!(allFeeds && authenticate), "All-feed verification uses one shared session; authenticate is only available for a single bootstrap");
  assert.ok(!allFeeds || session, "All-feed verification requires session reuse");
  assert.ok(!renewSession || (session && !authenticate), "Session renewal requires shared-session verification without bootstrap authentication");
  const events = (allFeeds ? [...FEEDS, "politics"] : [subreddit]).map((subreddit, index) => ({
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
      const previous = results.at(-1);
      const changed = result.sessionGeneration !== previous.sessionGeneration;
      if (result.sessionMode === "renewed") {
        assert.ok(!results.some((entry) => entry.sessionMode === "renewed"), "Feed verification renewed the session more than once");
        assert.ok(changed, "Session renewal did not report a new generation");
        assert.ok(!results.some((entry) => entry.sessionGeneration === result.sessionGeneration), "Session renewal returned an earlier generation");
      } else {
        assert.ok(!changed, "Feed verification changed session generation without a reported renewal");
      }
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
    ...(session && !authenticate ? { initialGeneration: results[0].sessionGeneration,
      sessionGeneration: results.at(-1).sessionGeneration,
      generationCount: new Set(results.map((result) => result.sessionGeneration)).size,
      renewedCount: results.filter((result) => result.sessionMode === "renewed").length,
      reusedCount: results.filter((result) => result.sessionMode === "reused").length } : {}),
  };
  emit(JSON.stringify(summary));
  return { results, summary };
}

async function verifySessionDiagnostics({ invoke, publicKey, emit = console.log } = {}) {
  let key;
  try {
    assert.ok(typeof publicKey === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(publicKey));
    key = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
    assert.ok(key.asymmetricKeyType === "rsa" && key.asymmetricKeyDetails.modulusLength >= 2048);
  } catch {
    assert.fail("Session diagnostics requires a base64 DER SPKI RSA public key of at least 2048 bits");
  }
  const metadata = await invoke({ inspectSession: true });
  assert.ok(!metadata.FunctionError, "Session diagnostics invocation failed; inspect its CloudWatch logs");
  assert.equal(metadata.StatusCode, 200, "Session diagnostics invocation did not succeed");
  const record = logRecords(metadata).findLast((entry) => entry.eventType === "BROWSER_SESSION_DIAGNOSTICS");
  assert.ok(record, "Session diagnostics did not report a result");
  assert.ok(typeof record.generation === "string" && /^(?:none|invalid|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(record.generation), "Session diagnostics reported an invalid generation identifier");
  const summary = { eventType: "BROWSER_SESSION_DIAGNOSTICS", generation: record.generation };
  for (const field of ["statePresent", "stateReadable", "leaseActive", "versionSupported", "seedValid"]) {
    assert.ok(typeof record[field] === "boolean", `Session diagnostics missing boolean field: ${field}`);
    summary[field] = record[field];
  }
  for (const field of ["sessionAgeSeconds", "cooldownSeconds", "minimumRootAccountExpirySeconds"]) {
    assert.ok(record[field] === null || (typeof record[field] === "number" && Number.isFinite(record[field])), `Session diagnostics missing numeric field: ${field}`);
    summary[field] = record[field];
  }
  for (const field of ["cookieCount", "rootAccountCookieCount", "unexpiredRootAccountCookieCount", "expiredRootAccountCookieCount",
    "sessionRootAccountCookieCount", "otherExpiredCookieCount", "unknownCookieAttributeCount", "originCount", "stateBytes"]) {
    assert.ok(Number.isSafeInteger(record[field]) && record[field] >= 0, `Session diagnostics missing count field: ${field}`);
    summary[field] = record[field];
  }
  const secretKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(summary), "utf8"), cipher.final()]);
  const envelope = { eventType: "BROWSER_SESSION_DIAGNOSTICS_ENCRYPTED", version: 1,
    wrappedKey: publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, secretKey).toString("base64"),
    iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64"),
  };
  secretKey.fill(0);
  emit(JSON.stringify(envelope));
  return envelope;
}

async function verifyScheduled({ readEvents, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  emit = console.log, startTime = now(), timeoutMs = 720000, pollMs = 15000 } = {}) {
  const deadline = now() + timeoutMs;
  const latest = new Map();
  while (true) {
    const events = await readEvents(startTime);
    for (const event of events) {
      if (!Number.isFinite(event.timestamp) || event.timestamp < startTime) continue;
      const records = logRecords({ LogResult: Buffer.from(event.message || "").toString("base64") });
      for (const record of records) {
        if (record.trigger !== "schedule" || !FEEDS.includes(record.subreddit) ||
          !["SCRAPER_JOB_COMPLETED", "SCRAPER_JOB_FAILED"].includes(record.eventType)) continue;
        if (!latest.has(record.subreddit) || event.timestamp >= latest.get(record.subreddit).timestamp) {
          latest.set(record.subreddit, { timestamp: event.timestamp, record });
        }
      }
    }
    const summaries = [];
    for (const subreddit of FEEDS) {
      const terminal = latest.get(subreddit);
      if (!terminal || terminal.record.eventType !== "SCRAPER_JOB_COMPLETED") continue;
      try {
        const result = checkInvocation({ StatusCode: 200, LogResult: Buffer.from(JSON.stringify(terminal.record)).toString("base64") }, { session: true });
        summaries.push({ subreddit, timestamp: terminal.timestamp, ...result });
      } catch { /* A later scheduled run can recover before the deadline. */ }
    }
    if (summaries.length === FEEDS.length) {
      const summary = { eventType: "BROWSER_SCHEDULED_PROBE_COMPLETED", trigger: "schedule", feedCount: FEEDS.length,
        savedCount: summaries.reduce((sum, result) => sum + result.savedCount, 0), feeds: summaries };
      emit(JSON.stringify(summary));
      return summary;
    }
    if (now() >= deadline) {
      const verified = new Set(summaries.map((result) => result.subreddit));
      const pending = FEEDS.filter((subreddit) => !verified.has(subreddit));
      emit(JSON.stringify({ eventType: "BROWSER_SCHEDULED_PROBE_FAILED", verifiedFeedCount: summaries.length,
        pendingFeeds: pending, feeds: summaries }));
      assert.fail(`Scheduled scraper verification timed out; missing usable completions for: ${pending.join(", ")}`);
    }
    await sleep(Math.min(pollMs, deadline - now()));
  }
}

function readScheduledEvents(startTime) {
  const events = [];
  let nextToken;
  for (let page = 0; page < 20; page += 1) {
    const result = JSON.parse(execFileSync("aws", ["logs", "filter-log-events", "--log-group-name", "/aws/lambda/scraper-dev-fetchPosts-browser",
      "--start-time", String(startTime), "--end-time", String(Date.now()), "--filter-pattern", "?SCRAPER_JOB_COMPLETED ?SCRAPER_JOB_FAILED", "--limit", "1000", "--no-paginate", "--cli-read-timeout", "20",
      ...(nextToken ? ["--next-token", nextToken] : [])],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, AWS_MAX_ATTEMPTS: "1" } }));
    events.push(...(result.events || []));
    if (!result.nextToken || result.nextToken === nextToken) return events;
    nextToken = result.nextToken;
  }
  assert.fail("Scheduled scraper log lookup exceeded its bounded page limit");
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
  const verification = process.env.F5_PROBE_DIAGNOSTICS === "true"
    ? verifySessionDiagnostics({ invoke: invokeLive, publicKey: process.env.F5_PROBE_DIAGNOSTICS_KEY })
    : process.env.F5_PROBE_SCHEDULED === "true"
    ? verifyScheduled({ readEvents: readScheduledEvents })
    : verifyFeeds({ allFeeds: process.env.F5_PROBE_ALL_FEEDS === "true", subreddit: process.env.F5_PROBE_SUBREDDIT || "politics",
      session: process.env.F5_PROBE_SESSION !== "false", authenticate: process.env.F5_PROBE_AUTHENTICATE === "true",
      renewSession: process.env.F5_PROBE_RENEW_SESSION === "true", invoke: invokeLive,
    });
  verification.catch((error) => {
    console.error(error instanceof assert.AssertionError ? error.message : "Unable to verify the browser scraper invocation");
    process.exitCode = 1;
  });
}

module.exports = { checkInvocation, failureSummary, verifyFeeds, verifyScheduled, verifySessionDiagnostics, FEEDS };
