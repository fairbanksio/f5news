const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const integer = (value, min = -Number.MAX_SAFE_INTEGER) => {
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min ? number : null;
};
const httpUrl = (value) => {
  try {
    if (!text(value)) return null;
    const url = new URL(value.replace(/&amp;/g, "&"));
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
};

// Reject normalized invalid dates rather than turning February 30 into March.
const timestamp = (value) => {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = "", zone] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const [y, m, d, h, min, s] = parts;
  if (y < 1970 || m < 1 || m > 12 || d < 1 || h > 23 || min > 59 || s > 59 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  const offset = zone === "Z" ? "+00:00" : zone.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  if (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59) return null;
  const milliseconds = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction.padEnd(3, "0").slice(0, 3)}${offset}`);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? Math.floor(milliseconds / 1000) : null;
};

export function toF5Record(raw, subreddit, { fetchedAt = new Date() } = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const attrs = source.attributes && typeof source.attributes === "object" && !Array.isArray(source.attributes) ? source.attributes : source;
  const missing = new Set();
  const required = new Set();
  const check = (field, value, needed = false) => {
    if (value === null) { missing.add(field); if (needed) required.add(field); }
    return value;
  };
  const expectedSub = typeof subreddit === "string" && /^[a-zA-Z0-9_]{2,21}$/.test(subreddit) ? subreddit : null;
  const actualSub = text(attrs["subreddit-name"]);
  const sub = check("sub", expectedSub && actualSub?.toLowerCase() === expectedSub.toLowerCase() ? expectedSub : null, true);
  const name = text(attrs.id);
  const id = check("id", name && /^t3_[a-z0-9]+$/.test(name) ? name.slice(3) : null, true);
  let permalink = null;
  try {
    const input = attrs.permalink;
    const url = new URL(input, "https://www.reddit.com");
    const match = url.pathname.match(/^\/r\/([a-zA-Z0-9_]+)\/comments\/([a-z0-9]+)(?:\/[^/?#]*)?\/?$/);
    if (typeof input === "string" && (input.startsWith("/r/") || /^https?:\/\//.test(input)) &&
        ["www.reddit.com", "reddit.com", "old.reddit.com", "sh.reddit.com"].includes(url.hostname) &&
        ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash &&
        match && match[1].toLowerCase() === sub?.toLowerCase() && match[2] === id) permalink = url.pathname;
  } catch { /* Incomplete records remain inspectable. */ }
  check("commentLink", permalink, true);
  const rawType = attrs["post-type"] === "multi_media" ? "text" : attrs["post-type"] === "crosspost" ? "link" : attrs["post-type"];
  const type = check("post-type", ["link", "image", "gallery", "video", "text"].includes(rawType) ? rawType : null, true);
  const title = check("title", text(attrs["post-title"]), true);
  const author = check("author", text(attrs.author), true);
  const created = check("created_utc", timestamp(attrs["created-timestamp"]), true);
  const score = check("upvoteCount", integer(attrs.score), true);
  const comments = check("commentCount", integer(attrs["comment-count"], 0), true);
  const destination = attrs["content-href"];
  const crosspostPath = attrs["post-type"] === "crosspost" && typeof destination === "string" && /^\/r\/[a-zA-Z0-9_]{2,21}\/comments\/[a-z0-9]+(?:\/[^/?#]*)?\/?$/.test(destination);
  const url = check("url", httpUrl(crosspostPath ? `https://www.reddit.com${destination}` : destination), true);
  const domain = check("domain", text(attrs.domain));
  const thumbnail = httpUrl(source.thumbnail);
  let media = null;
  let galleryData = null;
  let metadata = null;
  let preview = null;
  const images = (Array.isArray(source.images) ? source.images : []).flatMap((image) => {
    if (!image || typeof image !== "object") return [];
    const imageUrl = httpUrl(image.url);
    return imageUrl ? [{ ...image, url: imageUrl }] : [];
  });
  if (type === "image") {
    const image = images[0];
    if (image) preview = { images: [{ source: { url: image.url } }] };
    check("preview", preview, true);
  }
  if (type === "link") {
    const previewUrl = httpUrl(source.preview?.images?.[0]?.source?.url);
    if (previewUrl) preview = { images: [{ source: { url: previewUrl } }] };
  }
  if (type === "gallery") {
    const entries = images.filter((image) => typeof image.id === "string" && /^[a-zA-Z0-9_-]+$/.test(image.id));
    if (entries.length !== source.images?.length || new Set(entries.map((image) => image.id)).size !== entries.length) {
      missing.add("gallery.images"); required.add("gallery.images");
    }
    if (entries.length) {
      galleryData = { items: entries.map((image) => ({ media_id: image.id })) };
      metadata = Object.fromEntries(entries.map((image) => [image.id, { s: { u: image.url } }]));
    }
    check("gallery_data", galleryData, true);
    check("media_metadata", metadata, true);
  }
  if (type === "video") {
    const video = source.video && typeof source.video === "object" ? source.video : {};
    const dash = httpUrl(video.dash_url);
    if (dash) media = { reddit_video: { dash_url: dash } };
    check("media.reddit_video.dash_url", dash, true);
  }
  if (["image", "gallery", "video"].includes(type) && source.mediaComplete !== true) {
    missing.add("mediaComplete"); required.add("mediaComplete");
  }

  const fetchedDate = fetchedAt instanceof Date ? new Date(fetchedAt) : new Date(fetchedAt);
  const fetched = check("fetchedAt", fetchedAt != null && !Number.isNaN(fetchedDate.getTime()) ? fetchedDate.toISOString() : null, true);
  const post = {
    title, domain, url, commentLink: permalink, author, created_utc: created,
    upvoteCount: score, commentCount: comments, fetchedAt: fetched, sub,
  };
  const resolvedThumbnail = preview?.images[0].source.url || thumbnail;
  if (check("thumbnail", resolvedThumbnail)) post.thumbnail = resolvedThumbnail;
  if (type === "image") post.post_hint = "image";
  if (type === "video") {
    post.is_video = true;
    if (media) post.media = media;
  }
  if (type === "gallery") {
    post.is_gallery = true;
    if (metadata) post.media_metadata = metadata;
  }
  if (type === "text") post.is_self = true;
  const { commentLink, upvoteCount, commentCount, fetchedAt: ignoredFetched, sub: ignoredSub, ...common } = post;
  const data = { ...common, id, name: id ? `t3_${id}` : null, subreddit: sub, permalink: commentLink, ups: upvoteCount, num_comments: commentCount };
  if (preview) data.preview = preview;
  if (galleryData) data.gallery_data = galleryData;
  return {
    post, reddit: { kind: "t3", data },
    missingFields: [...missing], ready: required.size === 0,
  };
}
