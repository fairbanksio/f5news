const dns = require("dns").promises;
const { errorFields, sanitizeImageFailure } = require("./telemetry");
const http = require("http");
const https = require("https");
const net = require("net");
const { normalizeFetch } = require("./fetchInterop");

const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_TRANSIENT_RETRIES = 1;
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetchImpl }) => fetchImpl(...args));
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

const imageUrlWidth = (url) => {
  try {
    const widths = new URL(url.replace(/amp;/g, "")).searchParams.getAll("width");
    const width = widths.length === 1 && /^[1-9]\d*$/.test(widths[0]) ? Number(widths[0]) : null;
    return Number.isSafeInteger(width) ? width : null;
  } catch {
    return null;
  }
};

const SMALL_THUMBNAIL_PATTERN = "^https?://(?![^#]*[?&]width=[^#]*[?&]width=)(?:(?:[a-z0-9-]+\\.)?thumbs\\.redditmedia\\.com/[^#]*|[^#]*[?&]width=(?:[1-9]|[1-9][0-9]|[12][0-9]{2}|3[01][0-9]|320)(?:&[^#]*)?)$";

const isSmallRedditThumbnail = (url) => {
  if (!hasUsableThumbnail(url)) return false;
  try {
    const parsed = new URL(url.replace(/amp;/g, ""));
    const width = imageUrlWidth(url);
    if (parsed.searchParams.has("width")) return width !== null && width <= 320;
    return /(^|\.)thumbs\.redditmedia\.com$/.test(parsed.hostname);
  } catch {
    return false;
  }
};

const isPublisherUrl = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
      !/(^|\.)(reddit\.com|redd\.it|redditmedia\.com|redditstatic\.com)\.?$/.test(url.hostname);
  } catch {
    return false;
  }
};

const isPrivateIPv4 = (address) => {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return true;
  }

  const [first, second, third] = parts;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
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
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password ||
        hostname === "localhost" || hostname.endsWith(".localhost") ||
        (net.isIP(hostname) && !isPublicAddress(hostname))) {
      return "";
    }
    return parsed.toString();
  } catch (error) {
    return "";
  }
};

const articleSchemaImages = (html) => {
  const images = [];
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = scripts.exec(html)) !== null) {
    if (parseAttributes(match[1]).type?.toLowerCase() !== "application/ld+json") continue;
    let value;
    try { value = JSON.parse(match[2]); } catch { continue; }
    const nodes = Array.isArray(value) ? value.slice(0, 256) : [value];
    for (let index = 0; index < nodes.length && index < 256; index += 1) {
      const node = nodes[index];
      if (!node || typeof node !== "object" || Array.isArray(node)) continue;
      if (Array.isArray(node["@graph"])) nodes.push(...node["@graph"].slice(0, Math.max(0, 256 - nodes.length)));
      const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
      if (!types.some(type => ["Article", "NewsArticle", "BlogPosting"].includes(type))) continue;
      for (const image of Array.isArray(node.image) ? node.image : [node.image]) {
        if (typeof image === "string") images.push(image);
        else if (image && typeof image === "object") {
          if (typeof image.url === "string") images.push(image.url);
          if (typeof image.contentUrl === "string") images.push(image.contentUrl);
        }
      }
    }
  }
  return images;
};

const contentImageLinks = (html, pageUrl) => {
  const images = [];
  const stack = [];
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const excludedTags = new Set(["header", "footer", "nav", "template", "noscript"]);
  const decorative = /(?:^|[^a-z])(?:header|footer|navigation|logo|icon|avatar|badge|sprite|related|ads?|advertisement)(?:[^a-z]|$)/i;
  const tags = /<(\/?)([a-z][a-z0-9:-]*)\b[^>]*>/gi;
  // Script text and comments are not article markup.
  const markup = html.replace(/<!--[\s\S]*?(?:-->|$)|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const normalizeLabel = value => decodeHtml(value.replace(/<[^>]*>/g, " ")).normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  const headings = [...markup.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)].map(match => normalizeLabel(match[1]));
  const primaryHeading = headings.length === 1 ? headings[0] : "";
  let match;
  while ((match = tags.exec(markup)) !== null) {
    const tag = match[2].toLowerCase();
    if (match[1]) {
      const index = stack.findLastIndex(entry => entry.tag === tag);
      if (index !== -1) stack.length = index;
      continue;
    }
    const attributes = parseAttributes(match[0]);
    const excluded = excludedTags.has(tag) || (!["html", "body"].includes(tag) && decorative.test([attributes.id, attributes.class, attributes.alt, attributes.src, attributes.href].join(" ")));
    const hasSemanticMain = stack.some(entry => entry.main);
    if (tag === "img" && !excluded && /^\d+$/.test(attributes.width || "") && Number(attributes.width) >= 300 &&
        /^\d+$/.test(attributes.height || "") && Number(attributes.height) >= 150 &&
        attributes.src && toAbsoluteImageUrl(attributes.src, pageUrl) &&
        (hasSemanticMain || stack.some(entry => entry.legacyMain)) && !stack.some(entry => entry.excluded)) {
      const anchor = stack.findLast(entry => entry.tag === "a");
      const image = anchor?.href && toAbsoluteImageUrl(anchor.href, pageUrl);
      const inSidebar = stack.some(entry => entry.sidebar);
      const identifiesArticle = primaryHeading && anchor && [anchor.label, anchor.title].some(label => label && normalizeLabel(label) === primaryHeading);
      if (((hasSemanticMain && !inSidebar) || identifiesArticle) && image && /\.(?:jpe?g|png|webp|gif|avif)$/i.test(new URL(image).pathname)) images.push(image);
    }
    if (!voidTags.has(tag) && !/\/\s*>$/.test(match[0])) {
      if (stack.length >= 256) return images;
      stack.push({ tag, excluded, href: attributes.href, label: attributes["aria-label"], title: attributes.title,
        main: tag === "main" || tag === "article" || attributes.role === "main", legacyMain: attributes.id === "main",
        sidebar: tag === "aside" || /(?:^|[^a-z])sidebar(?:[^a-z]|$)/i.test([attributes.id, attributes.class].join(" ")) });
    }
  }
  return images;
};

const extractMetaImage = (html, pageUrl) => {
  if (typeof html !== "string") return "";
  const boundedHtml = Buffer.from(html).subarray(0, DEFAULT_MAX_BYTES).toString("utf8");
  const candidates = [];
  const metaPattern = /<meta\b[^>]*>/gi;
  let match;
  while ((match = metaPattern.exec(boundedHtml)) !== null) {
    const attributes = parseAttributes(match[0]);
    const key = (attributes.property || attributes.name || "").toLowerCase();
    if (["og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"].includes(key) && attributes.content) {
      candidates.push({ key, content: attributes.content });
    }
  }
  const preferred = [...candidates.filter(candidate => candidate.key.startsWith("og:image")),
    ...candidates.filter(candidate => candidate.key.startsWith("twitter:image"))];
  for (const candidate of preferred) {
    const image = toAbsoluteImageUrl(candidate.content, pageUrl);
    if (image) return image;
  }
  const links = /<link\b[^>]*>/gi;
  while ((match = links.exec(boundedHtml)) !== null) {
    const attributes = parseAttributes(match[0]);
    if (!(attributes.rel || "").toLowerCase().split(/\s+/).includes("image_src") || !attributes.href) continue;
    const image = toAbsoluteImageUrl(attributes.href, pageUrl);
    if (image) return image;
  }
  for (const candidate of articleSchemaImages(boundedHtml)) {
    const image = toAbsoluteImageUrl(candidate, pageUrl);
    if (image) return image;
  }
  return contentImageLinks(boundedHtml, pageUrl)[0] || "";
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

  // Drain active workers before reporting failure so completion counts stay final.
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  const failed = workers.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;

  return results;
};

const readResponseBody = async (response, maxBytes, binary = false) => {
  if (!response.body || typeof response.body.on !== "function") {
    if (binary) {
      if (!response.body?.getReader) return Buffer.alloc(0);
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (size < maxBytes) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value).subarray(0, maxBytes - size);
          chunks.push(chunk);
          size += chunk.length;
        }
        return Buffer.concat(chunks);
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    const text = await response.text();
    return binary ? Buffer.from(text).subarray(0, maxBytes) : text.slice(0, maxBytes);
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
      const bytes = Buffer.concat(chunks);
      resolve(binary ? bytes : bytes.toString("utf8"));
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

const destroyResponseBody = async (response) => {
  if (!response || !response.body) {
    return;
  }

  if (typeof response.body.destroy === "function") {
    response.body.destroy();
    return;
  }

  if (typeof response.body.cancel === "function") {
    await Promise.resolve(response.body.cancel()).catch(() => {});
  }
};

const getHeader = (response, name) => {
  if (
    !response ||
    !response.headers ||
    typeof response.headers.get !== "function"
  ) {
    return "";
  }

  return response.headers.get(name) || "";
};

const responseDiagnostics = (response) => ({
  status: response.status,
  contentType: getHeader(response, "content-type"),
  server: getHeader(response, "server"),
  xCache: getHeader(response, "x-cache"),
  xDatadome: getHeader(response, "x-datadome"),
});

const reportArticleImageFailure = (options, failure) => {
  if (typeof options.onArticleImageFailure !== "function") {
    return;
  }

  options.onArticleImageFailure(sanitizeImageFailure({
    url: failure.url,
    reason: failure.reason,
    ...(failure.details || {}),
  }));
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
  const fetchImpl = normalizeFetch(options.fetchImpl || fetch);
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
    if (options.publisherOnly && !isPublisherUrl(nextUrl)) return "";
    const safeUrl = isSafeHttpUrl(nextUrl, { resolveHostname });
    const allowed = options.publisherOnly ? await withTimeout(safeUrl, timeoutMs, () => {}) : await safeUrl;
    if (!allowed) {
      reportArticleImageFailure(options, {
        url: nextUrl,
        reason: allowed === null ? "request_timeout" : "unsafe_url",
        details: {
          redirectCount,
          retryCount: transientRetryCount,
        },
      });
      return "";
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let requestTimedOut = false;
    let response;

    try {
      response = await withTimeout(
        fetchImpl(nextUrl, {
          headers: DEFAULT_ARTICLE_HEADERS,
          agent,
          redirect: "manual",
          signal: controller.signal,
          timeout: timeoutMs,
        }),
        timeoutMs,
        () => {
          requestTimedOut = true;
          controller.abort();
        }
      );

      if (!response) {
        if (
          canRetryTransientFailure(transientRetryCount, maxTransientRetries)
        ) {
          transientRetryCount += 1;
          continue;
        }
        reportArticleImageFailure(options, {
          url: nextUrl,
          reason: requestTimedOut ? "request_timeout" : "empty_response",
          details: {
            redirectCount,
            retryCount: transientRetryCount,
            timeoutMs,
          },
        });
        return "";
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          reportArticleImageFailure(options, {
            url: nextUrl,
            reason: "redirect_missing_location",
            details: {
              ...responseDiagnostics(response),
              redirectCount,
              retryCount: transientRetryCount,
            },
          });
          return "";
        }
        nextUrl = new URL(location, nextUrl).toString();
        redirectCount += 1;
        continue;
      }

      if (!response.ok) {
        const canRetry =
          TRANSIENT_RESPONSE_STATUSES.has(response.status) &&
          canRetryTransientFailure(transientRetryCount, maxTransientRetries);

        if (canRetry) {
          transientRetryCount += 1;
          continue;
        }

        reportArticleImageFailure(options, {
          url: nextUrl,
          reason: "http_status",
          details: {
            ...responseDiagnostics(response),
            redirectCount,
            retryCount: transientRetryCount,
          },
        });
        return "";
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType && !contentType.toLowerCase().includes("text/html")) {
        reportArticleImageFailure(options, {
          url: nextUrl,
          reason: "non_html_response",
          details: {
            ...responseDiagnostics(response),
            redirectCount,
            retryCount: transientRetryCount,
          },
        });
        return "";
      }

      let htmlTimedOut = false;
      let html;

      try {
        html = await withTimeout(
          readResponseBody(response, maxBytes),
          timeoutMs,
          () => {
            htmlTimedOut = true;
            controller.abort();
          }
        );
      } catch (error) {
        if (
          canRetryTransientFailure(transientRetryCount, maxTransientRetries)
        ) {
          transientRetryCount += 1;
          continue;
        }
        reportArticleImageFailure(options, {
          url: nextUrl,
          reason: "body_read_error",
          details: {
            ...responseDiagnostics(response),
            redirectCount,
            retryCount: transientRetryCount,
            errorName: error.name,
            errorMessage: error.message,
          },
        });
        return "";
      }

      if (!html) {
        reportArticleImageFailure(options, {
          url: nextUrl,
          reason: htmlTimedOut ? "body_read_timeout" : "empty_html",
          details: {
            ...responseDiagnostics(response),
            redirectCount,
            retryCount: transientRetryCount,
            timeoutMs,
          },
        });
        return "";
      }

      const image = extractMetaImage(html, nextUrl);
      if (!image) {
        reportArticleImageFailure(options, {
          url: nextUrl,
          reason: "no_meta_image",
          details: {
            ...responseDiagnostics(response),
            redirectCount,
            retryCount: transientRetryCount,
            bytesRead: Buffer.byteLength(html),
          },
        });
        return "";
      }

      return !options.publisherOnly || isPublisherUrl(image) ? image : "";
    } catch (error) {
      if (canRetryTransientFailure(transientRetryCount, maxTransientRetries)) {
        transientRetryCount += 1;
        continue;
      }
      reportArticleImageFailure(options, {
        url: nextUrl,
        reason: "fetch_error",
        details: {
          redirectCount,
          retryCount: transientRetryCount,
          errorName: error.name,
          errorMessage: error.message,
        },
      });
      return "";
    } finally {
      await destroyResponseBody(response);
      clearTimeout(timeout);
    }
  }

  reportArticleImageFailure(options, {
    url: nextUrl,
    reason: "too_many_redirects",
    details: {
      redirectCount,
      retryCount: transientRetryCount,
      maxRedirects,
    },
  });
  return "";
};

const imageWidthFromBytes = (bytes) => {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return bytes.readUInt32BE(16);
  if (bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6))) return bytes.readUInt16LE(6);
  if (bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const kind = bytes.toString("ascii", 12, 16);
    if (kind === "VP8X") return bytes.readUIntLE(24, 3) + 1;
    if (kind === "VP8L" && bytes[20] === 0x2f) return (bytes.readUInt16LE(21) & 0x3fff) + 1;
    if (kind === "VP8 " && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 1, 0x2a]))) return bytes.readUInt16LE(26) & 0x3fff;
  }
  if (bytes.length >= 4 && bytes.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      offset += 2;
      const size = bytes.readUInt16BE(offset);
      if (size < 2) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return size >= 7 && offset + 7 <= bytes.length ? bytes.readUInt16BE(offset + 5) : null;
      }
      offset += size;
    }
  }
  return null;
};

const fetchImageWidth = async (url, options = {}) => {
  const fetchImpl = normalizeFetch(options.fetchImpl || fetch);
  const resolveHostname = options.resolveHostname || dns.lookup;
  const controller = new AbortController();
  const timeoutMs = options.imageTimeoutMs || 1500;
  let response;
  const operation = async () => {
    let nextUrl = url;
    for (let redirects = 0; redirects <= 2; redirects += 1) {
      if (options.publisherOnly && !isPublisherUrl(nextUrl)) return null;
      if (!(await isSafeHttpUrl(nextUrl, { resolveHostname })) || controller.signal.aborted) return null;
      response = await fetchImpl(nextUrl, {
        headers: { ...DEFAULT_ARTICLE_HEADERS, Accept: "image/*", Range: "bytes=0-65535" },
        agent: makeSafeAgent(resolveHostname), redirect: "manual", signal: controller.signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = getHeader(response, "location");
        if (!location) return null;
        nextUrl = new URL(location, nextUrl).href;
        await destroyResponseBody(response);
        response = null;
        continue;
      }
      if (!response.ok) return null;
      return imageWidthFromBytes(await readResponseBody(response, 64 * 1024, true));
    }
    return null;
  };
  try {
    return await withTimeout(operation(), timeoutMs, () => controller.abort());
  } catch {
    return null;
  } finally {
    await destroyResponseBody(response);
  }
};

const redditImageSource = (data) => {
  if (data.preview) {
    if (data.preview.images) {
      if (data.preview.images.length > 0) {
        const image = data.preview.images[0];
        const candidates = [image.source, ...(image.resolutions || [])].filter((candidate) => candidate?.url);
        let preferred = candidates[0];
        const width = (candidate) => imageUrlWidth(candidate.url) || (Number.isFinite(candidate.width) && candidate.width > 0 ? candidate.width : null);
        for (const candidate of candidates.slice(1)) {
          if (width(preferred) !== null && width(candidate) > width(preferred)) preferred = candidate;
        }
        if (preferred) {
          return preferred.url.replace(/amp;/g, "");
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

const isExternalLinkPost = (data) => {
  if (data.is_video || data.is_gallery || data.is_self || data.rpan_video || (data.post_hint && data.post_hint !== "link")) return false;
  try {
    const url = new URL(data.url_overridden_by_dest || data.url);
    return ["http:", "https:"].includes(url.protocol) && !/(^|\.)(reddit\.com|redd\.it)$/.test(url.hostname);
  } catch {
    return false;
  }
};

const imageSource = async (data, options = {}) => {
  const redditImage = options.publisherOnly ? "" : redditImageSource(data);
  const fallback = options.publisherOnly ? "" : data.thumbnail || "";
  const tryPublisher = options.preferArticleImage === true && isSmallRedditThumbnail(redditImage);
  if (redditImage && !tryPublisher) {
    return redditImage;
  }

  const articleUrl = data.url_overridden_by_dest || data.url;
  if (!articleUrl || !isExternalLinkPost(data)) {
    return redditImage || fallback;
  }

  const fetchArticleImageImpl =
    options.fetchArticleImageImpl || fetchArticleImage;
  try {
    const articleImage = await fetchArticleImageImpl(articleUrl, options);
    return articleImage || redditImage || fallback;
  } catch (error) {
    reportArticleImageFailure(options, { url: articleUrl, reason: "fetch_error", details: errorFields(error) });
    return redditImage || fallback;
  }
};

module.exports = {
  extractMetaImage,
  fetchArticleImage,
  hasUsableThumbnail,
  imageUrlWidth,
  isSmallRedditThumbnail,
  isExternalLinkPost,
  isPublisherUrl,
  SMALL_THUMBNAIL_PATTERN,
  fetchImageWidth,
  imageWidthFromBytes,
  redditImageSource,
  imageSource,
  isSafeHttpUrl,
  mapWithConcurrency,
  makeSafeLookup,
  selectPublicAddress,
};
