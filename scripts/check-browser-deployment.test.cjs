const test = require("node:test");
const assert = require("node:assert/strict");
const { checkInvocation, failureSummary, verifyFeeds, verifyScheduled, FEEDS } = require("./check-browser-deployment.cjs");
const response = (fields = {}) => ({ StatusCode: 200, LogResult: Buffer.from('request prefix\t' + JSON.stringify({ eventType: "SCRAPER_JOB_COMPLETED", outcome: "success", fetchedCount: 25, savedCount: 25, ...fields })).toString("base64") });
test("deployment probe accepts saved posts and optional image degradation", () => {
  assert.equal(checkInvocation(response()).savedCount, 25);
  assert.equal(checkInvocation(response({ outcome: "degraded" })).outcome, "degraded");
});
test("deployment probe rejects Lambda errors despite HTTP success", () => {
  assert.throws(() => checkInvocation({ ...response(), FunctionError: "Unhandled" }));
});
test("deployment probe rejects missing terminal logs and incomplete writes", () => {
  for (const result of [{ StatusCode: 200 }, response({ fetchedCount: 0, savedCount: 0 }), response({ savedCount: 24 }), response({ outcome: "failed" })]) assert.throws(() => checkInvocation(result));
});


test("failed probe summaries omit secrets, URLs, and stacks", () => {
  const result = failureSummary({}, { errorType: "Runtime.ImportModuleError", errorMessage: "missing handler bearer private-token https://private.example/path?token=hidden password=hidden env-secret-value", stack: "private-stack" }, { API_KEY: "env-secret-value" });
  const output = JSON.stringify(result);
  for (const secret of ["private-token", "private.example", "hidden", "env-secret-value", "private-stack"]) assert.ok(!output.includes(secret));
  assert.equal(result.errorType, "Runtime.ImportModuleError");
  assert.equal(failureSummary({}, { errorType: "MongoServerSelectionError", errorMessage: "private database host" }).errorMessage, "Database operation failed");
});

test("failed probe summaries include only browser failure messages", () => {
  const logs = [
    { eventType: "POST_BATCH", privateData: "private-post" },
    { eventType: "BROWSER_PROGRESS", message: "Launching browser." },
    { eventType: "BROWSER_PROGRESS", message: "Browser test failed (PermissionError): Read-only filesystem" },
    { eventType: "BROWSER_PROGRESS", message: "[128] SandboxBroker: Operation not permitted" },
    { eventType: "BROWSER_PROGRESS", message: "    at SandboxHandler (/private-stack.js:1)" },
  ];
  const summary = failureSummary({ LogResult: Buffer.from(logs.map(JSON.stringify).join("\n")).toString("base64") }, {});
  assert.deepEqual(summary.browserErrors, [logs[2].message, logs[3].message]);
  assert.ok(!JSON.stringify(summary).includes("private-post"));
});


test("bootstrap diagnostics keep error messages and omit stack frames", () => {
  const lines = [
    "Error: Cannot find module /var/task/index", "    at privateStack (/private/stack.js:10)",
    JSON.stringify({ errorType: "Runtime.ImportModuleError", errorMessage: "missing handler https://private.example/path?token=hidden", stack: ["private-stack"] }),
  ];
  const result = failureSummary({ LogResult: Buffer.from(lines.join("\n")).toString("base64") }, {});
  assert.ok(result.startupErrors.includes(lines[0]));
  const output = JSON.stringify(result);
  for (const secret of ["privateStack", "private-stack", "private.example", "hidden"]) assert.ok(!output.includes(secret));
});

const sharedResponse = (fields = {}) => response({ sessionMode: "reused", sessionGeneration: "generation-1", ...fields });

test("all-feed verification invokes every feed sequentially and proves session reuse", async () => {
  const calls = [];
  const lines = [];
  let active = 0;
  const { summary } = await verifyFeeds({ allFeeds: true, emit: (line) => lines.push(JSON.parse(line)), invoke: async (event) => {
    active += 1;
    assert.equal(active, 1);
    calls.push(event);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return sharedResponse({ sessionMode: calls.length === 1 ? "renewed" : "reused" });
  } });
  assert.deepEqual(calls, [...FEEDS, "politics"].map((subreddit) => ({ subreddit, session: true })));
  assert.equal(calls.length, 12);
  assert.equal(new Set(FEEDS).size, 11);
  assert.deepEqual(summary, { eventType: "BROWSER_LIVE_PROBE_COMPLETED", feedCount: 11, invocationCount: 12,
    savedCount: 300, renewalRequested: false, sessionGeneration: "generation-1", renewedCount: 1, reusedCount: 11 });
  assert.equal(lines.at(-2).repeated, true);
  assert.equal(lines.filter((entry) => entry.eventType === "BROWSER_LIVE_PROBE").length, 12);
});

test("all-feed verification forbids repeated logins and missing session mode", async () => {
  let invocations = 0;
  const invoke = async () => { invocations += 1; return response(); };
  for (const options of [{ authenticate: true }, { session: false }]) {
    await assert.rejects(verifyFeeds({ allFeeds: true, ...options, invoke, emit: () => {} }));
  }
  assert.equal(invocations, 0);
  await assert.rejects(verifyFeeds({ allFeeds: true, invoke, emit: () => {} }), /session reuse or renewal/);
  assert.equal(invocations, 1);
});

test("all-feed verification rejects changed generations or repeated renewals", async () => {
  for (const fields of [{ sessionGeneration: "generation-2" }, { sessionMode: "renewed" }]) {
    let invocations = 0;
    await assert.rejects(verifyFeeds({ allFeeds: true, emit: () => {}, invoke: async () => {
      invocations += 1;
      return sharedResponse(invocations > 1 ? fields : { sessionMode: "renewed" });
    } }));
    assert.equal(invocations, 2);
  }
});

test("all-feed verification stops on a feed without saved posts", async () => {
  let invocations = 0;
  const lines = [];
  await assert.rejects(verifyFeeds({ allFeeds: true, emit: (line) => lines.push(JSON.parse(line)), invoke: async () => {
    invocations += 1;
    return invocations === 3 ? sharedResponse({ fetchedCount: 0, savedCount: 0 }) : sharedResponse();
  } }), /no usable posts/);
  assert.equal(invocations, 3);
  assert.equal(lines.length, 2);
});

test("single-feed bootstrap authenticates once and does not claim shared session proof", async () => {
  const events = [];
  const { summary } = await verifyFeeds({ authenticate: true, emit: () => {}, invoke: async (event) => {
    events.push(event);
    return response();
  } });
  assert.deepEqual(events, [{ subreddit: "politics", authenticate: true, session: false }]);
  assert.equal(summary.sessionGeneration, undefined);
});

test("session proof excludes malformed identifiers and unrelated terminal fields", () => {
  assert.throws(() => checkInvocation(sharedResponse({ sessionGeneration: "unsafe\nidentifier" }), { session: true }));
  const result = checkInvocation(sharedResponse({ privateData: "private-marker", sessionCookie: "private-cookie" }), { session: true });
  assert.equal(JSON.stringify(result).includes("private"), false);
});


test("requested all-feed renewal runs once and every later invocation reuses it", async () => {
  const calls = [];
  const { summary } = await verifyFeeds({ allFeeds: true, renewSession: true, emit: () => {}, invoke: async (event) => {
    calls.push(event);
    return sharedResponse({ sessionMode: calls.length === 1 ? "renewed" : "reused", sessionGeneration: "new-generation" });
  } });
  assert.deepEqual(calls[0], { subreddit: "politics", session: true, renewSession: true });
  assert.deepEqual(calls.slice(1), [...FEEDS.slice(1), "politics"].map((subreddit) => ({ subreddit, session: true })));
  assert.equal(summary.renewalRequested, true);
  assert.equal(summary.renewedCount, 1);
  assert.equal(summary.reusedCount, 11);
});

test("single-feed renewal uses the shared coordinator", async () => {
  const calls = [];
  const { summary } = await verifyFeeds({ renewSession: true, emit: () => {}, invoke: async (event) => {
    calls.push(event);
    return sharedResponse({ sessionMode: "renewed" });
  } });
  assert.deepEqual(calls, [{ subreddit: "politics", session: true, renewSession: true }]);
  assert.equal(summary.renewedCount, 1);
});

test("renewal forbids bootstrap authentication and disabled sessions", async () => {
  let invocations = 0;
  for (const options of [{ authenticate: true }, { session: false }]) {
    await assert.rejects(verifyFeeds({ ...options, renewSession: true, emit: () => {}, invoke: async () => {
      invocations += 1;
      return sharedResponse();
    } }), /renewal requires/);
  }
  assert.equal(invocations, 0);
});

test("requested renewal fails immediately when the terminal record reports reuse", async () => {
  let invocations = 0;
  await assert.rejects(verifyFeeds({ allFeeds: true, renewSession: true, emit: () => {}, invoke: async () => {
    invocations += 1;
    return sharedResponse();
  } }), /did not create a renewed session/);
  assert.equal(invocations, 1);
});


test("anonymous verification explicitly disables deployed shared-session defaults", async () => {
  const calls = [];
  await verifyFeeds({ session: false, emit: () => {}, invoke: async (event) => {
    calls.push(event);
    return response();
  } });
  assert.deepEqual(calls, [{ subreddit: "politics", session: false }]);
});


const scheduledEvent = (subreddit, timestamp, fields = {}) => ({ timestamp,
  message: JSON.stringify({ message: JSON.stringify({ eventType: "SCRAPER_JOB_COMPLETED", trigger: "schedule", subreddit,
    outcome: "success", fetchedCount: 25, savedCount: 25, sessionMode: "reused", sessionGeneration: "generation-1", ...fields }) }),
});

test("scheduled verification reads all fresh feed completions and emits only safe counts", async () => {
  const lines = [];
  const starts = [];
  const summary = await verifyScheduled({ now: () => 1000, readEvents: async (start) => {
    starts.push(start);
    return FEEDS.map((feed) => scheduledEvent(feed, 1001, { privateData: "private-marker" }));
  }, emit: (line) => lines.push(line) });
  assert.deepEqual(starts, [1000]);
  assert.equal(summary.feedCount, 11);
  assert.equal(summary.savedCount, 275);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes("private-marker"), false);
});

test("scheduled verification ignores stale or manual runs and polls to a fresh schedule", async () => {
  let clock = 1000;
  let reads = 0;
  const summary = await verifyScheduled({ now: () => clock, timeoutMs: 30000, sleep: async (ms) => { clock += ms; },
    readEvents: async () => {
      reads += 1;
      return FEEDS.map((feed) => scheduledEvent(feed, reads === 1 ? 999 : 1001)).concat(
        FEEDS.map((feed) => scheduledEvent(feed, 1002, { trigger: "manual" })));
    }, emit: () => {} });
  assert.equal(reads, 2);
  assert.equal(clock, 16000);
  assert.equal(summary.feedCount, 11);
});

test("scheduled verification allows a later completion to recover a failed feed", async () => {
  let clock = 1000;
  let reads = 0;
  const summary = await verifyScheduled({ now: () => clock, timeoutMs: 30000, sleep: async (ms) => { clock += ms; },
    readEvents: async () => {
      reads += 1;
      return FEEDS.map((feed) => scheduledEvent(feed, 1001, feed === "politics" && reads === 1
        ? { eventType: "SCRAPER_JOB_FAILED", outcome: "failed", errorMessage: "private-error" } : {}));
    }, emit: () => {} });
  assert.equal(reads, 2);
  assert.equal(summary.feedCount, 11);
});

test("scheduled verification rejects missing feeds, missing session proof, and partial writes at its deadline", async () => {
  for (const fields of [{ savedCount: 0 }, { sessionMode: undefined }, { eventType: "SCRAPER_JOB_FAILED", errorMessage: "private-error" }]) {
    let clock = 1000;
    const lines = [];
    await assert.rejects(verifyScheduled({ now: () => clock, timeoutMs: 30000, sleep: async (ms) => { clock += ms; },
      readEvents: async () => FEEDS.map((feed) => scheduledEvent(feed, 1001, feed === "politics" ? fields : {})),
      emit: (line) => lines.push(JSON.parse(line)),
    }), /politics/);
    assert.equal(clock, 31000);
    assert.deepEqual(lines[0].pendingFeeds, ["politics"]);
    assert.equal(JSON.stringify(lines).includes("private-error"), false);
  }
});

test("scheduled verification requires every feed and rejects a newer failure after success", async () => {
  const complete = FEEDS.map((feed) => scheduledEvent(feed, 1001));
  for (const events of [complete.slice(1), [...complete, scheduledEvent("politics", 1002, { eventType: "SCRAPER_JOB_FAILED" })]]) {
    await assert.rejects(verifyScheduled({ now: () => 1000, timeoutMs: 0,
      readEvents: async () => events, emit: () => {},
    }), /politics/);
  }
});
