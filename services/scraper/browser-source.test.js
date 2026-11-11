const assert = require("node:assert/strict");
const test = require("node:test");
const { spawn } = require("node:child_process");
const { createBrowserSource, createBrowserBatchSource, runBrowser } = require("./browser-source");
const feeds = require("../posts/subreddits.json");
const { randomUUID } = require("node:crypto");
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

test("split UTF-8 bytes retain exact post titles and diagnostic redaction", async () => {
  const title = "Café 🌍 reports 東京";
  const messages = [];
  const payload = JSON.stringify({ status: "accessible", posts: [{ title }] });
  const code = `
    const output = Buffer.from(${JSON.stringify(payload)});
    const split = output.indexOf(Buffer.from("🌍")) + 2;
    process.stdout.write(output.subarray(0, split));
    process.stderr.write(Buffer.from("private-login-"));
    setTimeout(() => {
      process.stdout.write(output.subarray(split));
      console.error("password");
    }, 50);
  `;
  const result = await runBrowser({ subreddit: "news", limit: 25, timeoutMs: 5000,
    logger: { log: (line) => messages.push(line) }, redactionValues: ["private-login-password"], spawnImpl: spawnCode(code) });
  assert.equal(result.posts[0].title, title);
  assert.ok(!messages.join().includes("private-login-password"));
  assert.ok(messages.join().includes("[redacted]"));
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

test("explicit image priorities reach the browser without adding fallback candidates", async () => {
  for (const ids of [[], ["t3_target", "t3_other"]]) {
    await runBrowser({ subreddit: "news", limit: 25, timeoutMs: 5000, logger, imagePriorityIds: ids,
      spawnImpl: (_executable, args) => {
        const index = args.indexOf("--image-priority-ids");
        assert.ok(index >= 0);
        assert.equal(args[index + 1], ids.join(","));
        return spawnCode('console.log(JSON.stringify({status:"accessible",posts:[]}))')();
      },
    });
  }
  const scrape = createBrowserSource({ runBrowserImpl: async () => { throw new Error("Unexpected browser"); } });
  for (const ids of [["t3_ok", "t3_ok"], ["../../bad"], "t3_target", Array.from({ length: 26 }, (_, i) => `t3_${i}`)]) {
    await assert.rejects(scrape({ subreddit: "news", imagePriorityIds: ids }), /Invalid image priority/);
  }
});

test("exhausted GET transport errors retain their finite classification", async () => {
  await assert.rejects(runBrowser({ subreddit: "news", limit: 25, timeoutMs: 5000, logger,
    spawnImpl: spawnCode('console.log(JSON.stringify({status:"network_error",sessionReason:"navigation_network_error"}));process.exitCode=2'),
  }), (error) => error.message === "Browser extraction failed: network_error" && error.sessionReason === "navigation_network_error");
});

test("explicit HTTP navigation failures preserve only bounded diagnostic fields", async () => {
  for (const [reason, httpStatus, retryAfterSeconds] of [
    ["navigation_http_rejected", 401, 0], ["navigation_http_rejected", 403, 60], ["navigation_rate_limited", 429, 86400],
  ]) {
    const result = { status: "session_invalid", sessionReason: reason, httpStatus, retryAfterSeconds };
    await assert.rejects(runBrowser({ subreddit: "news", limit: 25, timeoutMs: 5000, logger,
      spawnImpl: spawnCode(`console.log(${JSON.stringify(JSON.stringify(result))});process.exitCode=2`),
    }), (error) => error.sessionReason === reason && error.httpStatus === httpStatus && error.retryAfterSeconds === retryAfterSeconds);
  }
});

test("untrusted HTTP diagnostic values never reach browser errors", async () => {
  for (const [httpStatus, retryAfterSeconds] of [["private-cookie-value", "private-cookie-value"], [500, 86401], [200, -1], ["403", 0.5]]) {
    const result = { status: "session_invalid", sessionReason: "navigation_http_rejected", httpStatus, retryAfterSeconds };
    await assert.rejects(runBrowser({ subreddit: "news", limit: 25, timeoutMs: 5000, logger,
      spawnImpl: spawnCode(`console.log(${JSON.stringify(JSON.stringify(result))});process.exitCode=2`),
    }), (error) => error.sessionReason === "navigation_http_rejected" && !Object.hasOwn(error, "httpStatus") &&
      !Object.hasOwn(error, "retryAfterSeconds") && !JSON.stringify(error).includes("private-cookie-value"));
  }
});

test("successful extraction retains an observed optional-navigation rate limit without private fields", async () => {
  const messages = [];
  const event = { eventType: "BROWSER_NAVIGATION_HTTP", status: 429, retryAfterSeconds: 60,
    contentLength: 0, challenge: false, url: "https://private.example/account", headers: { cookie: "private-cookie-value" }, account: "private-account" };
  const result = await runBrowser({ subreddit: "news", limit: 25, timeoutMs: 5000, logger: { log: (line) => messages.push(line) },
    spawnImpl: spawnCode(`console.error(${JSON.stringify(JSON.stringify(event))});console.log(JSON.stringify({status:"accessible",posts:[]}))`),
  });
  assert.deepEqual(result.navigationRateLimit, { httpStatus: 429, retryAfterSeconds: 60 });
  assert.deepEqual(result.posts, []);
  assert.ok(!JSON.stringify(result.navigationRateLimit).includes("private"));
  assert.ok(!messages.join().includes("private"));
});

test("the navigation observer requires an exact event type and numeric 429", async () => {
  for (const event of [{ eventType: "BROWSER_NAVIGATION_HTTP", status: 403 }, { eventType: "BROWSER_NAVIGATION_HTTP", status: 500 },
    { eventType: "BROWSER_NAVIGATION_HTTP", status: "429" }, { eventType: "BROWSER_NAVIGATION_HTTP", status: 429.5 },
    { eventType: "BROWSER_NAVIGATION_HTTP_OTHER", status: 429 }]) {
    const result = await runBrowser({ subreddit: "news", limit: 25, timeoutMs: 5000, logger,
      spawnImpl: spawnCode(`console.error(${JSON.stringify(JSON.stringify(event))});console.log(JSON.stringify({status:"accessible",posts:[],navigationRateLimit:{httpStatus:429,private:"untrusted-output"}}))`),
    });
    assert.ok(!Object.hasOwn(result, "navigationRateLimit"));
  }
});

test("rate-limit observations discard invalid retry delays and retain the longest valid delay", async () => {
  for (const retryAfterSeconds of ["private-cookie-value", -1, 86401, 1.5, null]) {
    const event = { eventType: "BROWSER_NAVIGATION_HTTP", status: 429, retryAfterSeconds };
    const messages = [];
    const result = await runBrowser({ subreddit: "news", limit: 25, timeoutMs: 5000, logger: { log: (line) => messages.push(line) },
      spawnImpl: spawnCode(`console.error(${JSON.stringify(JSON.stringify(event))});console.log(JSON.stringify({status:"accessible",posts:[]}))`),
    });
    assert.deepEqual(result.navigationRateLimit, { httpStatus: 429 });
    assert.ok(!messages.join().includes("private-cookie-value"));
  }
  const result = await runBrowser({ subreddit: "news", limit: 25, timeoutMs: 5000, logger,
    spawnImpl: spawnCode('for(const retryAfterSeconds of [300,60,0]) console.error(JSON.stringify({eventType:"BROWSER_NAVIGATION_HTTP",status:429,retryAfterSeconds}));console.log(JSON.stringify({status:"accessible",posts:[]}))'),
  });
  assert.deepEqual(result.navigationRateLimit, { httpStatus: 429, retryAfterSeconds: 300 });
});

test("failed extraction rejects normally even when stderr also observes a 429", async () => {
  await assert.rejects(runBrowser({ subreddit: "news", limit: 25, timeoutMs: 5000, logger,
    spawnImpl: spawnCode('console.error(JSON.stringify({eventType:"BROWSER_NAVIGATION_HTTP",status:429,retryAfterSeconds:60}));console.log(JSON.stringify({status:"session_invalid",sessionReason:"navigation_rate_limited",httpStatus:429,retryAfterSeconds:60}));process.exitCode=2'),
  }), (error) => error.sessionReason === "navigation_rate_limited" && error.httpStatus === 429 && !Object.hasOwn(error, "navigationRateLimit"));
});

const batchRaw = (subreddit, id = "abc") => ({ ...raw({ id: `t3_${id}`, "subreddit-name": subreddit, permalink: `/r/${subreddit}/comments/${id}/story/` }) });
const completeBatch = () => ({ status: "accessible", feeds: feeds.map((subreddit) => ({ subreddit, posts: [batchRaw(subreddit)] })) });

test("one session runner and one browser produce every configured feed with normal F5 fields", async () => {
  let sessions = 0;
  let browsers = 0;
  const generation = randomUUID();
  const scrape = createBrowserBatchSource({
    runBrowserImpl: async (request) => {
      browsers++;
      assert.equal(request.allFeeds, true);
      assert.equal(request.timeoutMs, 151000);
      return completeBatch();
    },
    sessionRunner: async (request, run) => {
      sessions++;
      return { ...await run(request), sessionMode: "reused", sessionGeneration: generation, sessionRenewalDeferred: true };
    },
  });
  const result = await scrape({ logger });
  assert.equal(sessions, 1);
  assert.equal(browsers, 1);
  assert.deepEqual(result.feeds.map((entry) => entry.subreddit), feeds);
  assert.ok(result.feeds.every((entry) => entry.children[0].data.ups === 42 && entry.children[0].data.num_comments === 7));
  assert.deepEqual(result.failures, []);
  assert.equal(result.sessionMode, "reused");
  assert.equal(result.sessionGeneration, generation);
  assert.equal(result.sessionRenewalDeferred, true);
});

test("batch flags and explicit empty priorities reach Python as one JSON map", async () => {
  const map = { politics: ["t3_abc"], [feeds.at(-1)]: [] };
  await runBrowser({ subreddit: "politics", allFeeds: true, imagePriorityIdsBySubreddit: map, limit: 25, timeoutMs: 5000, logger,
    spawnImpl: (_executable, args) => {
      assert.ok(args.includes("--all-feeds"));
      assert.equal(args[args.indexOf("--batch-budget-seconds") + 1], "1");
      assert.ok(!args.includes("--subreddit"));
      assert.ok(!args.includes("--image-priority-ids"));
      assert.deepEqual(JSON.parse(args[args.indexOf("--image-priority-map") + 1]), map);
      return spawnCode(`console.log(${JSON.stringify(JSON.stringify(completeBatch()))})`)();
    },
  });
});

test("the batch browser budget follows the remaining child deadline and reserves teardown time", async () => {
  for (const [timeoutMs, seconds] of [[151000, 141], [34000, 24], [400000, 180]]) {
    await runBrowser({ allFeeds: true, limit: 25, timeoutMs, logger,
      spawnImpl: (_executable, args) => {
        assert.equal(args[args.indexOf("--batch-budget-seconds") + 1], String(seconds));
        return spawnCode(`console.log(${JSON.stringify(JSON.stringify(completeBatch()))})`)();
      },
    });
  }
});

test("batch validates target order, limits, and priority maps before any browser or session launch", async () => {
  const unexpected = async () => assert.fail("Invalid options must not launch");
  const scrape = createBrowserBatchSource({ runBrowserImpl: unexpected, sessionRunner: unexpected });
  for (const request of [{ subreddits: ["politics"] }, { subreddits: [...feeds].reverse() }, { limit: 26 }, { timeoutMs: 9000 },
    ...[null, [], { economics: [] }, { news: ["../../bad"] }, { news: ["t3_abc", "t3_abc"] }, { news: undefined }].map((imagePriorityIdsBySubreddit) => ({ imagePriorityIdsBySubreddit }))]) {
    await assert.rejects(scrape(request));
  }
});

test("batch accepts only an exact ordered prefix with a failure on the next feed", async () => {
  const first = completeBatch().feeds[0];
  const valid = { status: "accessible", feeds: [first], batchFailure: { subreddit: feeds[1], status: "session_invalid", sessionReason: "navigation_rate_limited", httpStatus: 429, retryAfterSeconds: 60 } };
  const result = await createBrowserBatchSource({ runBrowserImpl: async () => valid })({ session: false, logger });
  assert.deepEqual(result.feeds.map((entry) => entry.subreddit), [feeds[0]]);
  assert.deepEqual(result.batchFailure, valid.batchFailure);
  for (const response of [
    { status: "accessible", feeds: [first] },
    { ...valid, feeds: [] },
    { ...valid, feeds: [first, first] },
    { ...valid, feeds: [completeBatch().feeds[1]] },
    { ...valid, batchFailure: { subreddit: feeds[2], status: "network_error" } },
    { ...valid, batchFailure: { subreddit: feeds[1], status: "private-provider-details" } },
    { ...completeBatch(), batchFailure: { status: "runtime_error" } },
    { ...valid, feeds: [{ ...first, posts: [] }] },
    { ...valid, feeds: [{ ...first, posts: Array.from({ length: 26 }, () => first.posts[0]) }] },
  ]) await assert.rejects(createBrowserBatchSource({ runBrowserImpl: async () => response })({ session: false, logger }), /invalid|incomplete/);
});

test("one feed's invalid metadata does not discard valid neighbors or invoke another browser", async () => {
  const invalidPosts = [
    [batchRaw(feeds[1], "same"), batchRaw(feeds[1], "same")],
    [batchRaw(feeds[1])],
    [{ ...batchRaw(feeds[1]), attributes: { ...batchRaw(feeds[1]).attributes, "post-type": "video" }, mediaComplete: true, video: { dash_url: null } }],
  ];
  invalidPosts[1][0].attributes.score = "private-invalid-value";
  for (const posts of invalidPosts) {
    const response = completeBatch();
    response.feeds[1].posts = posts;
    const messages = [];
    let calls = 0;
    const result = await createBrowserBatchSource({ runBrowserImpl: async () => { calls++; return response; } })({ session: false, logger: { log: (line) => messages.push(line) } });
    assert.equal(calls, 1);
    assert.deepEqual(result.failures, [{ subreddit: feeds[1], status: "metadata_invalid" }]);
    assert.deepEqual(result.feeds.map((entry) => entry.subreddit), feeds.filter((_name, index) => index !== 1));
    assert.ok(!messages.join().includes("private-invalid-value"));
  }
});

test("partial batch diagnostics retain only validated fields and the backoff persistence marker", async () => {
  const response = { status: "accessible", feeds: completeBatch().feeds.slice(0, 1), readBackoffFailed: true,
    batchFailure: { subreddit: feeds[1], status: "network_error", sessionReason: "private-cookie-value", httpStatus: "403", retryAfterSeconds: 86401, message: "private-cookie-value" } };
  const result = await createBrowserBatchSource({ runBrowserImpl: async () => response })({ session: false, logger });
  assert.deepEqual(result.batchFailure, { subreddit: feeds[1], status: "network_error" });
  assert.equal(result.readBackoffFailed, true);
  assert.ok(!JSON.stringify(result).includes("private-cookie-value"));
});

test("optional-preview rate limiting preserves the current feed and its finite stop marker", async () => {
  const response = { status: "accessible", feeds: completeBatch().feeds.slice(0, 2),
    batchFailure: { subreddit: feeds[1], stage: "optional_preview", status: "network_error", sessionReason: "navigation_rate_limited", httpStatus: 429, retryAfterSeconds: 60 } };
  const scrape = (result) => createBrowserBatchSource({ runBrowserImpl: async () => result })({ session: false, logger });
  const result = await scrape(response);
  assert.deepEqual(result.feeds.map((entry) => entry.subreddit), feeds.slice(0, 2));
  assert.deepEqual(result.batchFailure, response.batchFailure);
  const challenge = { subreddit: feeds[1], stage: "optional_preview", status: "session_invalid", sessionReason: "feed_challenge" };
  const challenged = await scrape({ ...response, batchFailure: challenge });
  assert.deepEqual(challenged.feeds.map((entry) => entry.subreddit), feeds.slice(0, 2));
  assert.deepEqual(challenged.batchFailure, challenge);
  const finalFeed = await scrape({ ...completeBatch(), batchFailure: { ...response.batchFailure, subreddit: feeds.at(-1), status: "session_invalid" } });
  assert.equal(finalFeed.feeds.length, feeds.length);
  for (const change of [{ subreddit: feeds[0] }, { subreddit: feeds[2] }, { stage: "private-stage" }, { httpStatus: 403 }, { sessionReason: "navigation_http_rejected" }, { status: "runtime_error" }, { stage: "feed" }]) {
    await assert.rejects(scrape({ ...response, batchFailure: { ...response.batchFailure, ...change } }), /invalid batch failure/);
  }
});

test("a failure before the first completed batch feed retains ordinary failure behavior", async () => {
  await assert.rejects(runBrowser({ allFeeds: true, limit: 25, timeoutMs: 5000, logger,
    spawnImpl: spawnCode('console.log(JSON.stringify({status:"session_invalid",sessionReason:"navigation_rate_limited",httpStatus:429,retryAfterSeconds:60}));process.exitCode=2'),
  }), (error) => error.sessionReason === "navigation_rate_limited" && error.httpStatus === 429 && error.retryAfterSeconds === 60);
  await assert.rejects(runBrowser({ allFeeds: true, limit: 25, timeoutMs: 5000, logger,
    spawnImpl: spawnCode('console.log(JSON.stringify({status:"session_invalid",sessionReason:"feed_challenge",httpStatus:403,retryAfterSeconds:120}));process.exitCode=2'),
  }), (error) => error.sessionReason === "feed_challenge" && error.httpStatus === 403 && error.retryAfterSeconds === 120);
});

const batchVideo = (subreddit, id = "abc") => ({ ...batchRaw(subreddit, id),
  attributes: { ...batchRaw(subreddit, id).attributes, "post-type": "video" }, mediaComplete: true,
  video: { hls_url: `https://v.redd.it/${id}/HLSPlaylist.m3u8` } });

test("batch media resolution aborts with the overall deadline while retaining CPU-only feeds", async () => {
  const response = completeBatch();
  response.feeds[0].posts = [batchVideo(feeds[0])];
  let instant = 0;
  let observed;
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const result = await createBrowserBatchSource({ now: () => instant,
      runBrowserImpl: async () => { instant = 980; return response; },
      fetchImpl: async (_url, options) => {
        observed = options.signal;
        return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
      },
    })({ session: false, timeoutMs: 10000, logger });
    assert.equal(observed.aborted, true);
    assert.deepEqual(result.failures, [{ subreddit: feeds[0], status: "metadata_invalid" }]);
    assert.deepEqual(result.feeds.map((entry) => entry.subreddit), feeds.slice(1));
  } finally { clearTimeout(keepAlive); }
});

test("mapping starts no further manifest requests after its shared time budget is exhausted", async () => {
  const response = completeBatch();
  response.feeds.forEach((entry, index) => { entry.posts = [batchVideo(entry.subreddit, `clip${index}`)]; });
  let instant = 0;
  let calls = 0;
  const result = await createBrowserBatchSource({ now: () => instant, runBrowserImpl: async () => response,
    fetchImpl: async () => {
      calls++;
      instant = 10000;
      return { ok: true, text: async () => "<MPD />" };
    },
  })({ session: false, timeoutMs: 10000, logger });
  assert.equal(calls, 1);
  assert.deepEqual(result.feeds.map((entry) => entry.subreddit), [feeds[0]]);
  assert.deepEqual(result.failures.map((entry) => entry.subreddit), feeds.slice(1));
});

test("two mapping workers retain configured feed order when manifests finish out of order", async () => {
  const response = completeBatch();
  response.feeds[0].posts = [batchVideo(feeds[0], "first")];
  response.feeds[1].posts = [batchVideo(feeds[1], "second")];
  let releaseFirst;
  const first = new Promise((resolve) => { releaseFirst = resolve; });
  const finished = [];
  let active = 0;
  let peak = 0;
  const result = await createBrowserBatchSource({ runBrowserImpl: async () => response,
    fetchImpl: async (url) => {
      active++;
      peak = Math.max(peak, active);
      if (url.pathname.includes("first")) await first;
      else releaseFirst();
      finished.push(url.pathname);
      active--;
      return { ok: true, text: async () => "<MPD />" };
    },
  })({ session: false, logger });
  assert.equal(peak, 2);
  assert.ok(finished[0].includes("second"));
  assert.deepEqual(result.feeds.map((entry) => entry.subreddit), feeds);
  assert.deepEqual(result.failures, []);
});
