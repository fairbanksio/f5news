const { spawn } = require("node:child_process");
const path = require("node:path");
const { readFileSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const { errorFields } = require("./telemetry");
const feeds = require("../posts/subreddits.json");
const { createSessionRunner } = require("./browser-session");

const root = path.resolve(__dirname, "../..");
const load = (file) => import(pathToFileURL(path.join(root, "scripts/reddit-stagehand", file)).href);
const FAILURE_STATUSES = ["blocked", "empty", "loading_timeout", "challenge_required", "auth_credentials_missing", "auth_blocked", "auth_challenge", "auth_failed", "auth_login_unavailable", "auth_unverified", "auth_feed_timeout", "session_invalid", "session_blocked", "session_challenge", "network_error", "runtime_error"];
const SESSION_REASONS = ["invalid_data", "input_file_invalid", "root_cookie_expired", "root_cookie_missing", "restore_exception", "feed_cookie_missing", "feed_timeout", "feed_blocked", "feed_challenge", "navigation_network_error", "navigation_http_rejected", "navigation_rate_limited"];
const validPriorities = (ids) => Array.isArray(ids) && ids.length <= 25 && new Set(ids).size === ids.length && ids.every((id) => typeof id === "string" && /^t3_[a-z0-9]+$/.test(id));

// Supervise the browser group and track its detached display separately.
const runBrowser = ({ subreddit, allFeeds = false, imagePriorityIdsBySubreddit, limit, timeoutMs, logger, authenticate = false, sessionInput, sessionOutput, imagePriorityIds, redactionValues = [process.env.MONGO_CONNECTION_STRING, process.env.REDDIT_USERNAME, process.env.REDDIT_PASSWORD], spawnImpl = spawn }) => new Promise((resolve, reject) => {
  const child = spawnImpl("python", [path.join(root, "scripts/reddit-invisible/smoke.py"), ...(allFeeds ? ["--all-feeds", "--batch-budget-seconds", String(Math.max(1, Math.min(180, Math.floor(timeoutMs / 1000) - 10)))] : ["--subreddit", subreddit]), "--limit", String(limit), ...(authenticate ? ["--authenticate"] : []), ...(sessionInput ? ["--session-input", sessionInput] : []), ...(sessionOutput ? ["--session-output", sessionOutput] : []), ...(Array.isArray(imagePriorityIds) ? ["--image-priority-ids", imagePriorityIds.join(",")] : []), ...(imagePriorityIdsBySubreddit !== undefined ? ["--image-priority-map", JSON.stringify(imagePriorityIdsBySubreddit)] : [])], {
    detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let diagnostics = "";
  let droppingDiagnostic = false;
  let failure;
  const displays = new Map();
  const stopDisplays = () => {
    for (const [pid, startTime] of displays) {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        const end = stat.lastIndexOf(")");
        const fields = stat.slice(end + 2).split(" ");
        if (stat.slice(stat.indexOf("(") + 1, end) === "Xvfb" && Number(fields[2]) === pid && fields[19] === String(startTime)) process.kill(-pid, "SIGKILL");
      } catch { /* The owned display has already exited. */ }
    }
  };
  const stop = (signal) => {
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") child.kill(signal); }
  };
  let forceStop;
  const abort = (message) => {
    if (failure) return;
    failure = new Error(message);
    stop("SIGTERM");
    forceStop = setTimeout(() => { stop("SIGKILL"); stopDisplays(); }, 3_000);
  };
  const timer = setTimeout(() => abort("Browser extraction exceeded its deadline"), timeoutMs);
  const heartbeat = setInterval(() => logger.log(JSON.stringify({ eventType: "BROWSER_PROGRESS", subreddit, stage: "extracting" })), 10_000);
  child.stdout.on("data", (data) => {
    if (Buffer.byteLength(output) + data.length > 4 * 1024 * 1024) return abort("Browser output exceeded its size limit");
    output += data.toString();
  });
  child.stderr.on("data", (data) => {
    diagnostics += data.toString();
    const lines = diagnostics.split("\n");
    diagnostics = lines.pop();
    for (const line of lines) {
      if (droppingDiagnostic || line.length > 4096) {
        droppingDiagnostic = false;
        logger.log(JSON.stringify({ eventType: "BROWSER_PROGRESS", subreddit, message: "Browser diagnostic line exceeded its size limit" }));
        continue;
      }
      try {
        const event = JSON.parse(line);
        if (event.eventType === "BROWSER_OWNED_DISPLAY" && Number.isSafeInteger(event.pid) && event.pid > 1 && event.pgid === event.pid && /^\d+$/.test(String(event.startTime))) displays.set(event.pid, event.startTime);
        if (event.eventType === "BROWSER_DISPLAY_STOPPED" && displays.get(event.pid) === event.startTime) displays.delete(event.pid);
      } catch { /* Normal browser progress is plain text. */ }
      const { errorMessage: message } = errorFields({ message: line }, redactionValues);
      logger.log(JSON.stringify({ eventType: "BROWSER_PROGRESS", subreddit, message }));
    }
    if (droppingDiagnostic || diagnostics.length > 4096) {
      diagnostics = "";
      droppingDiagnostic = true;
    }
  });
  child.once("error", (error) => { failure = error; });
  child.once("close", (code, signal) => {
    clearTimeout(timer);
    clearTimeout(forceStop);
    clearInterval(heartbeat);
    stop("SIGKILL");
    stopDisplays();
    if (failure) return reject(failure);
    let result;
    try { result = JSON.parse(output); } catch { return reject(new Error(code === 0 ? "Browser returned invalid extraction output" : `Browser process failed (${signal || code})`)); }
    if (code !== 0 || result.status !== "accessible") {
      const error = new Error(`Browser extraction failed: ${FAILURE_STATUSES.includes(result.status) ? result.status : "runtime_error"}`);
      if (SESSION_REASONS.includes(result.sessionReason)) error.sessionReason = result.sessionReason;
      if (["navigation_http_rejected", "navigation_rate_limited"].includes(error.sessionReason)) {
        if ([401, 403, 429].includes(result.httpStatus)) error.httpStatus = result.httpStatus;
        if (Number.isInteger(result.retryAfterSeconds) && result.retryAfterSeconds >= 0 && result.retryAfterSeconds <= 86400) error.retryAfterSeconds = result.retryAfterSeconds;
      }
      return reject(error);
    }
    resolve(result);
  });
});

const createBrowserSource = ({ runBrowserImpl = runBrowser, fetchImpl = globalThis.fetch, sessionRunner = createSessionRunner() } = {}) => async ({ subreddit, limit = 25, timeoutMs = 90_000, logger = console, authenticate = false, session = false, renewSession = false, imagePriorityIds }) => {
  const canonical = feeds.find((name) => name.toLowerCase() === String(subreddit).toLowerCase());
  if (!canonical) throw new Error("Unsupported subreddit");
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("Browser limit must be between 1 and 25");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) throw new Error("Insufficient time for browser extraction and cleanup");
  if (imagePriorityIds !== undefined && !validPriorities(imagePriorityIds)) throw new Error("Invalid image priority list");
  const browserOptions = { subreddit: canonical, limit, timeoutMs: timeoutMs - 9_000, logger, authenticate: authenticate === true, renewSession: renewSession === true, imagePriorityIds };
  const result = session ? await sessionRunner(browserOptions, runBrowserImpl) : await runBrowserImpl(browserOptions);
  if (result.subreddit !== canonical || !Array.isArray(result.posts) || !result.posts.length || result.posts.length > limit) throw new Error("Browser returned an invalid post batch");
  const [{ toF5Record }, { resolveVideoManifest }] = await Promise.all([load("f5-record.js"), load("f5-dom.js")]);
  const records = await Promise.all(result.posts.map(async (raw) => {
    if (raw.video) raw.video = await resolveVideoManifest(raw.video, fetchImpl);
    return toF5Record(raw, canonical);
  }));
  if (records.some((record) => !record.ready)) throw new Error(`Browser returned incomplete posts: ${[...new Set(records.flatMap((record) => record.ready ? [] : record.missingFields))].join(", ")}`);
  const children = records.map((record) => record.reddit);
  if (new Set(children.map(({ data }) => data.id)).size !== children.length) throw new Error("Browser returned duplicate posts");
  logger.log(JSON.stringify({ eventType: "BROWSER_EXTRACTED", subreddit: canonical, count: children.length }));
  if (result.sessionMode) {
    children.sessionMode = result.sessionMode;
    children.sessionGeneration = result.sessionGeneration;
    if (result.sessionRenewalDeferred === true) children.sessionRenewalDeferred = true;
  }
  return children;
};

const createBrowserBatchSource = ({ runBrowserImpl = runBrowser, fetchImpl = globalThis.fetch, sessionRunner = createSessionRunner(), now = Date.now } = {}) => async ({ subreddits = feeds, limit = 25, timeoutMs = 160_000, logger = console, authenticate = false, session = true, renewSession = false, imagePriorityIdsBySubreddit } = {}) => {
  const deadline = now() + timeoutMs;
  if (!Array.isArray(subreddits) || subreddits.length !== feeds.length || subreddits.some((name, index) => name !== feeds[index])) throw new Error("Browser batch requires every configured feed in order");
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("Browser limit must be between 1 and 25");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) throw new Error("Insufficient time for browser extraction and cleanup");
  if (imagePriorityIdsBySubreddit !== undefined && (!imagePriorityIdsBySubreddit || typeof imagePriorityIdsBySubreddit !== "object" || Array.isArray(imagePriorityIdsBySubreddit) || Object.entries(imagePriorityIdsBySubreddit).some(([name, ids]) => !feeds.includes(name) || !validPriorities(ids)))) throw new Error("Invalid batch image priority map");
  const browserOptions = { subreddit: feeds[0], allFeeds: true, limit, timeoutMs: timeoutMs - 9_000, logger,
    authenticate: authenticate === true, renewSession: renewSession === true, imagePriorityIdsBySubreddit };
  const result = session ? await sessionRunner(browserOptions, runBrowserImpl) : await runBrowserImpl(browserOptions);
  if (result?.status !== "accessible" || !Array.isArray(result.feeds) || !result.feeds.length || result.feeds.length > feeds.length ||
      result.feeds.some((entry, index) => !entry || entry.subreddit !== feeds[index] || !Array.isArray(entry.posts) || !entry.posts.length || entry.posts.length > limit)) throw new Error("Browser returned an invalid feed batch");
  let batchFailure;
  if (result.batchFailure !== undefined) {
    const failure = result.batchFailure;
    const optionalPreview = failure?.stage === "optional_preview" && failure.subreddit === feeds[result.feeds.length - 1] &&
      ["network_error", "session_invalid"].includes(failure.status) && failure.sessionReason === "navigation_rate_limited" && failure.httpStatus === 429;
    const nextFeed = (failure?.stage === undefined || failure.stage === "feed") && result.feeds.length < feeds.length && failure?.subreddit === feeds[result.feeds.length];
    if (!failure || typeof failure !== "object" || (!optionalPreview && !nextFeed) || !FAILURE_STATUSES.includes(failure.status)) throw new Error("Browser returned an invalid batch failure");
    batchFailure = { subreddit: failure.subreddit, status: failure.status, ...(failure.stage ? { stage: failure.stage } : {}) };
    if (SESSION_REASONS.includes(failure.sessionReason)) batchFailure.sessionReason = failure.sessionReason;
    if ([401, 403, 429].includes(failure.httpStatus)) batchFailure.httpStatus = failure.httpStatus;
    if (Number.isInteger(failure.retryAfterSeconds) && failure.retryAfterSeconds >= 0 && failure.retryAfterSeconds <= 86400) batchFailure.retryAfterSeconds = failure.retryAfterSeconds;
  } else if (result.feeds.length !== feeds.length) throw new Error("Browser returned an incomplete feed batch without a failure");
  const boundedFetch = (url, options = {}) => {
    const remaining = Math.floor(deadline - now() - 9_000);
    if (remaining <= 0) throw new Error("Batch media mapping exceeded its deadline");
    const deadlineSignal = AbortSignal.timeout(remaining);
    return fetchImpl(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, deadlineSignal]) : deadlineSignal });
  };
  const outcomes = new Array(result.feeds.length);
  const mapFeed = createBrowserSource({ runBrowserImpl: async (request) => result.feeds.find((entry) => entry.subreddit === request.subreddit), fetchImpl: boundedFetch });
  let next = 0;
  const worker = async () => {
    while (next < result.feeds.length) {
      const index = next++;
      const entry = result.feeds[index];
      try { outcomes[index] = { subreddit: entry.subreddit, children: await mapFeed({ subreddit: entry.subreddit, limit, timeoutMs, logger }) }; }
      catch {
        outcomes[index] = { subreddit: entry.subreddit, status: "metadata_invalid" };
        logger.log(JSON.stringify({ eventType: "BROWSER_BATCH_FEED_FAILED", subreddit: entry.subreddit, status: "metadata_invalid" }));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, result.feeds.length) }, worker));
  const mapped = outcomes.filter((entry) => entry.children);
  const failures = outcomes.filter((entry) => !entry.children);
  const metadata = {};
  if (result.sessionMode !== undefined) {
    if (!["reused", "renewed"].includes(result.sessionMode) || typeof result.sessionGeneration !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result.sessionGeneration)) throw new Error("Browser returned invalid session metadata");
    metadata.sessionMode = result.sessionMode;
    metadata.sessionGeneration = result.sessionGeneration;
    if (result.sessionRenewalDeferred === true) metadata.sessionRenewalDeferred = true;
  }
  return { feeds: mapped, failures, ...(batchFailure ? { batchFailure } : {}), ...metadata, ...(result.readBackoffFailed === true ? { readBackoffFailed: true } : {}) };
};

module.exports = { createBrowserSource, createBrowserBatchSource, runBrowser, scrapePosts: createBrowserSource(), scrapeBatch: createBrowserBatchSource() };
