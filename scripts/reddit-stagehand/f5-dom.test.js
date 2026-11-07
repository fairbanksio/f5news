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

test("link detail previews use the largest advertised signed source and deduplicate hero copies", () => {
  const small = "https://external-preview.redd.it/story-v0-media123.jpeg?width=140&height=78&s=small";
  const medium = "https://external-preview.redd.it/story-v0-media123.jpeg?width=640&s=medium";
  const full = "https://external-preview.redd.it/story-v0-media123.jpeg?width=1080&s=full";
  const dom = new JSDOM(`<shreddit-post post-type="link"><a slot="thumbnail"><img src="${small}"></a>
    <img src="${medium}" srcset="${medium} 640w, ${full} 1080w">
    <img src="${medium}" srcset="${medium} 640w, ${full} 1080w"></shreddit-post>`);
  globalThis.document = dom.window.document;
  try {
    const [post] = readRenderedPosts({ detail: true });
    assert.equal(post.thumbnail, full);
    assert.equal(post.images.length, 1);
    assert.equal(post.images[0].url, full);
    assert.equal(post.preview.images[0].source.url, full);
    assert.equal(readRenderedPosts()[0].preview, undefined);
  } finally { delete globalThis.document; dom.window.close(); }
});

test("picture sources and original links retain published image URLs", () => {
  const full = "https://preview.redd.it/media123.jpg?width=1280&s=published";
  const dom = new JSDOM(`<shreddit-post post-type="image"><picture>
    <source srcset="https://preview.redd.it/media123.jpg?width=640&amp;s=medium 640w, ${full} 1280w">
    <img width="320" src="https://preview.redd.it/media123.jpg?width=320" srcset="https://preview.redd.it/media123.jpg?width=640&amp;s=density 2x">
  </picture></shreddit-post>`);
  globalThis.document = dom.window.document;
  try {
    assert.equal(readRenderedPosts()[0].images[0].url, full);
    const image = document.querySelector('img');
    const anchor = document.createElement('a');
    anchor.href = 'https://i.redd.it/media123.jpg';
    image.replaceWith(anchor); anchor.append(image);
    assert.equal(readRenderedPosts()[0].images[0].url, anchor.href);
  } finally { delete globalThis.document; dom.window.close(); }
});

test("unusable srcset entries preserve the listing thumbnail without inventing a detail preview", () => {
  const thumbnail = "https://external-preview.redd.it/media123.jpg?width=140&s=published";
  const dom = new JSDOM(`<shreddit-post post-type="link"><a slot="thumbnail"><img src="${thumbnail}"
    srcset="javascript:alert(1) 1080w, https://user:secret@preview.redd.it/media123.jpg 1280w"></a></shreddit-post>`);
  globalThis.document = dom.window.document;
  try {
    assert.equal(readRenderedPosts()[0].thumbnail, thumbnail);
    const [post] = readRenderedPosts({ detail: true });
    assert.equal(post.thumbnail, null);
    assert.equal(post.preview, undefined);
  } finally { delete globalThis.document; dom.window.close(); }
});

test("a tiny original community image cannot outrank an advertised full article preview", () => {
  const full = "https://external-preview.redd.it/article.jpg?width=1080&s=published";
  const dom = new JSDOM(`<shreddit-post post-type="link">
    <img src="https://i.redd.it/communityicon.png" width="64" height="64">
    <img src="https://external-preview.redd.it/article.jpg?width=640&s=medium" srcset="${full} 1080w">
  </shreddit-post>`);
  globalThis.document = dom.window.document;
  try {
    const [post] = readRenderedPosts({ detail: true });
    assert.equal(post.thumbnail, full);
    assert.equal(post.preview.images[0].source.url, full);
    assert.equal(post.preview.images[0].source.width, 1080);
    assert.equal(post.images.length, 1);
  } finally { delete globalThis.document; dom.window.close(); }
});

test("tiny or unknown original images are not article detail previews", () => {
  for (const naturalWidth of [0, 64]) {
    const dom = new JSDOM('<shreddit-post post-type="link"><img src="https://i.redd.it/communityicon.png"></shreddit-post>');
    globalThis.document = dom.window.document;
    const image = document.querySelector('img');
    Object.defineProperty(image, 'naturalWidth', { value: naturalWidth });
    if (naturalWidth) image.setAttribute('width', '640');
    try {
      const [post] = readRenderedPosts({ detail: true });
      assert.equal(post.thumbnail, null);
      assert.equal(post.preview, undefined);
      assert.deepEqual(post.images, []);
    } finally { delete globalThis.document; dom.window.close(); }
  }
});

test("large measured or declared originals can be article previews while small core media remain valid", () => {
  const dom = new JSDOM(`<shreddit-post post-type="link"><img src="https://i.redd.it/photo.jpg" width="800"></shreddit-post>
    <shreddit-post post-type="image" content-href="https://i.redd.it/smallart.png"><img src="https://i.redd.it/smallart.png" width="64"></shreddit-post>
    <shreddit-post post-type="gallery"><img src="https://i.redd.it/galleryart.png" data-media-id="galleryart" width="64"></shreddit-post>`);
  globalThis.document = dom.window.document;
  try {
    const [article, image, gallery] = readRenderedPosts({ detail: true });
    assert.equal(article.preview.images[0].source.width, 800);
    assert.equal(image.images[0].url, 'https://i.redd.it/smallart.png');
    assert.equal(gallery.images[0].url, 'https://i.redd.it/galleryart.png');
    assert.equal(gallery.mediaComplete, true);
  } finally { delete globalThis.document; dom.window.close(); }
});

test("a small signed URL cannot become a full preview through a contradictory srcset descriptor", () => {
  const thumbnail = "https://external-preview.redd.it/article.jpg?width=140&s=published";
  const dom = new JSDOM(`<shreddit-post post-type="link"><img src="${thumbnail}" srcset="${thumbnail} 1080w" width="1080"></shreddit-post>`);
  globalThis.document = dom.window.document;
  try {
    const [post] = readRenderedPosts({ detail: true });
    assert.equal(post.thumbnail, null);
    assert.equal(post.preview, undefined);
    assert.deepEqual(post.images, []);
  } finally { delete globalThis.document; dom.window.close(); }
});
