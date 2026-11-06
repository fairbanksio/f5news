const { randomUUID } = require("node:crypto");
const { mkdtemp, writeFile, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

const MAX_BYTES = 1024 * 1024;
const SESSION_ID = "reddit";
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
      try { return await metadata().findOne({ _id: SESSION_ID }, operationOptions); }
      catch { throw new Error("Session coordination unavailable"); }
    },
    async acquire(owner, observedGeneration) {
      try {
        await metadata().updateOne({ _id: SESSION_ID }, { $setOnInsert: { leaseUntil: new Date(0), nextAttemptAt: new Date(0) } }, { upsert: true, ...operationOptions });
        return await metadata().findOneAndUpdate({ _id: SESSION_ID, activeGeneration: observedGeneration || { $exists: false },
          $expr: { $and: [available("leaseUntil"), available("nextAttemptAt")] } }, [{ $set: {
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
    const report = (mode, generation) => options.logger.log(JSON.stringify({ eventType: "BROWSER_SESSION", mode, generation }));
    const budget = (max) => {
      const remaining = Math.min(max, deadline - now() - 15000);
      if (remaining < 10000) throw new Error("Session acquisition exceeded its deadline");
      return remaining;
    };
    try {
      while (now() < deadline - 25000) {
        const current = await store.current();
        const generation = current?.activeGeneration;
        if (!observedInitial) { initialGeneration = generation; observedInitial = true; }
        const renewalRequested = options.renewSession === true && generation === initialGeneration;
        if (!renewalRequested && generation && generation !== attemptedGeneration && now() - new Date(current.sessionCreatedAt).getTime() < 12 * 60 * 60 * 1000) {
          const bytes = await store.read(generation);
          attemptedGeneration = generation;
          if (bytes) {
            await writeFile(input, bytes, { mode: 0o600 });
            for (let attempt = 1; attempt <= 2; attempt++) {
              try {
                const result = await runBrowser({ ...options, authenticate: false, sessionInput: input, sessionOutput: undefined, timeoutMs: budget(100000) });
                report("reused", generation);
                return { ...result, sessionMode: "reused", sessionGeneration: generation };
              } catch (error) {
                if (!renewableFailure(error)) throw error;
                lastReuseFailure = error.message.slice("Browser extraction failed: ".length);
                lastReuseReason = ["invalid_data", "input_file_invalid", "root_cookie_expired", "root_cookie_missing", "restore_exception", "feed_cookie_missing", "feed_timeout", "feed_blocked", "feed_challenge"].includes(error.sessionReason) ? error.sessionReason : undefined;
                options.logger.log(JSON.stringify({ eventType: "BROWSER_SESSION", mode: "reuse_failed", generation, status: lastReuseFailure, ...(lastReuseReason ? { reason: lastReuseReason } : {}), attempt }));
                if (lastReuseFailure === "session_invalid" || attempt === 2) break;
                budget(100000);
                await pause(2000);
              }
            }
          }
        }
        if (await store.acquire(owner, generation)) {
          ownsLease = true;
          report("renewing", generation || "none");
          const result = await runBrowser({ ...options, authenticate: true, sessionInput: undefined, sessionOutput: output, timeoutMs: budget(140000) });
          const stat = await require("node:fs/promises").stat(output);
          if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("Invalid renewed session output");
          const bytes = await readFile(output);
          const next = randomUUID();
          await store.publish(owner, next, bytes);
          ownsLease = false;
          report("renewed", next);
          return { ...result, sessionMode: "renewed", sessionGeneration: next };
        }
        if (current?.nextAttemptAt && new Date(current.nextAttemptAt).getTime() > now() && (!current.owner || new Date(current.leaseUntil).getTime() <= now())) {
          if ((await store.current())?.activeGeneration !== generation) continue;
          throw new Error(`Session renewal is cooling down after a recent attempt${lastReuseFailure ? `: ${lastReuseFailure}${lastReuseReason ? `/${lastReuseReason}` : ""}` : ""}`);
        }
        await pause(Math.min(2000, Math.max(0, deadline - now() - 25000)));
      }
      throw new Error("Session acquisition exceeded its deadline");
    } finally {
      try { if (ownsLease) await store.release(owner); }
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
