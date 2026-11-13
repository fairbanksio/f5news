const supportedSubreddits = require("../posts/subreddits.json");
const { version } = require("./package.json");

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const MAX_LISTING_BYTES = 4 * 1024 * 1024;
const OPTIONAL_POST_FIELDS = [
  "thumbnail", "preview", "post_hint", "is_video", "media", "is_gallery",
  "gallery_data", "media_metadata", "is_self", "upvote_ratio", "rpan_video", "url_overridden_by_dest",
];

const readDelay = (value) => {
  if (typeof value !== "string" || !/^\d{1,10}$/.test(value)) return undefined;
  return Math.min(Number(value), 86400);
};

const exhaustedDelay = (headers) => {
  const remaining = headers.get("x-ratelimit-remaining");
  if (typeof remaining !== "string" || !/^0(?:\.0+)?$/.test(remaining.trim())) return undefined;
  return readDelay(headers.get("x-ratelimit-reset")) || 600;
};

const oauthFailure = (stage, reason, fields = {}) =>
  Object.assign(new Error(`Reddit OAuth ${stage} failed (${reason})`), { oauthStage: stage, oauthReason: reason, ...fields });

const requestJson = async (fetchImpl, url, options, stage, maxBytes) => {
  let response;
  try {
    response = await fetchImpl(url, { ...options, redirect: "error" });
    if (!response.ok) {
      const httpStatus = Number.isInteger(response.status) && response.status >= 400 && response.status <= 599 ? response.status : undefined;
      const delays = [readDelay(response.headers.get("retry-after")), exhaustedDelay(response.headers)].filter(Number.isInteger);
      throw oauthFailure(stage, "http_error", {
        ...(httpStatus === undefined ? {} : { httpStatus }),
        ...(delays.length ? { retryAfterSeconds: Math.max(...delays) } : {}),
      });
    }
    if (!response.body) throw oauthFailure(stage, "invalid_response");
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maxBytes) throw oauthFailure(stage, "response_too_large");
      chunks.push(chunk);
    }
    const delay = exhaustedDelay(response.headers);
    try { return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")), delay }; }
    catch { throw oauthFailure(stage, "invalid_response"); }
  } catch (error) {
    if (error.oauthStage === stage) throw error;
    throw oauthFailure(stage, options.signal.aborted ? "timeout" : "request_failed");
  } finally {
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
};

const validUrl = (value) => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
};

const listingChildren = (body, subreddit, limit) => {
  const rows = body?.data?.children;
  if (body?.kind !== "Listing" || !Array.isArray(rows) || !rows.length || rows.length > limit) throw oauthFailure("listing", "invalid_listing");
  const ids = new Set();
  return rows.map(({ kind, data } = {}) => {
    if (kind !== "t3" || !data || typeof data.id !== "string" || !/^[a-z0-9]+$/.test(data.id) || ids.has(data.id) ||
        typeof data.subreddit !== "string" || data.subreddit.toLowerCase() !== subreddit ||
        !["title", "domain", "author"].every((key) => typeof data[key] === "string" && data[key].trim()) ||
        !validUrl(data.url) || typeof data.permalink !== "string" ||
        !new RegExp(`^/r/${subreddit}/comments/${data.id}(?:/[^?#]*)?$`, "i").test(data.permalink) ||
        !Number.isSafeInteger(data.created_utc) || data.created_utc < 0 ||
        !Number.isSafeInteger(data.ups) || !Number.isSafeInteger(data.num_comments) || data.num_comments < 0) {
      throw oauthFailure("listing", "invalid_post");
    }
    ids.add(data.id);
    const post = { id: data.id, subreddit, title: data.title, domain: data.domain, author: data.author, url: data.url,
      permalink: data.permalink, created_utc: data.created_utc, ups: data.ups, num_comments: data.num_comments };
    for (const field of OPTIONAL_POST_FIELDS) {
      if (Object.hasOwn(data, field) && (field !== "url_overridden_by_dest" || validUrl(data[field]))) post[field] = data[field];
    }
    return { kind, data: post };
  });
};

const createRedditOAuthSource = ({ env = process.env, fetchImpl = globalThis.fetch } = {}) =>
  async ({ subreddits = supportedSubreddits, limit = 25, timeoutMs = 30000 } = {}) => {
    if (!Array.isArray(subreddits) || !subreddits.length || new Set(subreddits).size !== subreddits.length ||
        subreddits.some((name) => !supportedSubreddits.includes(name))) throw new Error("Invalid Reddit OAuth feeds");
    if (!Number.isInteger(limit) || limit < 1 || limit > 25 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
      throw new Error("Invalid Reddit OAuth request limits");
    }
    const { REDDIT_CLIENT_ID: clientId, REDDIT_SECRET_KEY: secret, REDDIT_USERNAME: username, REDDIT_PASSWORD: password } = env;
    if (![clientId, secret, username, password].every((value) => typeof value === "string" && value.length) || !/^[a-zA-Z0-9_-]{1,32}$/.test(username)) {
      throw oauthFailure("token", "configuration_missing");
    }
    const signal = AbortSignal.timeout(timeoutMs);
    const userAgent = `linux:f5.news:${version} (by /u/${username})`;
    const token = await requestJson(fetchImpl, TOKEN_URL, {
      method: "POST", signal,
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent,
      },
      body: new URLSearchParams({ grant_type: "password", username, password }),
    }, "token", 64 * 1024);
    const accessToken = token.body?.access_token;
    if (typeof accessToken !== "string" || !/^[a-zA-Z0-9._~+/=-]{1,4096}$/.test(accessToken) ||
        token.body?.token_type?.toLowerCase?.() !== "bearer") throw oauthFailure("token", "token_rejected");

    const feeds = [];
    let delay = token.delay;
    for (const subreddit of subreddits) {
      try {
        if (delay !== undefined) throw oauthFailure("listing", "rate_limit_exhausted", { retryAfterSeconds: delay });
        const result = await requestJson(fetchImpl, `https://oauth.reddit.com/r/${subreddit}/rising?limit=${limit}&raw_json=1`, {
          signal, headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": userAgent },
        }, "listing", MAX_LISTING_BYTES);
        feeds.push({ subreddit, children: listingChildren(result.body, subreddit, limit) });
        delay = result.delay;
      } catch (error) {
        if (!feeds.length) throw error;
        return { feeds, failures: [], batchFailure: {
          subreddit, status: "network_error", oauthStage: error.oauthStage, oauthReason: error.oauthReason,
          ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
          ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
        } };
      }
    }
    return { feeds, failures: [], ...(delay === undefined ? {} : { rateLimit: { retryAfterSeconds: delay } }) };
  };

module.exports = { createRedditOAuthSource };
