const { randomUUID } = require("node:crypto");
const { mkdtemp, writeFile, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

const MAX_BYTES = 1024 * 1024;
const SESSION_ID = "reddit";
const readPauseSeconds = (value) => Number.isInteger(value) && value > 0 ? Math.min(value, 86400) : 600;
const challengeStatuses = ["session_challenge", "auth_challenge", "challenge_required"];
const readPauseFor = (failure) => {
  if (failure?.httpStatus === 429 || failure?.sessionReason === "navigation_rate_limited" ||
      failure?.sessionReason === "feed_challenge" || challengeStatuses.includes(failure?.status) ||
      challengeStatuses.some((status) => failure?.message === `Browser extraction failed: ${status}`)) {
    return readPauseSeconds(failure.retryAfterSeconds);
  }
  return 0;
};
const operationOptions = { maxTimeMS: 5000, timeoutMS: 10000 };
const key = (generation) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(generation)) throw new Error("Invalid session generation");
  return `reddit/sessions/${generation}.json`;
};

function createSessionStore({ bucket = process.env.F5_REDDIT_SESSION_BUCKET, client = new S3Client({ maxAttempts: 2 }), collection } = {}) {
  const metadata = () => collection || require("mongoose").connection.db.collection("scraper_browser_sessions");
  const available = (field) => ({ $lte: [{ $ifNull: [`$${field}`, new Date(0)] }, "$$NOW"] });
  return {
    async current() {
      try {
        const rows = await metadata().aggregate([{ $match: { _id: SESSION_ID } }, { $limit: 1 }, { $set: {
          readBackoffSeconds: { $max: [0, { $ceil: { $divide: [{ $subtract: [{ $ifNull: ["$readBackoffUntil", "$$NOW"] }, "$$NOW"] }, 1000] } }] },
        } }], operationOptions).toArray();
        return rows[0] || null;
      } catch { throw new Error("Session coordination unavailable"); }
    },
    async pauseReads(seconds) {
      try {
        await metadata().updateOne({ _id: SESSION_ID }, [{ $set: { readBackoffUntil: { $max: [
          { $ifNull: ["$readBackoffUntil", "$$NOW"] },
          { $dateAdd: { startDate: "$$NOW", unit: "second", amount: readPauseSeconds(seconds) } },
        ] } } }], { upsert: true, ...operationOptions });
      } catch { throw new Error("Session read backoff coordination unavailable"); }
    },
    async acquire(owner, observedGeneration) {
      try {
        await metadata().updateOne({ _id: SESSION_ID }, { $setOnInsert: { leaseUntil: new Date(0), nextAttemptAt: new Date(0) } }, { upsert: true, ...operationOptions });
        return await metadata().findOneAndUpdate({ _id: SESSION_ID, activeGeneration: observedGeneration || { $exists: false },
          $expr: { $and: [available("leaseUntil"), available("nextAttemptAt"), available("readBackoffUntil")] } }, [{ $set: {
          owner: { $literal: owner }, lastAttemptAt: "$$NOW",
          leaseUntil: { $dateAdd: { startDate: "$$NOW", unit: "second", amount: 300 } },
          nextAttemptAt: { $dateAdd: { startDate: "$$NOW", unit: "second", amount: 900 } },
        } }], { returnDocument: "after", ...operationOptions });
      } catch (error) {
        if (error.code === 11000) return null;
        // eslint-disable-next-line preserve-caught-error -- Provider causes can contain private connection details.
        throw new Error("Session coordination unavailable");
      }
    },
    async read(generation) {
      if (!bucket) throw new Error("Session bucket is not configured");
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key(generation) }), { abortSignal: AbortSignal.timeout(10000) });
        if (result.ContentLength > MAX_BYTES) throw new Error("Session size limit exceeded");
        const bytes = await result.Body.transformToByteArray();
        if (bytes.length > MAX_BYTES) throw new Error("Session size limit exceeded");
        return bytes;
      } catch (error) {
        if (error.name === "NoSuchKey") return null;
        // eslint-disable-next-line preserve-caught-error -- Provider causes can contain private connection details.
        throw new Error("Session storage unavailable");
      }
    },
    async publish(owner, generation, bytes) {
      if (!bucket || bytes.length > MAX_BYTES) throw new Error("Invalid session storage configuration or size");
      try {
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: key(generation), Body: bytes,
          ContentType: "application/json", ServerSideEncryption: "AES256", IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(10000) });
        const published = await metadata().findOneAndUpdate({ _id: SESSION_ID, owner, $expr: { $gt: ["$leaseUntil", "$$NOW"] } }, [{ $set: {
          activeGeneration: { $literal: generation }, sessionCreatedAt: "$$NOW", leaseUntil: "$$NOW",
          nextAttemptAt: { $dateAdd: { startDate: "$$NOW", unit: "second", amount: 300 } },
        } }, { $unset: "owner" }], { returnDocument: "after", ...operationOptions });
        if (!published) throw new Error("Session renewal lease expired");
      } catch { throw new Error("Unable to publish renewed session"); }
    },
    async release(owner) {
      try { await metadata().updateOne({ _id: SESSION_ID, owner }, { $unset: { owner: "" }, $set: { leaseUntil: new Date(0) } }, operationOptions); }
      catch { throw new Error("Unable to release session renewal lease"); }
    },
  };
}

const renewableFailure = (error) => /^Browser extraction failed: session_(invalid|blocked|challenge)$/.test(error.message);
const SESSION_REASONS = ["invalid_data", "input_file_invalid", "root_cookie_expired", "root_cookie_missing", "restore_exception", "navigation_network_error", "navigation_http_rejected", "navigation_rate_limited", "feed_cookie_missing", "feed_timeout", "feed_blocked", "feed_challenge"];
const HTTP_REJECTIONS = ["navigation_http_rejected", "navigation_rate_limited"];
const rejectionFields = (error) => ({
  ...([401, 403, 429].includes(error.httpStatus) ? { httpStatus: error.httpStatus } : {}),
  ...(Number.isInteger(error.retryAfterSeconds) && error.retryAfterSeconds >= 0 && error.retryAfterSeconds <= 86400 ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
});
const sessionReadError = (status, reason, fields = {}) => {
  const details = Object.entries(fields).map(([name, value]) => `${name}=${value}`).join(", ");
  const error = new Error(`Browser extraction failed: ${status}${reason ? `/${reason}` : ""}${details ? ` (${details})` : ""}`);
  if (reason) error.sessionReason = reason;
  return Object.assign(error, fields);
};
const credentialFailure = (status, reason) => status === "session_invalid" &&
  (reason === undefined || ["invalid_data", "root_cookie_expired", "root_cookie_missing", "feed_cookie_missing"].includes(reason));
function createSessionRunner({ store = createSessionStore(), now = Date.now, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  return async (options, runBrowser) => {
    const deadline = now() + options.timeoutMs;
    const directory = await mkdtemp(path.join(tmpdir(), "f5-reddit-session-"));
    const input = path.join(directory, "input.json");
    const output = path.join(directory, "output.json");
    const owner = randomUUID();
    let attemptedGeneration;
    let lastReuseFailure;
    let lastReuseReason;
    let initialGeneration;
    let observedInitial = false;
    let ownsLease = false;
    let returningValidReuse = false;
    const report = (mode, generation) => options.logger.log(JSON.stringify({ eventType: "BROWSER_SESSION", mode, generation }));
    const checkReadBackoff = (current) => {
      if (Number.isInteger(current?.readBackoffSeconds) && current.readBackoffSeconds > 0) {
        const seconds = Math.min(current.readBackoffSeconds, 86400);
        options.logger.log(JSON.stringify({ eventType: "BROWSER_SESSION", mode: "read_backoff", seconds }));
        throw Object.assign(new Error(`Session reads are cooling down (${seconds} seconds)`), { readBackoffSeconds: seconds });
      }
    };
    const pauseLimitedReads = async (seconds) => {
      try { await store.pauseReads(seconds); }
      catch {
        options.logger.log(JSON.stringify({ eventType: "BROWSER_SESSION", mode: "read_backoff_failed", seconds, severity: "error" }));
        throw Object.assign(new Error("Session read backoff coordination unavailable"), { readBackoffFailed: true });
      }
      options.logger.log(JSON.stringify({ eventType: "BROWSER_SESSION", mode: "read_backoff", seconds }));
    };
    const browserAttempt = async (request) => {
      checkReadBackoff(await store.current());
      let result;
      try { result = await runBrowser(request); }
      catch (error) {
        const seconds = readPauseFor(error);
        if (seconds) {
          await pauseLimitedReads(seconds);
          error.readBackoffStartedSeconds = seconds;
        }
        throw error;
      }
      const seconds = Math.max(readPauseFor(result?.batchFailure), readPauseFor(result?.optionalFailure), readPauseFor(result?.navigationRateLimit));
      if (seconds) {
        try { await pauseLimitedReads(seconds); }
        catch { return { ...result, readBackoffFailed: true }; }
        if (readPauseFor(result?.batchFailure)) return { ...result, readBackoffStartedSeconds: seconds };
      }
      return result;
    };
    const reused = (result, generation, deferredReason) => {
      returningValidReuse = true;
      if (deferredReason) options.logger.log(JSON.stringify({ eventType: "BROWSER_SESSION", mode: "renewal_deferred", generation, reason: deferredReason, severity: "warn" }));
      report("reused", generation);
      return { ...result, sessionMode: "reused", sessionGeneration: generation, ...(deferredReason ? { sessionRenewalDeferred: true } : {}) };
    };
    const release = async () => {
      if (!ownsLease) return;
      try { await store.release(owner); }
      catch (error) {
        if (!returningValidReuse) throw error;
        options.logger.log(JSON.stringify({ eventType: "BROWSER_SESSION", mode: "release_deferred", severity: "warn" }));
      }
    };
    const budget = (max) => {
      const remaining = Math.min(max, deadline - now() - 15000);
      if (remaining < 10000) throw new Error("Session acquisition exceeded its deadline");
      return remaining;
    };
    try {
      while (now() < deadline - 25000) {
        const current = await store.current();
        checkReadBackoff(current);
        const generation = current?.activeGeneration;
        if (!observedInitial) { initialGeneration = generation; observedInitial = true; }
        const renewalRequested = options.renewSession === true && generation === initialGeneration;
        let validReuse;
        if (!renewalRequested && generation && generation !== attemptedGeneration) {
          const bytes = await store.read(generation);
          attemptedGeneration = generation;
          if (bytes) {
            await writeFile(input, bytes, { mode: 0o600 });
            for (let attempt = 1; attempt <= 2; attempt++) {
              try {
                const result = await browserAttempt({ ...options, authenticate: false, sessionInput: input, sessionOutput: undefined, timeoutMs: budget(options.allFeeds ? 150000 : 100000) });
                const aged = now() - new Date(current.sessionCreatedAt).getTime() >= 12 * 60 * 60 * 1000;
                if (result?.batchFailure) return reused(result, generation, aged ? "batch_incomplete" : undefined);
                if (options.allFeeds || readPauseFor(result?.navigationRateLimit) || readPauseFor(result?.optionalFailure) || !aged) return reused(result, generation);
                validReuse = result;
                break;
              } catch (error) {
                const rejected = HTTP_REJECTIONS.includes(error.sessionReason) || Boolean(readPauseFor(error));
                if (!renewableFailure(error) && !rejected) throw error;
                lastReuseFailure = /^Browser extraction failed: (session_invalid|session_blocked|session_challenge|challenge_required|auth_challenge|network_error)$/.exec(error.message)?.[1] || "runtime_error";
                lastReuseReason = SESSION_REASONS.includes(error.sessionReason) ? error.sessionReason : undefined;
                const fields = rejected ? rejectionFields(error) : {};
                options.logger.log(JSON.stringify({ eventType: "BROWSER_SESSION", mode: "reuse_failed", generation, status: lastReuseFailure, ...(lastReuseReason ? { reason: lastReuseReason } : {}), ...fields, attempt }));
                if (rejected) {
                  const failure = sessionReadError(lastReuseFailure, lastReuseReason, fields);
                  failure.readBackoffStartedSeconds = error.readBackoffStartedSeconds;
                  throw failure;
                }
                if (credentialFailure(lastReuseFailure, lastReuseReason)) break;
                if (attempt === 2) {
                  throw sessionReadError(lastReuseFailure, lastReuseReason);
                }
                budget(options.allFeeds ? 150000 : 100000);
                await pause(2000);
              }
            }
          }
        }
        if (options.screenshotPath) throw new Error("Screenshot capture requires an existing session");
        let acquired;
        try { acquired = await store.acquire(owner, generation); }
        catch (error) {
          if (validReuse) return reused(validReuse, generation, "coordination_unavailable");
          throw error;
        }
        if (acquired) {
          ownsLease = true;
          report("renewing", generation || "none");
          try {
            const result = await browserAttempt({ ...options, authenticate: true, sessionInput: undefined, sessionOutput: output, timeoutMs: budget(options.allFeeds ? 150000 : 140000) });
            const stat = await require("node:fs/promises").stat(output);
            if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("Invalid renewed session output");
            const bytes = await readFile(output);
            const next = randomUUID();
            await store.publish(owner, next, bytes);
            ownsLease = false;
            report("renewed", next);
            return { ...result, sessionMode: "renewed", sessionGeneration: next };
          } catch (error) {
            if (validReuse && options.renewSession !== true) return reused(error.readBackoffFailed ? { ...validReuse, readBackoffFailed: true } : validReuse, generation, "renewal_failed");
            throw error;
          }
        }
        if (validReuse) return reused(validReuse, generation, "lease_or_cooldown");
        if (current?.nextAttemptAt && new Date(current.nextAttemptAt).getTime() > now() && (!current.owner || new Date(current.leaseUntil).getTime() <= now())) {
          if ((await store.current())?.activeGeneration !== generation) continue;
          throw new Error(`Session renewal is cooling down after a recent attempt${lastReuseFailure ? `: ${lastReuseFailure}${lastReuseReason ? `/${lastReuseReason}` : ""}` : ""}`);
        }
        await pause(Math.min(2000, Math.max(0, deadline - now() - 25000)));
      }
      throw new Error("Session acquisition exceeded its deadline");
    } finally {
      try { await release(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  };
}

module.exports = { createSessionRunner, createSessionStore, key };

async function inspectSession({ store = createSessionStore(), now = Date.now } = {}) {
  const current = await store.current();
  const instant = now();
  const seconds = (value, direction = 1) => {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? Math.max(0, Math.floor(direction * (timestamp - instant) / 1000)) : null;
  };
  const generation = current?.activeGeneration;
  let safeGeneration = "none";
  if (generation) { try { key(generation); safeGeneration = generation; } catch { safeGeneration = "invalid"; } }
  const report = {
    generation: safeGeneration, statePresent: Boolean(generation), stateReadable: false,
    sessionAgeSeconds: current?.sessionCreatedAt ? seconds(current.sessionCreatedAt, -1) : null,
    leaseActive: Boolean(current?.owner && new Date(current.leaseUntil).getTime() > instant),
    cooldownSeconds: current?.nextAttemptAt ? seconds(current.nextAttemptAt) : null,
    readBackoffSeconds: Number.isInteger(current?.readBackoffSeconds) && current.readBackoffSeconds >= 0 ? Math.min(current.readBackoffSeconds, 86400) : 0,
    versionSupported: false, seedValid: false, cookieCount: 0, rootAccountCookieCount: 0,
    unexpiredRootAccountCookieCount: 0, expiredRootAccountCookieCount: 0, sessionRootAccountCookieCount: 0,
    otherExpiredCookieCount: 0, minimumRootAccountExpirySeconds: null,
    unknownCookieAttributeCount: 0, originCount: 0, stateBytes: 0,
  };
  if (!generation || safeGeneration === "invalid") return report;
  const bytes = await store.read(generation);
  if (!bytes) return report;
  report.stateBytes = bytes.length;
  let state;
  try { state = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { return report; }
  if (!state || typeof state !== "object") return report;
  report.stateReadable = true;
  report.versionSupported = state.version === 1;
  report.seedValid = Number.isSafeInteger(state.seed) && state.seed >= 0;
  report.originCount = Array.isArray(state.origins) ? state.origins.length : 0;
  const fields = new Set(["name", "value", "domain", "path", "expires", "httpOnly", "secure", "sameSite"]);
  const expiries = [];
  for (const cookie of Array.isArray(state.cookies) ? state.cookies : []) {
    report.cookieCount++;
    if (!cookie || typeof cookie !== "object") continue;
    report.unknownCookieAttributeCount += Object.keys(cookie).filter((field) => !fields.has(field)).length;
    const expires = cookie.expires === undefined ? -1 : cookie.expires;
    const timed = typeof expires === "number" && Number.isFinite(expires) && expires !== -1;
    const expired = timed && expires * 1000 <= instant;
    const root = cookie.name === "reddit_session" && String(cookie.domain).replace(/^\./, "") === "reddit.com" && cookie.path === "/";
    if (root) {
      report.rootAccountCookieCount++;
      if (timed) expiries.push(Math.floor(expires - instant / 1000));
      if (expired) report.expiredRootAccountCookieCount++;
      else if ((timed || expires === -1) && typeof cookie.value === "string" && cookie.value.length > 0) report.unexpiredRootAccountCookieCount++;
      if (expires === -1) report.sessionRootAccountCookieCount++;
    } else if (expired) report.otherExpiredCookieCount++;
  }
  if (expiries.length) report.minimumRootAccountExpirySeconds = Math.min(...expiries);
  return report;
}
module.exports.inspectSession = inspectSession;
