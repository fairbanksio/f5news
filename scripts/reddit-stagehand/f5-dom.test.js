import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { readListing, readRenderedPosts, resolveVideoManifest } from "./f5-dom.js";

test("rendered metadata excludes ads, pinned posts and avatars, and preserves exact values", () => {
  const dom = new JSDOM(`<shreddit-post promoted id="ad"></shreddit-post>
    <shreddit-post stickied id="pinned"></shreddit-post>
    <shreddit-post id="t3_abc123" post-title="A &amp; B" post-type="image" score="1234" comment-count="0" created-timestamp="2026-11-06T00:00:00Z" content-href="https://i.redd.it/media123.jpg">
      <img src="https://www.redditstatic.com/avatar.png">
      <img src="https://preview.redd.it/photo-v0-media123.jpg?width=640">
    </shreddit-post>`);
  globalThis.document = dom.window.document;
  try {
    const [post] = readRenderedPosts();
    assert.equal(readRenderedPosts().length, 1);
    assert.equal(post.attributes.score, "1234");
    assert.equal(post.attributes["comment-count"], "0");
    assert.equal(post.attributes["post-title"], "A & B");
    assert.equal(post.images.length, 1);
    assert.equal(post.images[0].url, "https://i.redd.it/media123.jpg");
  } finally {
    delete globalThis.document;
    dom.window.close();
  }
});

test("video sources survive DOM extraction without collecting discussion bodies", () => {
  const dom = new JSDOM(`<shreddit-post post-type="text"><div property="schema:articleBody"><p>Full body</p></div></shreddit-post>
    <shreddit-post post-type="video"><shreddit-player src="https://v.redd.it/video/HLSPlaylist.m3u8" poster="https://preview.redd.it/poster.jpg" packaged-media-json='{"playbackMp4s":{"duration":12,"permutations":[{"source":{"url":"https://example.com/video.mp4","dimensions":{"width":800,"height":600}}}]}}'></shreddit-player></shreddit-post>`);
  globalThis.document = dom.window.document;
  try {
    const [text, video] = readRenderedPosts({ detail: true });
    assert.equal(text.selftext, undefined);
    assert.equal(text.selftextHtml, undefined);
    assert.equal(text.mediaComplete, true);
    assert.equal(video.video.hls_url, "https://v.redd.it/video/HLSPlaylist.m3u8");
    assert.equal(video.video.dash_url, null);
    assert.equal(video.video.duration, undefined);
  } finally {
    delete globalThis.document;
    dom.window.close();
  }
});

test("listing collection preserves order and removes duplicates across scrolls", async () => {
  const raw = (id, sub = "news") => ({ attributes: { id, "subreddit-name": sub } });
  const snapshots = [[raw("t3_one"), raw("t3_foreign", "pics")], [raw("t3_one"), raw("t3_two")]];
  let scrolls = 0;
  const page = { evaluate: async (callback) => {
    if (callback === readRenderedPosts) return snapshots.shift();
    scrolls += 1;
  } };
  const result = await readListing(page, "news", 2, { log() {} }, { sleep: async () => {} });
  assert.deepEqual(result.map((post) => post.attributes.id), ["t3_one", "t3_two"]);
  assert.equal(scrolls, 1);
});

test("DASH candidates are only emitted after a successful Reddit manifest check", async () => {
  const video = { hls_url: "https://v.redd.it/media/HLSPlaylist.m3u8?token=abc" };
  const resolved = await resolveVideoManifest(video, async (url, options) => {
    assert.equal(url.pathname, "/media/DASHPlaylist.mpd");
    assert.equal(url.search, "?token=abc");
    assert.equal(options.redirect, "error");
    return { ok: true, text: async () => '<MPD type="static"></MPD>' };
  });
  assert.match(resolved.dash_url, /DASHPlaylist\.mpd/);
  const rejected = await resolveVideoManifest(video, async () => ({ ok: true, text: async () => "Access denied" }));
  assert.equal(rejected.dash_url, undefined);
  const external = { hls_url: "https://untrusted.example/media/HLSPlaylist.m3u8" };
  assert.equal(await resolveVideoManifest(external, async () => { throw new Error("Must not fetch"); }), external);
});
