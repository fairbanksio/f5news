const assert = require("node:assert/strict");
const test = require("node:test");
const { spawn } = require("node:child_process");
const { createBrowserSource, runBrowser } = require("./browser-source");
const logger = { log() {} };
const raw = (overrides = {}) => ({ attributes: {
  id: "t3_abc", "subreddit-name": "news", permalink: "/r/news/comments/abc/story/",
  "post-type": "link", "post-title": "Story", author: "reporter",
  "created-timestamp": "2026-11-06T00:00:00Z", score: "42", "comment-count": "7",
  "content-href": "https://publisher.example/story", domain: "publisher.example", ...overrides,
} });
const source = (posts, subreddit = "news") => createBrowserSource({ runBrowserImpl: async () => ({ status: "accessible", subreddit, posts }) });

test("maps browser metadata to existing database input", async () => {
  const children = await source([raw()])({ subreddit: "news", logger });
  assert.equal(children[0].data.ups, 42);
  assert.equal(children[0].data.num_comments, 7);
  assert.equal(children[0].data.created_utc, 1793923200);
  assert.equal(children[0].data.permalink, "/r/news/comments/abc/story/");
  assert.equal(children[0].data.selftext, undefined);
});

test("rejects incomplete, duplicate, wrong-subreddit and empty batches", async () => {
  for (const posts of [[raw({ score: "1k" })], [raw(), raw()], [raw({ "subreddit-name": "politics" })], []]) {
    await assert.rejects(source(posts)({ subreddit: "news", logger }));
  }
  await assert.rejects(source([raw()], "politics")({ subreddit: "news", logger }), /invalid post batch/);
});

test("validates feed, limit and time before launching", async () => {
  let calls = 0;
  const scrape = createBrowserSource({ runBrowserImpl: async () => { calls += 1; } });
  for (const config of [{ subreddit: "DIY" }, { subreddit: "news", limit: 26 }, { subreddit: "news", timeoutMs: 5000 }]) await assert.rejects(scrape(config));
  assert.equal(calls, 0);
});

test("gallery and video records retain fields used by F5", async () => {
  const gallery = { ...raw({ "post-type": "gallery" }), mediaComplete: true, images: [{ id: "photo", url: "https://i.redd.it/photo.jpg" }] };
  const [entry] = await source([gallery])({ subreddit: "news", logger });
  assert.equal(entry.data.media_metadata.photo.s.u, "https://i.redd.it/photo.jpg");
  assert.deepEqual(entry.data.gallery_data.items, [{ media_id: "photo" }]);
  const video = { ...raw({ "post-type": "video" }), mediaComplete: true, video: { dash_url: "https://v.redd.it/clip/DASHPlaylist.mpd" } };
  const [clip] = await source([video])({ subreddit: "news", logger });
  assert.equal(clip.data.media.reddit_video.dash_url, video.video.dash_url);
});

const spawnCode = (code, onSpawn = () => {}) => () => {
  const child = spawn(process.execPath, ["-e", code], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  onSpawn(child);
  return child;
};

test("browser process rejects challenges and malformed output", async () => {
  for (const code of ['console.log(JSON.stringify({status:"challenge_required"})); process.exitCode=2', 'console.log("bad JSON")']) {
    await assert.rejects(runBrowser({ subreddit: "news", limit: 25, timeoutMs: 5000, logger, spawnImpl: spawnCode(code) }), /Browser/);
  }
});

test("deadline kills and awaits an unresponsive browser process", async () => {
  let child;
  await assert.rejects(runBrowser({ subreddit: "news", limit: 25, timeoutMs: 300, logger,
    spawnImpl: spawnCode('process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)', (process) => { child = process; }),
  }), /deadline/);
  assert.equal(child.signalCode, "SIGKILL");
  assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
});

test("account login is opt-in and credential values are redacted", async () => {
  const messages = [];
  const request = { subreddit: "news", limit: 25, timeoutMs: 5000, authenticate: true,
    logger: { log: (message) => messages.push(message) }, redactionValues: ["private-login-password"],
    spawnImpl: (executable, args) => {
      assert.ok(args.includes("--authenticate"));
      return spawnCode('console.error("private-login-password"); console.log(JSON.stringify({status:"accessible",posts:[]}))')();
    },
  };
  await runBrowser(request);
  assert.ok(!messages.join().includes("private-login-password"));
  assert.ok(messages.join().includes("[redacted]"));
});


test("overlong split diagnostics never log a truncated credential", async () => {
  const messages = [];
  await runBrowser({ subreddit: "news", limit: 25, timeoutMs: 5000,
    logger: { log: (message) => messages.push(message) }, redactionValues: ["private-login-password"],
    spawnImpl: spawnCode('process.stderr.write("x".repeat(4090)+"private-login-"); setTimeout(()=>{console.error("password"); console.error("ready"); console.log(JSON.stringify({status:"accessible",posts:[]}))},100)'),
  });
  assert.ok(!messages.join().includes("password"));
  assert.ok(!messages.join().includes("private-login"));
  assert.ok(messages.join().includes("size limit"));
  assert.ok(messages.join().includes("ready"));
});

test("invalid session errors expose only whitelisted reasons", async () => {
  for (const [reason, expected] of [["root_cookie_expired", "root_cookie_expired"], ["private-cookie-value", undefined]]) {
    await assert.rejects(runBrowser({ subreddit: "news", limit: 25, timeoutMs: 5000, logger,
      spawnImpl: spawnCode(`console.log(JSON.stringify({status:"session_invalid",sessionReason:${JSON.stringify(reason)}}));process.exitCode=2`),
    }), (error) => error.message === "Browser extraction failed: session_invalid" && error.sessionReason === expected && !error.message.includes("private"));
  }
});
