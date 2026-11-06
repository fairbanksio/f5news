const { spawn } = require("node:child_process");
const path = require("node:path");
const { readFileSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const { errorFields } = require("./telemetry");
const feeds = require("../posts/subreddits.json");
const { createSessionRunner } = require("./browser-session");

const root = path.resolve(__dirname, "../..");
const load = (file) => import(pathToFileURL(path.join(root, "scripts/reddit-stagehand", file)).href);

// Supervise the browser group and track its detached display separately.
const runBrowser = ({ subreddit, limit, timeoutMs, logger, authenticate = false, sessionInput, sessionOutput, redactionValues = [process.env.MONGO_CONNECTION_STRING, process.env.REDDIT_USERNAME, process.env.REDDIT_PASSWORD], spawnImpl = spawn }) => new Promise((resolve, reject) => {
  const child = spawnImpl("python", [path.join(root, "scripts/reddit-invisible/smoke.py"), "--subreddit", subreddit, "--limit", String(limit), ...(authenticate ? ["--authenticate"] : []), ...(sessionInput ? ["--session-input", sessionInput] : []), ...(sessionOutput ? ["--session-output", sessionOutput] : [])], {
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
    if (code !== 0 || result.status !== "accessible") return reject(new Error(`Browser extraction failed: ${["blocked", "empty", "loading_timeout", "challenge_required", "auth_credentials_missing", "auth_blocked", "auth_challenge", "auth_failed", "auth_login_unavailable", "auth_unverified", "auth_feed_timeout", "session_invalid", "session_blocked", "session_challenge"].includes(result.status) ? result.status : "runtime_error"}`));
    resolve(result);
  });
});

const createBrowserSource = ({ runBrowserImpl = runBrowser, fetchImpl = globalThis.fetch, sessionRunner = createSessionRunner() } = {}) => async ({ subreddit, limit = 25, timeoutMs = 90_000, logger = console, authenticate = false, session = false, renewSession = false }) => {
  const canonical = feeds.find((name) => name.toLowerCase() === String(subreddit).toLowerCase());
  if (!canonical) throw new Error("Unsupported subreddit");
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("Browser limit must be between 1 and 25");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) throw new Error("Insufficient time for browser extraction and cleanup");
  const browserOptions = { subreddit: canonical, limit, timeoutMs: timeoutMs - 9_000, logger, authenticate: authenticate === true, renewSession: renewSession === true };
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
  }
  return children;
};

module.exports = { createBrowserSource, runBrowser, scrapePosts: createBrowserSource() };
