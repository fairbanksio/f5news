import { readRenderedPosts } from "./browser-reader.js";

export { readRenderedPosts };

export async function readListing(page, subreddit, limit, progress, { sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const posts = new Map();
  let unchanged = 0;
  for (let attempt = 0; attempt < 12 && unchanged < 3; attempt += 1) {
    const previous = posts.size;
    for (const raw of await page.evaluate(readRenderedPosts)) {
      if (raw.attributes["subreddit-name"]?.toLowerCase() === subreddit.toLowerCase() && raw.attributes.id) {
        posts.set(raw.attributes.id, raw);
      }
    }
    progress.log(`Found ${posts.size} organic listing posts.`);
    if (posts.size >= limit) break;
    unchanged = posts.size === previous ? unchanged + 1 : 0;
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await sleep(1_000);
  }
  return [...posts.values()].slice(0, limit);
}

export async function resolveVideoManifest(video, fetchImpl = fetch) {
  if (!video || video.dash_url || !video.hls_url) return video;
  const candidate = new URL(video.hls_url);
  if (candidate.protocol !== "https:" || candidate.hostname !== "v.redd.it" || !candidate.pathname.endsWith("/HLSPlaylist.m3u8")) return video;
  candidate.pathname = candidate.pathname.replace(/HLSPlaylist\.m3u8$/, "DASHPlaylist.mpd");
  try {
    const response = await fetchImpl(candidate, { signal: AbortSignal.timeout(5_000), redirect: "error" });
    if (!response.ok) { await response.body?.cancel(); return video; }
    const manifest = await response.text();
    return /<MPD[\s>]/.test(manifest) ? { ...video, dash_url: candidate.href } : video;
  } catch {
    return video;
  }
}
