const dns = require("dns").promises;
const http = require("http");
const https = require("https");
const net = require("net");
const fetch = require("node-fetch");

const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_TRANSIENT_RETRIES = 1;
const DEFAULT_ARTICLE_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
};

const TRANSIENT_RESPONSE_STATUSES = new Set([403, 429, 500, 502, 503, 504]);

const canRetryTransientFailure = (retryCount, maxRetries) =>
  retryCount < maxRetries;

const hasUsableThumbnail = (thumbnail) => {
  return (
    typeof thumbnail === "string" &&
    thumbnail.length > 0 &&
    !["default", "self", "spoiler", "nsfw", "image"].includes(thumbnail) &&
    /^https?:\/\//.test(thumbnail)
  );
};

const isPrivateIPv4 = (address) => {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return true;
  }

  const [first, second] = parts;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
};

const isPrivateIPv6 = (address) => {
  const normalized = address.toLowerCase();

  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  ) {
    return true;
  }

  if (normalized.startsWith("::ffff:")) {
    return isPrivateIPv4(normalized.replace("::ffff:", ""));
  }

  return false;
};

const isPublicAddress = (address) => {
  const version = net.isIP(address);

  if (version === 4) {
    return !isPrivateIPv4(address);
  }

  if (version === 6) {
    return !isPrivateIPv6(address);
  }

  return false;
};

const isSafeHttpUrl = async (url, options = {}) => {
  const resolveHostname = options.resolveHostname || dns.lookup;
  let parsed;

  try {
    parsed = new URL(url);
  } catch (error) {
    return false;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return false;
  }

  if (net.isIP(hostname)) {
    return isPublicAddress(hostname);
  }

  try {
    const results = await resolveHostname(hostname, { all: true });
    const addresses = Array.isArray(results) ? results : [results];

    return (
      addresses.length > 0 &&
      addresses.every((result) => isPublicAddress(result.address))
    );
  } catch (error) {
    return false;
  }
};

const selectPublicAddress = (addresses) => {
  const publicAddresses = addresses.filter((result) =>
    isPublicAddress(result.address)
  );

  return (
    publicAddresses.find((result) => result.family === 4) ||
    publicAddresses[0] ||
    null
  );
};

const makeSafeLookup = (resolveHostname) => {
  return (hostname, options, callback) => {
    Promise.resolve(resolveHostname(hostname, { all: true }))
      .then((results) => {
        const addresses = Array.isArray(results) ? results : [results];
        const selected = selectPublicAddress(addresses);

        if (!selected) {
          callback(new Error("Blocked private article metadata address"));
          return;
        }

        const family = selected.family || net.isIP(selected.address);
        if (options && options.all) {
          callback(null, [{ address: selected.address, family }]);
          return;
        }

        callback(null, selected.address, family);
      })
      .catch((error) => callback(error));
  };
};

const makeSafeAgent = (resolveHostname) => {
  const lookup = makeSafeLookup(resolveHostname);
  const httpAgent = new http.Agent({ lookup });
  const httpsAgent = new https.Agent({ lookup });

  return (parsedUrl) => {
    return parsedUrl.protocol === "http:" ? httpAgent : httpsAgent;
  };
};

const decodeHtmlEntity = (entity) => {
  const namedEntities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };

  if (entity.startsWith("#x")) {
    return String.fromCodePoint(parseInt(entity.slice(2), 16));
  }

  if (entity.startsWith("#")) {
    return String.fromCodePoint(parseInt(entity.slice(1), 10));
  }

  return namedEntities[entity] || `&${entity};`;
};

const decodeHtml = (value) => {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, entity) =>
    decodeHtmlEntity(entity.toLowerCase())
  );
};

const parseAttributes = (tag) => {
  const attributes = {};
  const attributePattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;

  while ((match = attributePattern.exec(tag)) !== null) {
    attributes[match[1].toLowerCase()] = decodeHtml(
      match[2] || match[3] || match[4] || ""
    );
  }

  return attributes;
};

const toAbsoluteImageUrl = (imageUrl, pageUrl) => {
  try {
    const parsed = new URL(imageUrl, pageUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch (error) {
    return "";
  }
};

const extractMetaImage = (html, pageUrl) => {
  const candidates = [];
  const metaPattern = /<meta\b[^>]*>/gi;
  let match;

  while ((match = metaPattern.exec(html)) !== null) {
    const attributes = parseAttributes(match[0]);
    const key = (attributes.property || attributes.name || "").toLowerCase();

    if (
      [
        "og:image",
        "og:image:secure_url",
        "twitter:image",
        "twitter:image:src",
      ].includes(key) &&
      attributes.content
    ) {
      candidates.push({ key, content: attributes.content });
    }
  }

  const preferred =
    candidates.find((candidate) => candidate.key.startsWith("og:image")) ||
    candidates[0];

  return preferred ? toAbsoluteImageUrl(preferred.content, pageUrl) : "";
};

const mapWithConcurrency = async (items, concurrency, mapper) => {
  const limit = Math.max(1, concurrency || 1);
  const results = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );

  return results;
};

const readResponseBody = async (response, maxBytes) => {
  if (!response.body || typeof response.body.on !== "function") {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }

  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;

    const resolveOnce = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    };

    response.body.on("data", (chunk) => {
      if (settled) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = maxBytes - size;
      if (remaining <= 0) {
        resolveOnce();
        response.body.destroy();
        return;
      }

      chunks.push(
        buffer.length > remaining ? buffer.slice(0, remaining) : buffer
      );
      size += buffer.length;

      if (size >= maxBytes) {
        resolveOnce();
        response.body.destroy();
      }
    });

    response.body.on("error", (error) => {
      if (settled) {
        return;
      }
      reject(error);
    });
    response.body.on("end", resolveOnce);
  });
};

const destroyResponseBody = (response) => {
  if (!response || !response.body) {
    return;
  }

  if (typeof response.body.destroy === "function") {
    response.body.destroy();
    return;
  }

  if (typeof response.body.cancel === "function") {
    response.body.cancel();
  }
};

const withTimeout = async (operation, timeoutMs, onTimeout) => {
  let timeout;

  const timeoutPromise = new Promise((resolve) => {
    timeout = setTimeout(() => {
      onTimeout();
      resolve(null);
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
};

const fetchArticleImage = async (url, options = {}) => {
  const fetchImpl = options.fetchImpl || fetch;
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects || DEFAULT_MAX_REDIRECTS;
  const maxTransientRetries =
    options.maxTransientRetries ?? DEFAULT_MAX_TRANSIENT_RETRIES;
  const resolveHostname = options.resolveHostname || dns.lookup;
  const agent = makeSafeAgent(resolveHostname);
  let nextUrl = url;
  let redirectCount = 0;
  let transientRetryCount = 0;

  while (redirectCount <= maxRedirects) {
    if (!(await isSafeHttpUrl(nextUrl, { resolveHostname }))) {
      return "";
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await withTimeout(
        fetchImpl(nextUrl, {
          headers: DEFAULT_ARTICLE_HEADERS,
          agent,
          redirect: "manual",
          signal: controller.signal,
          timeout: timeoutMs,
        }),
        timeoutMs,
        () => controller.abort()
      );

      if (!response) {
        if (
          canRetryTransientFailure(transientRetryCount, maxTransientRetries)
        ) {
          transientRetryCount += 1;
          continue;
        }
        return "";
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          destroyResponseBody(response);
          return "";
        }
        nextUrl = new URL(location, nextUrl).toString();
        destroyResponseBody(response);
        redirectCount += 1;
        continue;
      }

      if (!response.ok) {
        destroyResponseBody(response);
        if (
          TRANSIENT_RESPONSE_STATUSES.has(response.status) &&
          canRetryTransientFailure(transientRetryCount, maxTransientRetries)
        ) {
          transientRetryCount += 1;
          continue;
        }
        return "";
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType && !contentType.toLowerCase().includes("text/html")) {
        destroyResponseBody(response);
        return "";
      }

      const html = await withTimeout(
        readResponseBody(response, maxBytes),
        timeoutMs,
        () => controller.abort()
      );
      if (!html) {
        return "";
      }

      return extractMetaImage(html, nextUrl);
    } catch (error) {
      if (canRetryTransientFailure(transientRetryCount, maxTransientRetries)) {
        transientRetryCount += 1;
        continue;
      }
      return "";
    } finally {
      clearTimeout(timeout);
    }
  }

  return "";
};

const redditImageSource = (data) => {
  if (data.preview) {
    if (data.preview.images) {
      if (data.preview.images.length > 0) {
        const image = data.preview.images[0];
        if (image.source && image.source.url) {
          return image.source.url.replace(/amp;/g, "");
        }
      }
    }
  }

  if (data.is_gallery) {
    if (data.gallery_data) {
      if (data.gallery_data.items) {
        if (data.gallery_data.items.length > 0) {
          const media =
            data.media_metadata &&
            data.media_metadata[data.gallery_data.items[0].media_id];
          if (media && media.s && media.s.u) {
            return media.s.u.replace(/amp;/g, "");
          }
        }
      }
    }
  }

  if (hasUsableThumbnail(data.thumbnail)) {
    return data.thumbnail.replace(/amp;/g, "");
  }

  return "";
};

const imageSource = async (data, options = {}) => {
  const redditImage = redditImageSource(data);
  if (redditImage) {
    return redditImage;
  }

  const articleUrl = data.url_overridden_by_dest || data.url;
  if (!articleUrl) {
    return data.thumbnail || "";
  }

  const fetchArticleImageImpl =
    options.fetchArticleImageImpl || fetchArticleImage;
  let articleImage = "";
  try {
    articleImage = await fetchArticleImageImpl(articleUrl, options);
  } catch (error) {
    articleImage = "";
  }

  return articleImage || data.thumbnail || "";
};

module.exports = {
  extractMetaImage,
  fetchArticleImage,
  hasUsableThumbnail,
  imageSource,
  isSafeHttpUrl,
  mapWithConcurrency,
  makeSafeLookup,
  redditImageSource,
  selectPublicAddress,
};
