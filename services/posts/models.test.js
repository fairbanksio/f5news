const assert = require("node:assert/strict");
const test = require("node:test");

test("fetchedAt defaults to each document's creation time", (t) => {
  const firstTime = Date.parse("2026-10-01T12:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now: firstTime });
  const Post = require("./models/post");
  const first = new Post();
  t.mock.timers.setTime(firstTime + 60000);
  const second = new Post();
  assert.equal(first.fetchedAt.getTime(), firstTime);
  assert.equal(second.fetchedAt.getTime(), firstTime + 60000);
});

test("explicit fetchedAt values are preserved", () => {
  const Post = require("./models/post");
  const observedAt = new Date("2026-09-01T12:00:00Z");
  assert.equal(new Post({ fetchedAt: observedAt }).fetchedAt.getTime(), observedAt.getTime());
});
