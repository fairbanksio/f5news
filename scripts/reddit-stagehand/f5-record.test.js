import assert from "node:assert/strict";
import test from "node:test";
import { toF5Record } from "./f5-record.js";

const raw = (overrides = {}) => ({ attributes: {
  id: "t3_abc123", "subreddit-name": "news", permalink: "/r/news/comments/abc123/story/",
  "post-title": "Example Story", author: "reporter", "created-timestamp": "2026-11-06T05:42:36.512000+0000",
  score: "-2", "comment-count": "12", "content-href": "https://example.com/story", domain: "example.com",
  "post-type": "link", "upvote-ratio": "0.85", ...overrides,
}, thumbnail: null, selftext: null, selftextHtml: null, images: [], video: null, mediaComplete: false });
const map = (value) => toF5Record(value, "news", { fetchedAt: "2026-11-06T06:00:00Z" });

test("exact DOM fields map to API and Mongo names without inventing optional values", () => {
  const result = map(raw());
  assert.equal(result.ready, true);
  assert.equal(result.post.created_utc, 1793943756);
  assert.equal(result.post.upvoteCount, -2);
  assert.equal(result.post.commentCount, 12);
  assert.equal(result.post.fetchedAt, "2026-11-06T06:00:00.000Z");
  assert.equal("selftext" in result.post, false);
  assert.equal("thumbnail" in result.post, false);
  assert.deepEqual(result.missingFields, ["thumbnail"]);
  assert.deepEqual(Object.keys(result.post), ["title", "domain", "url", "commentLink", "author", "created_utc", "upvoteCount", "commentCount", "fetchedAt", "sub"]);
  for (const field of ["is_self", "is_gallery", "is_video", "media", "selftext", "selftext_html", "upvote_ratio", "rpan_video", "post_hint", "preview", "gallery_data"]) {
    assert.equal(field in result.reddit.data, false);
  }
  assert.equal(result.reddit.data.ups, -2);
  assert.equal(result.reddit.data.permalink, result.post.commentLink);
  assert.equal(result.reddit.kind, "t3");
  assert.equal(result.reddit.data.name, "t3_abc123");
  assert.ok(result.missingFields.includes("thumbnail"));
});

test("missing and invalid exact counts remain null instead of using rounded display text", () => {
  for (const score of ["1.2K", "12 votes", "", null, "1.5", "9007199254740992"]) {
    const result = map({ ...raw({ score }), scoreText: "1.2K" });
    assert.equal(result.post.upvoteCount, null);
    assert.equal(result.ready, false);
  }
  assert.equal(map(raw({ "comment-count": "-1" })).post.commentCount, null);
  assert.equal(map(raw({ "comment-count": "0", score: "0" })).ready, true);
});

test("timestamps reject relative ages and impossible dates and preserve equivalent offsets", () => {
  for (const date of ["2 hours ago", "2026-02-30T05:00:00Z", "2026-11-06", "2026-11-06T25:00:00Z", null]) {
    const result = map(raw({ "created-timestamp": date }));
    assert.equal(result.ready, false);
    assert.equal(result.post.created_utc, null);
  }
  assert.equal(map(raw({ "created-timestamp": "2026-11-05T21:42:36.999-08:00" })).post.created_utc, 1793943756);
});

test("IDs, paths, requested subreddit and outbound URLs must agree", () => {
  for (const override of [
    { id: "abc123" }, { id: "t3_other" }, { "subreddit-name": "science" },
    { permalink: "https://evil.example/r/news/comments/abc123/story/" },
    { permalink: "/r/news/comments/abc123/story/comment/" },
    { "content-href": "javascript:alert(1)" }, { "content-href": "https://user:secret@example.com" },
    { "post-type": "unknown" },
  ]) assert.equal(map(raw(override)).ready, false);
  for (const value of [null, undefined, [], "invalid"]) assert.equal(map(value).ready, false);
});

test("image readiness requires a full image and complete media extraction", () => {
  const image = { ...raw({ "post-type": "image" }), thumbnail: "https://cdn.example/small.jpg" };
  assert.equal(map(image).ready, false);
  image.images = [{ url: "https://cdn.example/full.jpg?x=1&amp;y=2", width: 800, height: 600 }];
  assert.equal(map(image).ready, false);
  image.mediaComplete = true;
  const result = map(image);
  assert.equal(result.ready, true);
  assert.equal(result.post.thumbnail, "https://cdn.example/full.jpg?x=1&y=2");
  assert.equal(result.reddit.data.preview.images[0].source.url, result.post.thumbnail);
  assert.equal("preview" in result.post, false);
  assert.equal(result.post.post_hint, "image");
  assert.deepEqual(result.missingFields, []);
});

test("gallery IDs preserve order and populate the current gallery contract", () => {
  const gallery = { ...raw({ "post-type": "gallery" }), mediaComplete: true,
    images: [{ id: "photo_b", url: "https://cdn.example/b.jpg" }, { id: "photo_a", url: "https://cdn.example/a.jpg" }] };
  const result = map(gallery);
  assert.equal(result.ready, true);
  assert.deepEqual(result.reddit.data.gallery_data.items, [{ media_id: "photo_b" }, { media_id: "photo_a" }]);
  assert.equal(result.post.media_metadata.photo_a.s.u, "https://cdn.example/a.jpg");
  assert.equal("gallery_data" in result.post, false);
  assert.equal(result.post.is_gallery, true);
  assert.equal(map({ ...gallery, images: [{ url: "https://cdn.example/missing-id.jpg" }] }).ready, false);
});

test("video readiness requires DASH and omits unused video metadata", () => {
  const video = { ...raw({ "post-type": "video" }), mediaComplete: true, video: { hls_url: "https://cdn.example/video.m3u8" } };
  assert.equal(map(video).ready, false);
  video.video.dash_url = "https://cdn.example/video.mpd";
  assert.equal(map(video).ready, true);
  assert.deepEqual(map(video).post.media, { reddit_video: { dash_url: "https://cdn.example/video.mpd" } });
});

test("text and mixed media only require core fields and preserve inline thumbnails", () => {
  for (const type of ["text", "multi_media"]) {
    const discussion = { ...raw({ "post-type": type }), thumbnail: "https://cdn.example/inline.jpg" };
    const result = map(discussion);
    assert.equal(result.ready, true);
    assert.equal(result.post.is_self, true);
    assert.equal(result.reddit.data.is_self, true);
    assert.equal(result.post.thumbnail, "https://cdn.example/inline.jpg");
    assert.deepEqual(result.missingFields, []);
    for (const field of ["is_gallery", "is_video", "media_metadata", "media", "selftext", "selftext_html", "upvote_ratio", "rpan_video"]) {
      assert.equal(field in result.post, false);
      assert.equal(field in result.reddit.data, false);
    }
  }
});


test("crossposts retain the parent link and the listing's own identity", () => {
  const result = map(raw({ "post-type": "crosspost", "content-href": "/r/worldnews/comments/parent/story/" }));
  assert.equal(result.ready, true);
  assert.equal(result.post.url, "https://www.reddit.com/r/worldnews/comments/parent/story/");
  assert.equal(result.post.is_self, undefined);
  assert.equal(result.reddit.data.id, "abc123");
  assert.equal(map(raw({ "post-type": "crosspost", "content-href": "//outside.example/story" })).ready, false);
  assert.equal(map(raw({ "post-type": "link", "content-href": "/r/worldnews/comments/parent/story/" })).ready, false);
});
