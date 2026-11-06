export function readRenderedPosts({ detail = false } = {}) {
  const attributes = ["id", "permalink", "content-href", "post-title", "author", "created-timestamp", "score", "comment-count", "domain", "post-type", "subreddit-name"];
  return [...document.querySelectorAll("shreddit-post")].filter((post) =>
    !post.hasAttribute("promoted") && !post.hasAttribute("is-promoted") &&
    !post.hasAttribute("stickied") && !post.hasAttribute("is-stickied")
  ).map((post) => {
    const attrs = Object.fromEntries(attributes.map((name) => [name, post.getAttribute(name)]));
    const player = post.querySelector("shreddit-player");
    const imageNodes = [...post.querySelectorAll("img")].filter((image) => {
      try { return /(^|\.)(i\.redd\.it|preview\.redd\.it|external-preview\.redd\.it)$/.test(new URL(image.getAttribute("src")).hostname); }
      catch { return false; }
    });
    const seen = new Set();
    const images = imageNodes.flatMap((image) => {
      const link = image.closest("a[href]")?.getAttribute("href");
      const url = link?.startsWith("https://i.redd.it/") ? link : image.getAttribute("src");
      const parsed = new URL(url);
      const id = image.getAttribute("data-media-id") || parsed.pathname.match(/(?:-v0-)?([a-z0-9]+)\.[a-z]+$/i)?.[1];
      if (!id || seen.has(id)) return [];
      seen.add(id);
      return [{ id, url }];
    });
    if (attrs["post-type"] === "image" && attrs["content-href"]?.startsWith("https://i.redd.it/")) {
      const url = attrs["content-href"];
      const id = new URL(url).pathname.match(/([a-z0-9]+)\.[a-z]+$/i)?.[1];
      if (id) {
        const existing = images.findIndex((image) => image.id === id);
        if (existing >= 0) images.splice(existing, 1);
        images.unshift({ id, url });
      }
    }
    const thumbnail = post.querySelector('[slot="thumbnail"] img')?.getAttribute("src") || player?.getAttribute("poster") || images[0]?.url || null;
    const sources = [player?.getAttribute("src"), ...post.querySelectorAll("source")].map((source) => typeof source === "string" ? source : source?.getAttribute("src")).filter(Boolean);
    const video = player ? {
      dash_url: sources.find((url) => /\.mpd(?:\?|$)/i.test(url)) || null,
      hls_url: sources.find((url) => /\.m3u8(?:\?|$)/i.test(url)) || null,
    } : null;
    return {
      attributes: attrs,
      thumbnail,
      images,
      video,
      mediaComplete: detail || attrs["post-type"] !== "gallery",
    };
  });
}
