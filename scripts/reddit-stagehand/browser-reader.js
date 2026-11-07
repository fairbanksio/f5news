export function readRenderedPosts({ detail = false } = {}) {
  const httpImage = (value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url : null;
    } catch { return null; }
  };
  const redditImage = (value) => {
    const url = httpImage(value);
    return url && /^(i\.redd\.it|preview\.redd\.it|external-preview\.redd\.it)$/.test(url.hostname);
  };
  const larger = (left, right) => !left || (right && (Number(right.original) > Number(left.original) ||
    (right.original === left.original && right.width > left.width))) ? right : left;
  const imageSource = (image, minimumWidth = 0) => {
    if (!image) return null;
    let best = null;
    const add = (value, advertisedWidth = 0) => {
      const url = httpImage(value);
      if (!url) return;
      const queryWidth = Number(url.searchParams.get("width"));
      const naturalWidth = Number(image.naturalWidth);
      const declaredWidth = Number(image.getAttribute("width"));
      const measuredWidth = naturalWidth > 0 && Number.isFinite(naturalWidth) ? naturalWidth : declaredWidth > 0 && Number.isFinite(declaredWidth) ? declaredWidth : 0;
      const width = queryWidth > 0 && Number.isFinite(queryWidth) ? queryWidth : advertisedWidth || measuredWidth;
      if (minimumWidth && width <= minimumWidth) return;
      best = larger(best, { url: url.href, original: url.hostname === "i.redd.it", width });
    };
    add(image.getAttribute("src"));
    add(image.currentSrc);
    for (const node of [image, ...image.closest("picture")?.querySelectorAll("source") || []]) {
      const srcset = node.getAttribute("srcset") || "";
      for (const match of srcset.matchAll(/(\S+)\s+(\d+(?:\.\d+)?)([wx])(?:\s*,\s*|$)/g)) {
        const width = Number(match[2]) * (match[3] === "x" ? Number(image.getAttribute("width")) || image.naturalWidth || 1 : 1);
        add(match[1], width);
      }
    }
    const original = image.closest("a[href]")?.getAttribute("href");
    if (httpImage(original)?.hostname === "i.redd.it") add(original);
    return best;
  };
  const attributes = ["id", "permalink", "content-href", "post-title", "author", "created-timestamp", "score", "comment-count", "domain", "post-type", "subreddit-name"];
  return [...document.querySelectorAll("shreddit-post")].filter((post) =>
    !post.hasAttribute("promoted") && !post.hasAttribute("is-promoted") &&
    !post.hasAttribute("stickied") && !post.hasAttribute("is-stickied")
  ).map((post) => {
    const attrs = Object.fromEntries(attributes.map((name) => [name, post.getAttribute(name)]));
    const player = post.querySelector("shreddit-player");
    const detailLink = detail && ["link", "crosspost"].includes(attrs["post-type"]);
    const minimumWidth = detailLink ? 320 : 0;
    const imageNodes = [...post.querySelectorAll("img")].map(image => ({ image, source: imageSource(image, minimumWidth) }))
      .filter(({ source }) => source && redditImage(source.url));
    const byId = new Map();
    for (const { image, source } of imageNodes) {
      const parsed = new URL(source.url);
      const id = image.getAttribute("data-media-id") || parsed.pathname.match(/(?:-v0-)?([a-z0-9]+)\.[a-z]+$/i)?.[1];
      if (!id) continue;
      byId.set(id, larger(byId.get(id), source));
    }
    const images = [...byId].map(([id, source]) => ({ id, url: source.url }));
    if (attrs["post-type"] === "image" && attrs["content-href"]?.startsWith("https://i.redd.it/")) {
      const url = attrs["content-href"];
      const id = new URL(url).pathname.match(/([a-z0-9]+)\.[a-z]+$/i)?.[1];
      if (id) {
        const existing = images.findIndex((image) => image.id === id);
        if (existing >= 0) images.splice(existing, 1);
        images.unshift({ id, url });
      }
    }
    const bestImage = imageNodes.reduce((best, { source }) => larger(best, source), imageSource(post.querySelector('[slot="thumbnail"] img'), minimumWidth));
    const thumbnail = bestImage?.url || (detailLink ? null : player?.getAttribute("poster") || images[0]?.url || null);
    const preview = detailLink && bestImage?.width > 320
      ? { images: [{ source: { url: bestImage.url, width: bestImage.width } }] } : null;
    const sources = [player?.getAttribute("src"), ...post.querySelectorAll("source")].map((source) => typeof source === "string" ? source : source?.getAttribute("src")).filter(Boolean);
    const video = player ? {
      dash_url: sources.find((url) => /\.mpd(?:\?|$)/i.test(url)) || null,
      hls_url: sources.find((url) => /\.m3u8(?:\?|$)/i.test(url)) || null,
    } : null;
    return {
      attributes: attrs,
      thumbnail,
      images,
      ...(preview ? { preview } : {}),
      video,
      mediaComplete: detail || attrs["post-type"] !== "gallery",
    };
  });
}
