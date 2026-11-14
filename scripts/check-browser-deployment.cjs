const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");
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

const FEEDS = require("../services/posts/subreddits.json");

function checkBatchInvocation(metadata) {
  assert.ok(!metadata.FunctionError, "Browser scraper batch invocation failed; inspect its CloudWatch logs");
  assert.equal(metadata.StatusCode, 200, "Lambda batch invocation did not succeed");
  const payload = metadata.BatchResult;
  assert.ok(payload && typeof payload === "object" && !Array.isArray(payload), "Browser scraper did not return a batch result");
  assert.ok(Array.isArray(payload.feedResults) && payload.feedResults.length === FEEDS.length, "Browser scraper batch did not return every configured feed");
  assert.ok(["reused", "renewed"].includes(payload.sessionMode), "Browser scraper batch did not report session reuse or renewal");
  assert.match(payload.sessionGeneration || "", /^[A-Za-z0-9_-]{1,128}$/, "Browser scraper batch did not report a safe session generation");
  const feeds = new Map();
  for (const record of payload.feedResults) {
    assert.ok(record && FEEDS.includes(record.subreddit) && !feeds.has(record.subreddit), "Browser scraper batch returned an unexpected or duplicate feed");
    const result = checkInvocation({ StatusCode: 200, LogResult: Buffer.from(JSON.stringify({ eventType: "SCRAPER_JOB_COMPLETED", outcome: record.outcome, fetchedCount: record.fetchedCount, savedCount: record.savedCount, sessionMode: record.sessionMode, sessionGeneration: record.sessionGeneration })).toString("base64") }, { session: true });
    assert.equal(result.sessionGeneration, payload.sessionGeneration, "Browser scraper batch changed session generation between feeds");
    assert.equal(result.sessionMode, payload.sessionMode, "Browser scraper batch changed session mode between feeds");
    feeds.set(record.subreddit, { subreddit: record.subreddit, ...result });
  }
  return { feedResults: FEEDS.map((feed) => feeds.get(feed)), sessionMode: payload.sessionMode, sessionGeneration: payload.sessionGeneration };
}

async function verifyFeeds({ allFeeds = false, subreddit = "politics", session = true, authenticate = false, renewSession = false, invoke, emit = console.log,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  assert.ok(FEEDS.includes(subreddit), "Select a configured subreddit for browser verification");
  assert.ok(!(allFeeds && authenticate), "All-feed verification uses one shared session; authenticate is only available for a single bootstrap");
  assert.ok(!allFeeds || session, "All-feed verification requires session reuse");
  assert.ok(!renewSession || (session && !authenticate), "Session renewal requires shared-session verification without bootstrap authentication");
  const results = [];
  const invocations = [];
  const addResult = (subreddit, result, repeated = false) => {
    const entry = { eventType: "BROWSER_LIVE_PROBE", subreddit, repeated, ...result };
    results.push(entry);
    emit(JSON.stringify(entry));
  };
  if (allFeeds) {
    const batch = checkBatchInvocation(await invoke({ allFeeds: true, session: true, ...(renewSession ? { renewSession: true } : {}) }));
    if (renewSession) assert.equal(batch.sessionMode, "renewed", "Requested session renewal did not create a renewed session");
    invocations.push(batch);
    for (const { subreddit, ...result } of batch.feedResults) addResult(subreddit, result);
    emit(JSON.stringify({ eventType: "BROWSER_LIVE_PROBE_WAITING", seconds: 300 }));
    await sleep(300000);
    const repeated = checkInvocation(await invoke({ subreddit: "politics", session: true }), { session: true });
    assert.equal(repeated.sessionMode, "reused", "Repeated politics invocation did not reuse the shared session");
    assert.equal(repeated.sessionGeneration, batch.sessionGeneration, "Repeated politics invocation changed the shared session generation");
    invocations.push(repeated);
    addResult("politics", repeated, true);
  } else {
    const result = checkInvocation(await invoke({ subreddit,
      ...(authenticate ? { authenticate: true, session: false } : { session }),
      ...(renewSession ? { renewSession: true } : {}),
    }), { session: session && !authenticate });
    if (renewSession) assert.equal(result.sessionMode, "renewed", "Requested session renewal did not create a renewed session");
    invocations.push(result);
    addResult(subreddit, result);
  }
  const summary = { eventType: "BROWSER_LIVE_PROBE_COMPLETED", feedCount: allFeeds ? FEEDS.length : 1,
    invocationCount: invocations.length, savedCount: results.reduce((sum, result) => sum + result.savedCount, 0),
    renewalRequested: renewSession,
    ...(session && !authenticate ? { initialGeneration: invocations[0].sessionGeneration,
      sessionGeneration: invocations.at(-1).sessionGeneration,
      generationCount: new Set(invocations.map((result) => result.sessionGeneration)).size,
      renewedCount: invocations.filter((result) => result.sessionMode === "renewed").length,
      reusedCount: invocations.filter((result) => result.sessionMode === "reused").length } : {}),
  };
  emit(JSON.stringify(summary));
  return { results, summary };
}

function summarizeRuntimeEvents(events) {
  assert.ok(Array.isArray(events) && events.length <= 20000, "Runtime diagnostics exceeded its event limit");
  const summary = { reportCount: 0, maxMemoryUsedMB: 0, memorySizeMB: 0, resourceSampleCount: 0,
    memoryPeakBytes: 0, memoryLimitBytes: 0, pidsPeak: 0, pidsLimit: 0, memoryEventsSampleCount: 0, pidsEventsSampleCount: 0,
    memoryOomCount: 0, memoryOomKillCount: 0, memoryMaxCount: 0, pidsMaxCount: 0, networkFailureCount: 0,
    navigationHttpStatusCounts: {}, navigationMaxRetryAfterSeconds: 0, navigationChallengeCount: 0 };
  const reasons = ["invalid_data", "input_file_invalid", "root_cookie_expired", "root_cookie_missing", "restore_exception",
    "navigation_network_error", "navigation_http_rejected", "navigation_rate_limited", "feed_cookie_missing", "feed_timeout", "feed_blocked", "feed_challenge"];
  summary.latestPageAccess = null;
  summary.sessionReasonCounts = Object.fromEntries(reasons.map((reason) => [reason, 0]));
  const imageReasons = ["unsafe_url", "request_timeout", "empty_response", "redirect_missing_location", "http_status",
    "non_html_response", "body_read_error", "body_read_timeout", "empty_html", "no_meta_image", "fetch_error", "too_many_redirects"];
  const imageEventTypes = ["POST_IMAGE_RESOLUTION_ERROR", "POST_IMAGE_RESOLUTION_MISSING", "POST_IMAGE_RESOLUTION_DEGRADED", "POST_IMAGE_BACKFILL_ERROR", "POST_IMAGE_BACKFILL_MISSING", "POST_IMAGE_BACKFILL_DEGRADED", "POST_IMAGE_UPDATE_ERROR"];
  const imageCounters = ["imageAttempts", "imageResolved", "imageMissing", "imageErrors", "imageDependencyFailures", "imageUpdateErrors", "backfillQueryErrors"];
  const emptyReasons = () => Object.fromEntries(imageReasons.map((reason) => [reason, 0]));
  summary.imageDiagnostics = {
    failureReasonCounts: emptyReasons(), failureHttpStatusCounts: {},
    feeds: FEEDS.map((subreddit) => ({ subreddit, completedCount: 0, failedCount: 0, degradedCount: 0,
      ...Object.fromEntries(imageCounters.map((field) => [field, 0])), optionalImagesDeferredCount: 0, sessionRenewalDeferredCount: 0,
      failureEventCounts: Object.fromEntries(imageEventTypes.map((field) => [field, 0])),
      failureReasonCounts: emptyReasons(), failureHttpStatusCounts: {}, latestTerminal: null })),
  };
  const add = (target, field, value) => {
    if (Number.isSafeInteger(value) && value >= 0) target[field] = Math.min(Number.MAX_SAFE_INTEGER, (target[field] || 0) + value);
  };
  const number = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : undefined;
  const maximum = (field, value) => { const valid = number(value); if (valid !== undefined) summary[field] = Math.max(summary[field], valid); };
  const counter = (value) => typeof value === "string" && /^\d+$/.test(value) ? number(Number(value)) : number(value);
  for (const event of events) {
    const message = typeof event?.message === "string" ? event.message.slice(0, 65536) : "";
    const report = message.match(/\bREPORT\s+RequestId:[^\n]*?Memory Size:\s*(\d+)\s*MB\s+Max Memory Used:\s*(\d+)\s*MB/);
    if (report) { summary.reportCount += 1; maximum("memorySizeMB", Number(report[1])); maximum("maxMemoryUsedMB", Number(report[2])); }
    const records = logRecords({ LogResult: Buffer.from(message).toString("base64") });
    for (let record of records) {
      const imageFeed = summary.imageDiagnostics.feeds.find((feed) => feed.subreddit === record.subreddit);
      if (imageFeed && record.eventType === "PUBLISHER_IMAGE_BACKFILL_COMPLETED" && record.trigger === "schedule" &&
          Number.isSafeInteger(event.timestamp) && event.timestamp >= 0 &&
          (!imageFeed.latestScheduledCoverRepair || event.timestamp >= imageFeed.latestScheduledCoverRepair.timestamp)) {
        const repair = { timestamp: event.timestamp, deferred: record.deferred === true };
        for (const field of ["candidates", "attempts", "updated", "errors"]) add(repair, field, record[field]);
        imageFeed.latestScheduledCoverRepair = repair;
      }
      if (imageFeed && ["SCRAPER_JOB_COMPLETED", "SCRAPER_JOB_FAILED"].includes(record.eventType)) {
        add(imageFeed, record.eventType === "SCRAPER_JOB_COMPLETED" ? "completedCount" : "failedCount", 1);
        if (record.outcome === "degraded") add(imageFeed, "degradedCount", 1);
        for (const field of imageCounters) add(imageFeed, field, record[field]);
        if (record.optionalImagesDeferred === true) add(imageFeed, "optionalImagesDeferredCount", 1);
        if (record.sessionRenewalDeferred === true) add(imageFeed, "sessionRenewalDeferredCount", 1);
        if (Number.isSafeInteger(event.timestamp) && event.timestamp >= 0 && event.timestamp <= 8640000000000000 &&
            (!imageFeed.latestTerminal || event.timestamp >= imageFeed.latestTerminal.timestamp)) {
          imageFeed.latestTerminal = { timestamp: event.timestamp,
            outcome: ["success", "degraded", "failed"].includes(record.outcome) ? record.outcome : "unknown",
            optionalImagesDeferred: record.optionalImagesDeferred === true, sessionRenewalDeferred: record.sessionRenewalDeferred === true };
          for (const field of imageCounters) {
            if (Number.isSafeInteger(record[field]) && record[field] >= 0) imageFeed.latestTerminal[field] = record[field];
          }
        }
      }
      if (imageFeed && imageEventTypes.includes(record.eventType)) {
        add(imageFeed.failureEventCounts, record.eventType, 1);
        for (const failure of Array.isArray(record.imageResolutionFailures) ? record.imageResolutionFailures.slice(0, 3) : []) {
          if (!failure || typeof failure !== "object" || Array.isArray(failure)) continue;
          if (imageReasons.includes(failure.reason)) {
            add(imageFeed.failureReasonCounts, failure.reason, 1);
            add(summary.imageDiagnostics.failureReasonCounts, failure.reason, 1);
          }
          if (Number.isInteger(failure.status) && failure.status >= 100 && failure.status <= 599) {
            add(imageFeed.failureHttpStatusCounts, failure.status, 1);
            add(summary.imageDiagnostics.failureHttpStatusCounts, failure.status, 1);
          }
        }
      }
      if (record.eventType === "BROWSER_PROGRESS" && typeof record.message === "string" && record.message.length <= 65536 && record.message.startsWith("{")) {
        try {
          const navigation = JSON.parse(record.message);
          if (["BROWSER_NAVIGATION_HTTP", "BROWSER_PAGE_ACCESS"].includes(navigation?.eventType)) record = navigation;
        } catch { /* Ignore malformed nested browser diagnostics. */ }
      }
      if (record.eventType === "BROWSER_PAGE_ACCESS" &&
          ["challenge", "blocked"].includes(record.state) &&
          ["prove_humanity", "verify_human", "complete_challenge", "network_security", "blocked_text"].includes(record.marker) &&
          ["hasPosts", "titleMatch", "dialogVisible", "verificationFrame"].every((key) => typeof record[key] === "boolean") &&
          Number.isSafeInteger(event.timestamp) && event.timestamp >= (summary.latestPageAccess?.timestamp ?? 0)) {
        const { state, marker, hasPosts, titleMatch, dialogVisible, verificationFrame } = record;
        const evidence = { timestamp: event.timestamp, state, marker, hasPosts, titleMatch, dialogVisible, verificationFrame };
        if (["verification", "dialog", "navigation", "footer", "link", "heading", "main", "title", "other"].includes(record.matchedRegion)) {
          evidence.matchedRegion = record.matchedRegion;
        }
        if (typeof record.verificationControl === "boolean") evidence.verificationControl = record.verificationControl;
        summary.latestPageAccess = evidence;
      }
      if (record.eventType === "BROWSER_NAVIGATION_HTTP" && Number.isInteger(record.status) && record.status >= 400 && record.status <= 599) {
        summary.navigationHttpStatusCounts[record.status] = (summary.navigationHttpStatusCounts[record.status] || 0) + 1;
        if (Number.isInteger(record.retryAfterSeconds) && record.retryAfterSeconds >= 0 && record.retryAfterSeconds <= 86400) {
          maximum("navigationMaxRetryAfterSeconds", record.retryAfterSeconds);
        }
        if (record.challenge === true) summary.navigationChallengeCount += 1;
      }
      if (record.type === "platform.report" && record.record?.metrics) {
        summary.reportCount += 1;
        maximum("maxMemoryUsedMB", record.record.metrics.maxMemoryUsedMB);
        maximum("memorySizeMB", record.record.metrics.memorySizeMB);
      }
      const reason = reasons.includes(record.sessionReason) ? record.sessionReason : record.eventType === "SCRAPER_JOB_FAILED"
        ? reasons.find((item) => String(record.errorMessage || "").includes(item)) : undefined;
      if (reason) {
        summary.sessionReasonCounts[reason] += 1;
        if (reason === "navigation_network_error") summary.networkFailureCount += 1;
      }
      if (record.eventType !== "BROWSER_PROGRESS" || typeof record.message !== "string" || !record.message.startsWith("Resource counters: ")) continue;
      let resources;
      try { resources = JSON.parse(record.message.slice("Resource counters: ".length)); } catch { continue; }
      if (!resources || typeof resources !== "object" || Array.isArray(resources)) continue;
      summary.resourceSampleCount += 1;
      for (const [source, target] of [["memory.peak", "memoryPeakBytes"], ["memory.max", "memoryLimitBytes"], ["pids.peak", "pidsPeak"], ["pids.max", "pidsLimit"]]) {
        maximum(target, counter(resources[source]));
      }
      for (const [source, mappings] of [["memory.events", { oom: "memoryOomCount", oom_kill: "memoryOomKillCount", max: "memoryMaxCount" }], ["pids.events", { max: "pidsMaxCount" }]]) {
        if (typeof resources[source] !== "string") continue;
        summary[source === "memory.events" ? "memoryEventsSampleCount" : "pidsEventsSampleCount"] += 1;
        for (const line of resources[source].split("\n")) {
          const match = line.match(/^(\w+)\s+(\d+)$/);
          if (match && Object.hasOwn(mappings, match[1])) maximum(mappings[match[1]], Number(match[2]));
        }
      }
    }
  }
  return summary;
}

async function verifySessionDiagnostics({ invoke, publicKey, readRuntimeEvents, emit = console.log } = {}) {
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
  if (Object.hasOwn(record, "readBackoffSeconds")) {
    assert.ok(Number.isInteger(record.readBackoffSeconds) && record.readBackoffSeconds >= 0 && record.readBackoffSeconds <= 86400, "Session diagnostics reported invalid read backoff seconds");
    summary.readBackoffSeconds = record.readBackoffSeconds;
  }
  if (readRuntimeEvents) summary.runtimeDiagnostics = summarizeRuntimeEvents(await readRuntimeEvents());
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

async function verifyScheduled({ readEvents, requireOneNavigation = false, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  emit = console.log, startTime = now(), timeoutMs = 35 * 60 * 1000, pollMs = 15000 } = {}) {
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
        const { risingNavigations } = terminal.record;
        if (requireOneNavigation || risingNavigations !== undefined) assert.equal(risingNavigations, 1, "Expected one Rising navigation");
        summaries.push({ subreddit, timestamp: terminal.timestamp, ...result,
          ...(risingNavigations === 1 ? { risingNavigations } : {}) });
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

function readLogEvents(startTime, filterPattern) {
  const events = [];
  let nextToken;
  const deadline = Date.now() + 120000;
  for (let page = 0; page < 20; page += 1) {
    assert.ok(Date.now() < deadline, "Scraper log lookup exceeded its time limit");
    const result = JSON.parse(execFileSync("aws", ["logs", "filter-log-events", "--log-group-name", "/aws/lambda/scraper-dev-fetchPosts-browser",
      "--start-time", String(startTime), "--end-time", String(Date.now()),
      ...(filterPattern ? ["--filter-pattern", filterPattern] : []), "--limit", "1000", "--no-paginate", "--cli-read-timeout", "20",
      ...(nextToken ? ["--next-token", nextToken] : [])],
    { encoding: "utf8", timeout: 25000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, AWS_MAX_ATTEMPTS: "1" } }));
    events.push(...(result.events || []));
    if (!result.nextToken || result.nextToken === nextToken) return events;
    nextToken = result.nextToken;
  }
  assert.fail("Scraper log lookup exceeded its bounded page limit");
}

function readScheduledEvents(startTime) {
  return readLogEvents(startTime, "?SCRAPER_JOB_COMPLETED ?SCRAPER_JOB_FAILED");
}

function readRuntimeEvents() {
  return readLogEvents(Date.now() - 3600000, '?REPORT ?"platform.report" ?"Resource counters:" ?SCRAPER_JOB_FAILED ?SCRAPER_JOB_COMPLETED ?BROWSER_NAVIGATION_HTTP ?BROWSER_PAGE_ACCESS ?POST_IMAGE_RESOLUTION_ERROR ?POST_IMAGE_RESOLUTION_MISSING ?POST_IMAGE_RESOLUTION_DEGRADED ?POST_IMAGE_BACKFILL_ERROR ?POST_IMAGE_BACKFILL_MISSING ?POST_IMAGE_BACKFILL_DEGRADED ?POST_IMAGE_UPDATE_ERROR ?PUBLISHER_IMAGE_BACKFILL_COMPLETED');
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
  if (!result.FunctionError && (event.allFeeds || event.publisherImageBackfill || event.challengeScreenshotPublicKey)) {
    const payload = JSON.parse(readFileSync(payloadFile, "utf8"));
    if (event.challengeScreenshotPublicKey) result.ChallengeScreenshotResult = payload;
    else if (event.publisherImageBackfill) result.PublisherBackfillResult = payload;
    else result.BatchResult = payload;
  }
  return result;
}

function selectVerificationMode(env, configuration) {
  if (env.F5_PROBE_DIAGNOSTICS === "true") return "diagnostics";
  if (env.F5_PROBE_DEPLOYMENT === "true") {
    assert.ok(configuration?.functions && typeof configuration.functions === "object" && !Array.isArray(configuration.functions), "Deployment verification requires valid service configuration");
    return Object.values(configuration.functions).some((fn) => Array.isArray(fn?.events) && fn.events.some((event) => event?.schedule?.enabled === true)) ? "scheduled" : "batch";
  }
  return env.F5_PROBE_SCHEDULED === "true" ? "scheduled" : "manual";
}

async function runVerification({ env = process.env, configuration, invoke = invokeLive, readEvents = readScheduledEvents,
  readRuntime = readRuntimeEvents, emit = console.log, sleep } = {}) {
  if (env.F5_PROBE_CHALLENGE_SCREENSHOT === "true") {
    for (const name of ["DIAGNOSTICS", "SCHEDULED", "DEPLOYMENT", "ALL_FEEDS", "AUTHENTICATE", "RENEW_SESSION", "PUBLISHER_IMAGE_BACKFILL"]) {
      assert.notEqual(env[`F5_PROBE_${name}`], "true", "Screenshot must be requested on its own");
    }
    const key = env.F5_PROBE_DIAGNOSTICS_KEY;
    assert.ok(typeof key === "string" && key.length <= 1200 && /^[A-Za-z0-9+/]+={0,2}$/.test(key), "Provide a screenshot public key");
    const response = await invoke({ challengeScreenshotPublicKey: key });
    assert.equal(response.StatusCode, 200);
    assert.ok(!response.FunctionError, "Screenshot invocation failed");
    const result = response.ChallengeScreenshotResult;
    assert.ok(["captured", "not_seen", "cooldown", "challenge", "scrape_failed"].includes(result?.outcome), "Invalid screenshot result");
    const record = { eventType: "BROWSER_CHALLENGE_SCREENSHOT", outcome: result.outcome };
    if (result.outcome === "captured") {
      const { version, contentType, iv, tag, wrappedKey, ciphertext } = result.screenshot || {};
      assert.ok(version === 1 && contentType === "image/jpeg" && typeof ciphertext === "string" && ciphertext.length <= 350000,
        "Invalid encrypted screenshot");
      for (const [field, value, maxLength] of [["iv", iv, 16], ["tag", tag, 24], ["wrappedKey", wrappedKey, 700], ["ciphertext", ciphertext, 350000]]) {
        assert.ok(typeof value === "string" && value.length <= maxLength && /^[A-Za-z0-9+/]+={0,2}$/.test(value),
          "Invalid screenshot " + field);
      }
      record.screenshot = { version, contentType, iv, tag, wrappedKey, ciphertext };
      const chunks = ciphertext.match(/.{1,3000}/g);
      emit(JSON.stringify({ ...record, screenshot: { version, contentType, iv, tag, wrappedKey, chunkCount: chunks.length } }));
      for (const [index, data] of chunks.entries()) emit(JSON.stringify({ eventType: "BROWSER_CHALLENGE_SCREENSHOT_CHUNK", index, data }));
    } else {
      emit(JSON.stringify(record));
    }
    return record;
  }
  const publisherPostId = env.F5_PROBE_PUBLISHER_POST_ID || "";
  const publisherImageUrl = env.F5_PROBE_PUBLISHER_IMAGE_URL || "";
  const targeted = Boolean(publisherPostId || publisherImageUrl);
  if (targeted) {
    assert.equal(env.F5_PROBE_PUBLISHER_IMAGE_BACKFILL, "true", "Enable publisher image backfill to repair a single cover");
    assert.ok(/^[a-z0-9]{1,20}$/.test(publisherPostId) && publisherImageUrl.startsWith("https://") && publisherImageUrl.length <= 2048,
      "Provide a Reddit post ID and a public HTTPS publisher image URL");
  }
  if (env.F5_PROBE_PUBLISHER_IMAGE_BACKFILL === "true") {
    const conflicts = ["DIAGNOSTICS", "DEPLOYMENT", "SCHEDULED", "ALL_FEEDS", "AUTHENTICATE", "RENEW_SESSION"];
    assert.ok(!conflicts.some((mode) => env[`F5_PROBE_${mode}`] === "true"), "Select publisher image backfill by itself");
    const subreddit = env.F5_PROBE_SUBREDDIT || "politics";
    assert.ok(FEEDS.includes(subreddit), "Select a configured subreddit for publisher image backfill");
    const metadata = await invoke({ publisherImageBackfill: true, subreddit, ...(targeted ? { publisherPostId, publisherImageUrl } : {}) });
    assert.ok(metadata.StatusCode === 200 && !metadata.FunctionError, "Publisher image backfill invocation failed");
    const result = metadata.PublisherBackfillResult;
    assert.ok(result?.eventType === "PUBLISHER_IMAGE_BACKFILL_COMPLETED" && result.subreddit === subreddit, "Publisher image backfill result missing");
    if (targeted) assert.equal(result.publisherPostId, publisherPostId, "Targeted publisher image backfill result missing");
    const { candidates, attempts, updated, errors, dependencyFailures, deferred } = result;
    assert.ok([candidates, attempts, updated, errors, dependencyFailures].every((count) => Number.isInteger(count) && count >= 0)
      && candidates <= (targeted ? 1 : 10) && attempts <= candidates && updated <= attempts && typeof deferred === "boolean", "Invalid publisher image backfill counts");
    const summary = { eventType: result.eventType, subreddit, candidates, attempts, updated, errors, dependencyFailures, deferred };
    emit(JSON.stringify(summary));
    assert.equal(errors, 0, "Publisher image backfill reported errors");
    return summary;
  }
  if (env.F5_PROBE_DEPLOYMENT === "true" && env.F5_PROBE_DIAGNOSTICS !== "true" && configuration === undefined) {
    const yaml = require("../services/scraper/node_modules/js-yaml");
    configuration = yaml.load(readFileSync(path.join(__dirname, "../services/scraper/serverless.yml"), "utf8"));
  }
  const mode = selectVerificationMode(env, configuration);
  if (mode === "diagnostics") return verifySessionDiagnostics({ invoke, publicKey: env.F5_PROBE_DIAGNOSTICS_KEY, readRuntimeEvents: readRuntime, emit });
  if (mode === "scheduled") return verifyScheduled({ readEvents, emit, sleep, requireOneNavigation: env.F5_PROBE_DEPLOYMENT === "true" });
  return verifyFeeds({ allFeeds: mode === "batch" || env.F5_PROBE_ALL_FEEDS === "true", subreddit: env.F5_PROBE_SUBREDDIT || "politics",
    session: mode === "batch" || env.F5_PROBE_SESSION !== "false", authenticate: mode !== "batch" && env.F5_PROBE_AUTHENTICATE === "true",
    renewSession: mode !== "batch" && env.F5_PROBE_RENEW_SESSION === "true", invoke, emit, sleep });
}

if (require.main === module) {
  runVerification().catch((error) => {
    console.error(error instanceof assert.AssertionError ? error.message : "Unable to verify the browser scraper invocation");
    process.exitCode = 1;
  });
}

module.exports = { checkInvocation, checkBatchInvocation, failureSummary, verifyFeeds, verifyScheduled, verifySessionDiagnostics, summarizeRuntimeEvents, selectVerificationMode, runVerification, FEEDS };
