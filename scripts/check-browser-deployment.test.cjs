const test = require("node:test");
const assert = require("node:assert/strict");
const { checkInvocation, checkBatchInvocation, failureSummary, verifyFeeds: verifyFeedsImpl, verifyScheduled, verifySessionDiagnostics, summarizeRuntimeEvents, selectVerificationMode, runVerification, FEEDS } = require("./check-browser-deployment.cjs");
const verifyFeeds = (options) => verifyFeedsImpl({ sleep: async () => {}, ...options });
const { generateKeyPairSync, privateDecrypt, createDecipheriv, constants } = require("node:crypto");
const diagnosticKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const diagnosticPublicKey = diagnosticKeys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const decryptDiagnostics = (envelope) => {
  const key = privateDecrypt({ key: diagnosticKeys.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(envelope.wrappedKey, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8"));
};
const response = (fields = {}) => ({ StatusCode: 200, LogResult: Buffer.from('request prefix\t' + JSON.stringify({ eventType: "SCRAPER_JOB_COMPLETED", outcome: "success", fetchedCount: 25, savedCount: 25, ...fields })).toString("base64") });

test("manual publisher backfill invokes one selected feed and reports aggregate counts only", async () => {
  const env = { F5_PROBE_PUBLISHER_IMAGE_BACKFILL: "true", F5_PROBE_SUBREDDIT: "politics", F5_PROBE_SESSION: "true" };
  const summary = { eventType: "PUBLISHER_IMAGE_BACKFILL_COMPLETED", subreddit: "politics", candidates: 2,
    attempts: 2, updated: 1, errors: 0, dependencyFailures: 0, deferred: false };
  const invocations = [];
  const logs = [];
  const invoke = async (event) => {
    invocations.push(event);
    return { StatusCode: 200, PublisherBackfillResult: { ...summary, privateUrl: "https://private.example" } };
  };
  assert.deepEqual(await runVerification({ env, invoke, emit: (log) => logs.push(JSON.parse(log)) }), summary);
  assert.deepEqual(logs, [summary]);
  await assert.rejects(runVerification({ env: { ...env, F5_PROBE_ALL_FEEDS: "true" }, invoke }), /by itself/);
  assert.deepEqual(invocations, [{ publisherImageBackfill: true, subreddit: "politics" }]);
});

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

const batchResponse = (fields = {}, feedFields = {}) => ({ StatusCode: 200,
  // The tail may omit early feeds; the handler payload is the batch authority.
  LogResult: sharedResponse().LogResult,
  BatchResult: { sessionMode: "renewed", sessionGeneration: "generation-1",
    feedResults: FEEDS.map((subreddit) => ({ subreddit, outcome: "success", fetchedCount: 25, savedCount: 25,
      sessionMode: "renewed", sessionGeneration: "generation-1", ...feedFields })), ...fields },
});

test("all-feed verification reuses one batch then proves persisted reuse in one fresh invocation", async () => {
  const calls = [];
  const lines = [];
  const delays = [];
  let active = 0;
  const { summary } = await verifyFeeds({ allFeeds: true, sleep: async (ms) => {
    assert.deepEqual(calls, [{ allFeeds: true, session: true }]);
    delays.push(ms);
  }, emit: (line) => lines.push(JSON.parse(line)), invoke: async (event) => {
    active += 1;
    assert.equal(active, 1);
    calls.push(event);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return event.allFeeds ? batchResponse({ sessionMode: "reused" }, { sessionMode: "reused" }) : sharedResponse();
  } });
  assert.deepEqual(calls, [{ allFeeds: true, session: true }, { subreddit: "politics", session: true }]);
  assert.deepEqual(delays, [300000]);
  assert.deepEqual(lines.find((entry) => entry.eventType === "BROWSER_LIVE_PROBE_WAITING"), { eventType: "BROWSER_LIVE_PROBE_WAITING", seconds: 300 });
  assert.deepEqual(FEEDS, ["politics"]);
  assert.deepEqual(summary, { eventType: "BROWSER_LIVE_PROBE_COMPLETED", feedCount: FEEDS.length, invocationCount: 2,
    savedCount: (FEEDS.length + 1) * 25, renewalRequested: false, initialGeneration: "generation-1", sessionGeneration: "generation-1", generationCount: 1, renewedCount: 0, reusedCount: 2 });
  assert.equal(lines.at(-2).repeated, true);
  assert.equal(lines.filter((entry) => entry.eventType === "BROWSER_LIVE_PROBE").length, FEEDS.length + 1);
});

test("default all-feed verification accepts a naturally renewed batch without requesting login", async () => {
  const calls = [];
  const { summary } = await verifyFeeds({ allFeeds: true, emit: () => {}, invoke: async (event) => {
    calls.push(event);
    return event.allFeeds ? batchResponse() : sharedResponse();
  } });
  assert.deepEqual(calls, [{ allFeeds: true, session: true }, { subreddit: "politics", session: true }]);
  assert.equal(summary.renewalRequested, false);
  assert.equal(summary.renewedCount, 1);
  assert.equal(summary.reusedCount, 1);
});

test("all-feed verification forbids bootstrap and disabled sessions before invoking", async () => {
  let invocations = 0;
  for (const options of [{ authenticate: true }, { session: false }]) {
    await assert.rejects(verifyFeeds({ allFeeds: true, ...options, invoke: async () => { invocations += 1; }, emit: () => {} }));
  }
  assert.equal(invocations, 0);
});

test("batch verification rejects partial, extra, duplicate, and unexpected feeds", () => {
  const valid = batchResponse().BatchResult.feedResults;
  for (const feedResults of [valid.slice(1), [...valid, valid[0]], [...valid, { ...valid[0], subreddit: "news" }],
    [...valid.slice(0, -1), { ...valid.at(-1), subreddit: "unexpected" }]]) {
    assert.throws(() => checkBatchInvocation(batchResponse({ feedResults })));
  }
  for (const fields of [{ sessionMode: undefined }, { sessionGeneration: "unsafe\nidentifier" }, { sessionGeneration: undefined }]) {
    assert.throws(() => checkBatchInvocation(batchResponse(fields)));
  }
  assert.equal(checkBatchInvocation(batchResponse({}, { outcome: "degraded" })).feedResults[0].outcome, "degraded");
  for (const metadata of [{ ...batchResponse(), FunctionError: "Unhandled" }, { ...batchResponse(), StatusCode: 500 }, sharedResponse()]) {
    assert.throws(() => checkBatchInvocation(metadata));
  }
});

test("batch verification rejects failed feeds, invalid counts, incomplete saves, and inconsistent sessions", async () => {
  for (const fields of [{ outcome: "failed" }, { fetchedCount: 0, savedCount: 0 }, { fetchedCount: 26, savedCount: 26 },
    { savedCount: 24 }, { outcome: "failed", message: JSON.stringify({ eventType: "SCRAPER_JOB_COMPLETED", outcome: "success", fetchedCount: 25, savedCount: 25, sessionMode: "renewed", sessionGeneration: "generation-1" }) }, { sessionGeneration: "generation-2" }, { sessionMode: "reused" }, { sessionGeneration: "unsafe\nidentifier" }]) {
    let calls = 0;
    const lines = [];
    const feedResults = batchResponse().BatchResult.feedResults;
    feedResults[5] = { ...feedResults[5], ...fields };
    await assert.rejects(verifyFeeds({ allFeeds: true, emit: (line) => lines.push(line), invoke: async () => { calls += 1; return batchResponse({ feedResults }); } }));
    assert.equal(calls, 1);
    assert.deepEqual(lines, []);
  }
});

test("all-feed verification rejects changed generations or renewed repeats", async () => {
  for (const fields of [{ sessionGeneration: "generation-2" }, { sessionMode: "renewed" }]) {
    let calls = 0;
    await assert.rejects(verifyFeeds({ allFeeds: true, emit: () => {}, invoke: async (event) => {
      calls += 1;
      return event.allFeeds ? batchResponse() : sharedResponse(fields);
    } }));
    assert.equal(calls, 2);
  }
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


test("explicit all-feed renewal still runs exactly one renewed batch", async () => {
  const calls = [];
  const { summary } = await verifyFeeds({ allFeeds: true, renewSession: true, emit: () => {}, invoke: async (event) => {
    calls.push(event);
    return event.allFeeds ? batchResponse() : sharedResponse();
  } });
  assert.deepEqual(calls, [{ allFeeds: true, session: true, renewSession: true }, { subreddit: "politics", session: true }]);
  assert.equal(summary.renewedCount, 1);
  assert.equal(summary.reusedCount, 1);
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
    return batchResponse({ sessionMode: "reused" }, { sessionMode: "reused" });
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
    return FEEDS.map((feed) => scheduledEvent(feed, 1001, { risingNavigations: 1, privateData: "private-marker" }));
  }, emit: (line) => lines.push(line) });
  assert.deepEqual(starts, [1000]);
  assert.ok(summary.feeds.every((feed) => feed.risingNavigations === 1));
  assert.equal(summary.feedCount, FEEDS.length);
  assert.equal(summary.savedCount, FEEDS.length * 25);
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
  assert.equal(summary.feedCount, FEEDS.length);
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
  assert.equal(summary.feedCount, FEEDS.length);
});

test("scheduled verification rejects missing feeds, missing session proof, and partial writes at its deadline", async () => {
  for (const fields of [{ savedCount: 0 }, { risingNavigations: 2 }, { sessionMode: undefined }, { eventType: "SCRAPER_JOB_FAILED", errorMessage: "private-error" }]) {
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


test("single-feed verification selects Politics with the shared session", async () => {
  const calls = [];
  await verifyFeeds({ subreddit: "politics", emit: () => {}, invoke: async (event) => {
    calls.push(event);
    return sharedResponse();
  } });
  assert.deepEqual(calls, [{ subreddit: "politics", session: true }]);
});

test("deployment mode chooses read-only scheduled verification whenever a schedule is enabled", async () => {
  const configuration = { functions: { scrape: { events: [{ schedule: { enabled: false } }] }, another: { events: [{ schedule: { enabled: true } }] } } };
  assert.equal(selectVerificationMode({ F5_PROBE_DEPLOYMENT: "true" }, configuration), "scheduled");
  let reads = 0;
  const result = await runVerification({ env: { F5_PROBE_DEPLOYMENT: "true", F5_PROBE_ALL_FEEDS: "true" }, configuration,
    invoke: async () => assert.fail("Deployment must not overlap an enabled schedule with manual browser calls"),
    readEvents: async (startTime) => { reads++; return FEEDS.map((feed) => scheduledEvent(feed, startTime + 1, { risingNavigations: 1 })); }, emit: () => {},
  });
  assert.equal(reads, 1);
  assert.equal(result.eventType, "BROWSER_SCHEDULED_PROBE_COMPLETED");
  assert.equal(result.feedCount, FEEDS.length);
});

test("deployment mode uses a paced batch when schedules are explicitly disabled", async () => {
  const configuration = { functions: { scrape: { events: [{ schedule: { enabled: false } }] } } };
  assert.equal(selectVerificationMode({ F5_PROBE_DEPLOYMENT: "true" }, configuration), "batch");
  const calls = [];
  const delays = [];
  await runVerification({ env: { F5_PROBE_DEPLOYMENT: "true" }, configuration,
    invoke: async (event) => { calls.push(event); return event.allFeeds ? batchResponse() : sharedResponse(); },
    readEvents: async () => assert.fail("Disabled schedules require the batch probe"),
    emit: () => {}, sleep: async (ms) => { assert.equal(calls.length, 1); delays.push(ms); },
  });
  assert.deepEqual(calls, [{ allFeeds: true, session: true }, { subreddit: "politics", session: true }]);
  assert.deepEqual(delays, [300000]);
});

test("deployment verification fails closed on missing service configuration", () => {
  for (const configuration of [undefined, {}, { functions: [] }]) {
    assert.throws(() => selectVerificationMode({ F5_PROBE_DEPLOYMENT: "true" }, configuration), /valid service configuration/);
  }
  assert.equal(selectVerificationMode({ F5_PROBE_DIAGNOSTICS: "true", F5_PROBE_DEPLOYMENT: "true" }), "diagnostics");
  assert.equal(selectVerificationMode({ F5_PROBE_SCHEDULED: "true" }), "scheduled");
  assert.equal(selectVerificationMode({}), "manual");
});

test("diagnostics remain the highest priority and invoke no browser extraction", async () => {
  let calls = 0;
  const result = await runVerification({ env: { F5_PROBE_DIAGNOSTICS: "true", F5_PROBE_DEPLOYMENT: "true", F5_PROBE_DIAGNOSTICS_KEY: diagnosticPublicKey },
    invoke: async (event) => { calls++; assert.deepEqual(event, { inspectSession: true }); return diagnosticsResponse(); },
    readEvents: async () => assert.fail("Diagnostics must not start schedule verification"), readRuntime: async () => [], emit: () => {},
  });
  assert.equal(calls, 1);
  assert.equal(result.eventType, "BROWSER_SESSION_DIAGNOSTICS_ENCRYPTED");
});

test("invalid probe subreddits fail before invoking Lambda", async () => {
  let invocations = 0;
  for (const subreddit of ["unknown", "science", "News", "news?token=private", "", null]) {
    await assert.rejects(verifyFeeds({ subreddit, emit: () => {}, invoke: async () => {
      invocations += 1;
      return sharedResponse();
    } }), /configured subreddit/);
  }
  assert.equal(invocations, 0);
});


const diagnosticsRecord = (fields = {}) => ({ eventType: "BROWSER_SESSION_DIAGNOSTICS",
  generation: "01234567-89ab-cdef-0123-456789abcdef", statePresent: true, stateReadable: true,
  sessionAgeSeconds: 42, leaseActive: false, cooldownSeconds: null, versionSupported: true, seedValid: true,
  cookieCount: 10, rootAccountCookieCount: 2, unexpiredRootAccountCookieCount: 1, expiredRootAccountCookieCount: 1,
  sessionRootAccountCookieCount: 0, otherExpiredCookieCount: 1, minimumRootAccountExpirySeconds: -1,
  unknownCookieAttributeCount: 0, originCount: 2, stateBytes: 1024, ...fields,
});
const diagnosticsResponse = (fields = {}) => ({ StatusCode: 200,
  LogResult: Buffer.from(JSON.stringify({ message: JSON.stringify(diagnosticsRecord(fields)) })).toString("base64"),
});

test("session diagnostics invokes inspection once and copies only safe metadata fields", async () => {
  const calls = [];
  const lines = [];
  const summary = await verifySessionDiagnostics({ publicKey: diagnosticPublicKey, emit: (line) => lines.push(line), invoke: async (event) => {
    calls.push(event);
    return { ...diagnosticsResponse({ cookies: [{ value: "private-cookie" }], state: "private-state", unknown: "private-extra" }),
      payload: "private-payload", privateMetadata: "private-metadata" };
  } });
  assert.deepEqual(calls, [{ inspectSession: true }]);
  assert.deepEqual(decryptDiagnostics(summary), diagnosticsRecord());
  assert.equal(summary.eventType, "BROWSER_SESSION_DIAGNOSTICS_ENCRYPTED");
  assert.equal(summary.version, 1);
  assert.deepEqual(Object.keys(summary).sort(), ["eventType", "version", "wrappedKey", "iv", "tag", "ciphertext"].sort());
  assert.equal(lines.length, 1);
  for (const hidden of ["private", "01234567-89ab-cdef-0123-456789abcdef", "cookieCount", "sessionAgeSeconds", "1024"]) {
    assert.equal(lines[0].includes(hidden), false);
  }
});

test("session diagnostics encrypt optional bounded read backoff without exposing it", async () => {
  for (const readBackoffSeconds of [0, 600, 86400]) {
    const lines = [];
    const envelope = await verifySessionDiagnostics({ publicKey: diagnosticPublicKey, emit: (line) => lines.push(line),
      invoke: async () => diagnosticsResponse({ readBackoffSeconds, privateData: "private-backoff" }),
    });
    assert.equal(decryptDiagnostics(envelope).readBackoffSeconds, readBackoffSeconds);
    assert.equal(lines.length, 1);
    for (const value of ["readBackoffSeconds", "private-backoff"]) assert.equal(lines[0].includes(value), false);
  }
  for (const readBackoffSeconds of [-1, 86401, 1.5, null, "private-backoff"]) {
    const lines = [];
    await assert.rejects(verifySessionDiagnostics({ publicKey: diagnosticPublicKey, emit: (line) => lines.push(line),
      invoke: async () => diagnosticsResponse({ readBackoffSeconds }),
    }), /invalid read backoff seconds/);
    assert.deepEqual(lines, []);
  }
});

test("session diagnostics accepts missing or invalid state without exposing state data", async () => {
  for (const generation of ["none", "invalid"]) {
    const summary = await verifySessionDiagnostics({ publicKey: diagnosticPublicKey, emit: () => {}, invoke: async () => diagnosticsResponse({
      generation, statePresent: false, stateReadable: false, seedValid: false, versionSupported: false,
      sessionAgeSeconds: null, cooldownSeconds: null, minimumRootAccountExpirySeconds: null,
    }) });
    assert.equal(decryptDiagnostics(summary).generation, generation);
    assert.equal(decryptDiagnostics(summary).stateReadable, false);
  }
});

test("session diagnostics rejects invalid safe-field types without emitting secret strings", async () => {
  for (const fields of [{ generation: "private-generation" }, { cookieCount: "private-cookie" },
    { seedValid: "private-seed" }, { sessionAgeSeconds: "private-age" }]) {
    const lines = [];
    let failure;
    await assert.rejects(verifySessionDiagnostics({ publicKey: diagnosticPublicKey, emit: (line) => lines.push(line), invoke: async () => diagnosticsResponse(fields) }), (error) => {
      failure = error;
      return true;
    });
    assert.equal(lines.length, 0);
    assert.equal(String(failure).includes("private"), false);
  }
});

test("session diagnostics rejects failed invocations and missing result records", async () => {
  for (const metadata of [{ ...diagnosticsResponse(), FunctionError: "Unhandled" },
    { ...diagnosticsResponse(), StatusCode: 500 }, response()]) {
    await assert.rejects(verifySessionDiagnostics({ publicKey: diagnosticPublicKey, emit: () => {}, invoke: async () => metadata }));
  }
});


test("diagnostics rejects missing, malformed, or weak public keys before invoking Lambda", async () => {
  const weak = generateKeyPairSync("rsa", { modulusLength: 1024 }).publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "der" }).toString("base64");
  let calls = 0;
  for (const publicKey of [undefined, "", "private-invalid-key", Buffer.from("private-data").toString("base64"), weak, ec]) {
    await assert.rejects(verifySessionDiagnostics({ publicKey, emit: () => {}, invoke: async () => { calls += 1; return diagnosticsResponse(); } }), /RSA public key/);
  }
  assert.equal(calls, 0);
});

test("encrypted diagnostic reports reject tampering", async () => {
  const envelope = await verifySessionDiagnostics({ publicKey: diagnosticPublicKey, emit: () => {}, invoke: async () => diagnosticsResponse() });
  const bytes = Buffer.from(envelope.ciphertext, "base64");
  bytes[0] ^= 1;
  assert.throws(() => decryptDiagnostics({ ...envelope, ciphertext: bytes.toString("base64") }));
});


test("batch summaries canonicalize feed order and omit unrelated payload fields", async () => {
  const feedResults = batchResponse().BatchResult.feedResults.reverse().map((feed) => ({ ...feed, posts: ["private-post"], cookies: "private-cookie" }));
  const lines = [];
  const { results } = await verifyFeeds({ allFeeds: true, emit: (line) => lines.push(line), invoke: async (event) => event.allFeeds
    ? batchResponse({ feedResults, privateData: "private-payload" }) : sharedResponse() });
  assert.deepEqual(results.slice(0, FEEDS.length).map((feed) => feed.subreddit), FEEDS);
  assert.equal(lines.join("\n").includes("private"), false);
});


const runtimeEvents = () => [
  { message: "REPORT RequestId: private-request Duration: 100 ms Memory Size: 2048 MB Max Memory Used: 1700 MB" },
  { message: JSON.stringify({ type: "platform.report", record: { requestId: "private-request", metrics: { memorySizeMB: 2048, maxMemoryUsedMB: 1800 }, privateData: "private-platform" } }) },
  { message: JSON.stringify({ eventType: "BROWSER_PROGRESS", message: "Resource counters: " + JSON.stringify({
    "memory.events": "low 0\nhigh 0\nmax 3\noom 2\noom_kill 1\nprivate 999",
    "pids.events": "max 4", "memory.peak": "1900000000", "memory.max": "2147483648", "pids.peak": "900", "pids.max": "1024",
    privateKey: "private-resource", "unknown.numeric": 888,
  }) }) },
  { message: JSON.stringify({ eventType: "SCRAPER_JOB_FAILED", errorMessage: "Browser extraction failed: session_invalid/navigation_network_error https://private.example", privateData: "private-error" }) },
];

test("runtime diagnostics parse text and JSON REPORT memory and known cgroup counters", () => {
  const summary = summarizeRuntimeEvents(runtimeEvents());
  assert.equal(summary.reportCount, 2);
  assert.equal(summary.maxMemoryUsedMB, 1800);
  assert.equal(summary.memorySizeMB, 2048);
  assert.equal(summary.resourceSampleCount, 1);
  assert.equal(summary.memoryEventsSampleCount, 1);
  assert.equal(summary.pidsEventsSampleCount, 1);
  assert.equal(summary.memoryOomCount, 2);
  assert.equal(summary.memoryOomKillCount, 1);
  assert.equal(summary.memoryMaxCount, 3);
  assert.equal(summary.pidsMaxCount, 4);
  assert.equal(summary.memoryPeakBytes, 1900000000);
  assert.equal(summary.pidsPeak, 900);
  assert.equal(summary.networkFailureCount, 1);
  assert.equal(summary.sessionReasonCounts.navigation_network_error, 1);
  assert.equal(JSON.stringify(summary).includes("private"), false);
});

test("runtime diagnostics discard unknown fields, invalid numbers, malformed counters, and unbounded input", () => {
  const summary = summarizeRuntimeEvents([
    { message: JSON.stringify({ type: "platform.report", record: { metrics: { memorySizeMB: "private-memory", maxMemoryUsedMB: -1 } } }) },
    { message: JSON.stringify({ eventType: "BROWSER_PROGRESS", message: "Resource counters: not-json-private" }) },
    { message: JSON.stringify({ eventType: "BROWSER_PROGRESS", message: "Resource counters: " + JSON.stringify({ "memory.peak": "max", "pids.max": "NaN", "memory.events": "oom -1\noom_kill private\nmax 999999999999999999999" }) }) },
    { message: JSON.stringify({ eventType: "SCRAPER_JOB_FAILED", sessionReason: "private-reason" }) },
  ]);
  assert.equal(summary.maxMemoryUsedMB, 0);
  assert.equal(summary.memorySizeMB, 0);
  assert.equal(summary.memoryOomCount, 0);
  assert.equal(summary.memoryOomKillCount, 0);
  assert.equal(summary.memoryMaxCount, 0);
  assert.equal(summary.networkFailureCount, 0);
  assert.equal(JSON.stringify(summary).includes("private"), false);
  assert.throws(() => summarizeRuntimeEvents(new Array(20001)));
});

const imageDiagnosticEvents = () => {
  const event = (timestamp, record) => ({ timestamp, message: JSON.stringify(record) });
  return [
    event(200, { eventType: "SCRAPER_JOB_COMPLETED", subreddit: "politics", outcome: "degraded",
      imageAttempts: 5, imageResolved: 4, imageMissing: 1, imageErrors: 2, imageDependencyFailures: 3,
      imageUpdateErrors: 0, backfillQueryErrors: 1, optionalImagesDeferred: true,
      title: "private-title", url: "https://private.example/story", sessionGeneration: "private-generation" }),
    event(100, { eventType: "SCRAPER_JOB_COMPLETED", subreddit: "politics", outcome: "success",
      imageAttempts: 2, imageResolved: 2, imageMissing: 0, sessionRenewalDeferred: true }),
    event(90, { eventType: "SCRAPER_JOB_FAILED", subreddit: "politics", outcome: "failed", imageErrors: 1,
      errorMessage: "private-provider-message", domain: "private.example" }),
    event(201, { eventType: "POST_IMAGE_RESOLUTION_MISSING", subreddit: "politics", title: "private-title", postUrl: "https://private.example/story",
      imageResolutionFailures: [{ reason: "http_status", status: 403, url: "https://private.example", server: "private-server" },
        { reason: "no_meta_image", status: 200 }, { reason: "request_timeout" }] }),
    event(301, { eventType: "POST_IMAGE_BACKFILL_ERROR", subreddit: "politics", errorMessage: "private-database-message",
      imageResolutionFailures: [{ reason: "fetch_error", status: 429, domain: "private.example" }] }),
    event(302, { eventType: "PUBLISHER_IMAGE_BACKFILL_COMPLETED", trigger: "schedule", subreddit: "politics",
      candidates: 3, attempts: 2, updated: 1, errors: 0, deferred: true }),
    event(303, { eventType: "PUBLISHER_IMAGE_BACKFILL_COMPLETED", subreddit: "politics", updated: 2 }),
    event(400, { eventType: "BROWSER_NAVIGATION_HTTP", status: 429, retryAfterSeconds: 60 }),
    event(500, { eventType: "SCRAPER_JOB_COMPLETED", subreddit: "science", outcome: "degraded", imageAttempts: 999 }),
  ];
};

test("encrypted image diagnostics separate publisher failures, Reddit responses, totals, and latest feed results", () => {
  const summary = summarizeRuntimeEvents(imageDiagnosticEvents());
  const images = summary.imageDiagnostics;
  assert.deepEqual(images.feeds.map((entry) => entry.subreddit), FEEDS);
  assert.deepEqual(images.feeds.find((entry) => entry.subreddit === "politics").latestScheduledCoverRepair,
    { timestamp: 302, candidates: 3, attempts: 2, updated: 1, errors: 0, deferred: true });
  const politics = images.feeds.find((entry) => entry.subreddit === "politics");
  assert.equal(politics.completedCount, 2);
  assert.equal(politics.degradedCount, 1);
  assert.equal(politics.imageAttempts, 7);
  assert.equal(politics.imageResolved, 6);
  assert.equal(politics.imageMissing, 1);
  assert.equal(politics.imageDependencyFailures, 3);
  assert.equal(politics.backfillQueryErrors, 1);
  assert.equal(politics.optionalImagesDeferredCount, 1);
  assert.equal(politics.sessionRenewalDeferredCount, 1);
  assert.deepEqual(politics.latestTerminal, { timestamp: 200, outcome: "degraded", optionalImagesDeferred: true, sessionRenewalDeferred: false,
    imageAttempts: 5, imageResolved: 4, imageMissing: 1, imageErrors: 2, imageDependencyFailures: 3, imageUpdateErrors: 0, backfillQueryErrors: 1 });
  assert.equal(images.feeds.find((entry) => entry.subreddit === "politics").failedCount, 1);
  assert.equal(images.failureReasonCounts.http_status, 1);
  assert.equal(images.failureReasonCounts.no_meta_image, 1);
  assert.equal(images.failureReasonCounts.request_timeout, 1);
  assert.equal(images.failureReasonCounts.fetch_error, 1);
  assert.deepEqual(images.failureHttpStatusCounts, { 200: 1, 403: 1, 429: 1 });
  assert.deepEqual(summary.navigationHttpStatusCounts, { 429: 1 });
  assert.equal(JSON.stringify(summary).includes("private"), false);
  assert.equal(JSON.stringify(images).includes("science"), false);
});

test("image diagnostic boundaries discard malformed counters and private reasons without copying arbitrary fields", () => {
  const record = (value, timestamp = 10) => ({ timestamp, message: JSON.stringify(value) });
  const summary = summarizeRuntimeEvents([null, {},
    record({ eventType: "SCRAPER_JOB_COMPLETED", subreddit: "politics", outcome: "private-outcome", imageAttempts: "private-value",
      imageResolved: -1, imageMissing: 0.5, imageErrors: true, imageDependencyFailures: Number.MAX_SAFE_INTEGER + 1,
      optionalImagesDeferred: "true", sessionRenewalDeferred: 1, privateField: "private-value" }),
    record({ eventType: "SCRAPER_JOB_COMPLETED", subreddit: "politics", outcome: "success", imageAttempts: 999 }, "private-timestamp"),
    record({ eventType: "POST_IMAGE_RESOLUTION_ERROR", subreddit: "politics", imageResolutionFailures: [null,
      { reason: "private-reason", status: "403", url: "https://private.example" }, { reason: "__proto__", status: 600 },
      { reason: "http_status", status: 403 }] }),
    record({ eventType: "POST_IMAGE_UPDATE_ERROR", subreddit: "politics", imageResolutionFailures: "private-array" }),
    record({ eventType: "private-event", subreddit: "politics", imageResolutionFailures: [{ reason: "http_status", status: 403 }] }),
    record({ eventType: "SCRAPER_JOB_COMPLETED", subreddit: "private-feed", imageAttempts: 999 }),
  ]);
  const politics = summary.imageDiagnostics.feeds[0];
  assert.equal(politics.imageAttempts, 999);
  for (const field of ["imageResolved", "imageMissing", "imageErrors", "imageDependencyFailures", "optionalImagesDeferredCount", "sessionRenewalDeferredCount"]) assert.equal(politics[field], 0);
  assert.equal(politics.latestTerminal.timestamp, 10);
  assert.equal(politics.latestTerminal.outcome, "unknown");
  assert.ok(!Object.hasOwn(politics.latestTerminal, "imageAttempts"));
  assert.equal(politics.failureEventCounts.POST_IMAGE_UPDATE_ERROR, 1);
  assert.ok(Object.values(politics.failureReasonCounts).every((count) => count === 0));
  assert.deepEqual(politics.failureHttpStatusCounts, {});
  assert.equal(JSON.stringify(summary).includes("private"), false);
});

test("image counters remain safe integers even when malformed input would overflow accumulated totals", () => {
  const message = JSON.stringify({ eventType: "SCRAPER_JOB_COMPLETED", subreddit: "politics", imageAttempts: Number.MAX_SAFE_INTEGER });
  const summary = summarizeRuntimeEvents([{ message }, { message }]);
  assert.equal(summary.imageDiagnostics.feeds[0].imageAttempts, Number.MAX_SAFE_INTEGER);
});

test("image diagnostics are emitted only inside the encrypted envelope", async () => {
  const lines = [];
  const envelope = await verifySessionDiagnostics({ publicKey: diagnosticPublicKey, invoke: async () => diagnosticsResponse(),
    readRuntimeEvents: async () => imageDiagnosticEvents(), emit: (line) => lines.push(line) });
  const decoded = decryptDiagnostics(envelope);
  assert.equal(decoded.runtimeDiagnostics.imageDiagnostics.failureHttpStatusCounts[403], 1);
  assert.equal(decoded.runtimeDiagnostics.imageDiagnostics.feeds[0].latestTerminal.timestamp, 200);
  for (const field of ["imageDiagnostics", "latestTerminal", "imageDependencyFailures", "private-title", "private.example"]) assert.ok(!lines.join().includes(field));
});

test("image diagnostics retain exhausted fallback failures without copying publisher data", () => {
  const summary = summarizeRuntimeEvents(["POST_IMAGE_RESOLUTION_DEGRADED", "POST_IMAGE_BACKFILL_DEGRADED"].map(eventType => ({
    message: JSON.stringify({ eventType, subreddit: FEEDS[0], outcome: "degraded", title: "private-title",
      imageResolutionFailures: [{ reason: "http_status", status: 403, url: "https://private.example/image", errorMessage: "private-error" }] }),
  }))).imageDiagnostics;
  assert.equal(summary.feeds[0].failureEventCounts.POST_IMAGE_RESOLUTION_DEGRADED, 1);
  assert.equal(summary.feeds[0].failureEventCounts.POST_IMAGE_BACKFILL_DEGRADED, 1);
  assert.equal(summary.failureReasonCounts.http_status, 2);
  assert.equal(summary.failureHttpStatusCounts[403], 2);
  assert.ok(!JSON.stringify(summary).includes("private"));
});

test("session diagnostics encrypt runtime aggregates and never print private resource telemetry", async () => {
  let readCount = 0;
  let invokeCount = 0;
  const lines = [];
  const envelope = await verifySessionDiagnostics({ publicKey: diagnosticPublicKey, emit: (line) => lines.push(line),
    invoke: async (event) => { invokeCount += 1; assert.deepEqual(event, { inspectSession: true }); return diagnosticsResponse(); },
    readRuntimeEvents: async () => { readCount += 1; return runtimeEvents(); },
  });
  assert.equal(invokeCount, 1);
  assert.equal(readCount, 1);
  const report = decryptDiagnostics(envelope);
  assert.deepEqual(report.runtimeDiagnostics, summarizeRuntimeEvents(runtimeEvents()));
  for (const value of ["private", "maxMemoryUsedMB", "memoryOomCount", "navigation_network_error", "runtimeDiagnostics"]) {
    assert.equal(lines.join("").includes(value), false);
  }
});


test("runtime diagnostics aggregate only finite HTTP statuses, bounded retry delays, and challenge counts", () => {
  const events = [
    { eventType: "BROWSER_NAVIGATION_HTTP", status: 403, retryAfterSeconds: null, challenge: true, headers: { cookie: "private-cookie" }, url: "https://private.example", requestId: "private-id" },
    { eventType: "BROWSER_NAVIGATION_HTTP", status: 429, retryAfterSeconds: 60, challenge: false },
    { eventType: "BROWSER_NAVIGATION_HTTP", status: 429, retryAfterSeconds: 120, challenge: true },
    { eventType: "BROWSER_NAVIGATION_HTTP", status: 599, retryAfterSeconds: 86401, challenge: "private-challenge" },
    { eventType: "BROWSER_NAVIGATION_HTTP", status: 400, retryAfterSeconds: -1, challenge: false },
    { eventType: "BROWSER_NAVIGATION_HTTP", status: "private-status", retryAfterSeconds: 86400, challenge: true },
    { eventType: "BROWSER_NAVIGATION_HTTP", status: 200, retryAfterSeconds: 86400, challenge: true },
    { eventType: "BROWSER_NAVIGATION_HTTP", status: 600, retryAfterSeconds: 86400, challenge: true },
    { eventType: "BROWSER_NAVIGATION_HTTP", status: 401.5, retryAfterSeconds: 86400, challenge: true },
    { eventType: "OTHER", status: 401, retryAfterSeconds: 86400, challenge: true },
  ].map((record) => ({ message: JSON.stringify({ eventType: "BROWSER_PROGRESS", message: JSON.stringify(record) }) }));
  const summary = summarizeRuntimeEvents(events);
  assert.deepEqual(summary.navigationHttpStatusCounts, { 400: 1, 403: 1, 429: 2, 599: 1 });
  assert.equal(summary.navigationMaxRetryAfterSeconds, 120);
  assert.equal(summary.navigationChallengeCount, 2);
  for (const value of ["private", "headers", "requestId", "https://"]) assert.equal(JSON.stringify(summary).includes(value), false);
});

test("HTTP resource telemetry stays inside the encrypted diagnostic envelope", async () => {
  const lines = [];
  const envelope = await verifySessionDiagnostics({ publicKey: diagnosticPublicKey, emit: (line) => lines.push(line),
    invoke: async () => diagnosticsResponse(), readRuntimeEvents: async () => [{ message: JSON.stringify({
      eventType: "BROWSER_NAVIGATION_HTTP", status: 429, retryAfterSeconds: 60, challenge: true, rawHeaders: "private-header",
    }) }],
  });
  const report = decryptDiagnostics(envelope);
  assert.deepEqual(report.runtimeDiagnostics.navigationHttpStatusCounts, { 429: 1 });
  assert.equal(report.runtimeDiagnostics.navigationMaxRetryAfterSeconds, 60);
  assert.equal(report.runtimeDiagnostics.navigationChallengeCount, 1);
  for (const value of ["navigationHttpStatusCounts", "retryAfterSeconds", "private-header"]) assert.equal(lines.join("").includes(value), false);
});


test("runtime HTTP diagnostics accept direct, progress, and Lambda JSON envelopes", () => {
  const event = { eventType: "BROWSER_NAVIGATION_HTTP", status: 403, retryAfterSeconds: null, challenge: true };
  const progress = { eventType: "BROWSER_PROGRESS", message: JSON.stringify(event) };
  const summary = summarizeRuntimeEvents([
    { message: JSON.stringify(event) }, { message: JSON.stringify(progress) },
    { message: JSON.stringify({ timestamp: "private-time", requestId: "private-request", message: JSON.stringify(progress) }) },
    { message: JSON.stringify({ eventType: "BROWSER_PROGRESS", message: "{private-malformed" }) },
    { message: JSON.stringify({ eventType: "BROWSER_PROGRESS", message: JSON.stringify({ eventType: "PRIVATE_UNKNOWN", status: 429, challenge: true }) }) },
    { message: JSON.stringify({ eventType: "SCRAPER_JOB_FAILED", sessionReason: "navigation_http_rejected" }) },
    { message: JSON.stringify({ eventType: "SCRAPER_JOB_FAILED", errorMessage: "Browser extraction failed: navigation_rate_limited" }) },
  ]);
  assert.deepEqual(summary.navigationHttpStatusCounts, { 403: 3 });
  assert.equal(summary.navigationChallengeCount, 3);
  assert.equal(summary.sessionReasonCounts.navigation_http_rejected, 1);
  assert.equal(summary.sessionReasonCounts.navigation_rate_limited, 1);
  assert.equal(JSON.stringify(summary).includes("private"), false);
});

test("page access diagnostics retain only fixed verification indicators", () => {
  const evidence = { eventType: "BROWSER_PAGE_ACCESS", state: "challenge", marker: "verify_human",
    hasPosts: false, titleMatch: true, dialogVisible: false, verificationFrame: true };
  const message = JSON.stringify({ eventType: "BROWSER_PROGRESS",
    message: JSON.stringify({ ...evidence, matchedRegion: "verification", verificationControl: true, html: "private-page" }) });
  const invalid = JSON.stringify({ ...evidence, marker: "private-marker" });
  assert.deepEqual(summarizeRuntimeEvents([{ timestamp: 3, message }, { timestamp: 4, message: invalid }]).latestPageAccess,
    { timestamp: 3, state: "challenge", marker: "verify_human", hasPosts: false,
      titleMatch: true, dialogVisible: false, verificationFrame: true, matchedRegion: "verification", verificationControl: true });
});

test("targeted publisher repair passes the explicit candidate to Lambda and emits only aggregate results", async () => {
  const publisherImageUrl = "https://cdn.example/public.jpg";
  const env = { F5_PROBE_PUBLISHER_IMAGE_BACKFILL: "true", F5_PROBE_PUBLISHER_POST_ID: "abc",
    F5_PROBE_PUBLISHER_IMAGE_URL: publisherImageUrl, F5_PROBE_SUBREDDIT: "politics" };
  const summary = { eventType: "PUBLISHER_IMAGE_BACKFILL_COMPLETED", subreddit: "politics", candidates: 1,
    attempts: 1, updated: 1, errors: 0, dependencyFailures: 0, deferred: false };
  const calls = [];
  const logs = [];
  const invoke = async (event) => {
    calls.push(event);
    return { StatusCode: 200, PublisherBackfillResult: { ...summary, publisherPostId: "abc", publisherImageUrl } };
  };
  assert.deepEqual(await runVerification({ env, invoke, emit: (log) => logs.push(JSON.parse(log)) }), summary);
  assert.deepEqual(logs, [summary]);
  await assert.rejects(runVerification({ env: { ...env, F5_PROBE_PUBLISHER_IMAGE_URL: "" }, invoke }), /public HTTPS/);
  await assert.rejects(runVerification({ env: { ...env, F5_PROBE_PUBLISHER_IMAGE_BACKFILL: "false" }, invoke }), /Enable publisher image backfill/);
  assert.deepEqual(calls, [{ publisherImageBackfill: true, subreddit: "politics", publisherPostId: "abc", publisherImageUrl }]);
});

test("challenge screenshot probe logs only bounded encrypted chunks and rejects mixed modes", async () => {
  const env = { F5_PROBE_CHALLENGE_SCREENSHOT: "true", F5_PROBE_DIAGNOSTICS_KEY: "Zm9v" };
  const screenshot = { version: 1, contentType: "image/jpeg", iv: "A".repeat(16), tag: "B".repeat(24),
    wrappedKey: "C".repeat(344), ciphertext: "D".repeat(8000), unrelated: "private-value" };
  const records = [];
  const invoke = async (event) => {
    assert.deepEqual(event, { challengeScreenshotPublicKey: "Zm9v" });
    return { StatusCode: 200, ChallengeScreenshotResult: { outcome: "captured", screenshot } };
  };
  await runVerification({ env, invoke, emit: (line) => records.push(JSON.parse(line)) });
  assert.equal(records[0].screenshot.chunkCount, 3);
  assert.equal(records[0].screenshot.ciphertext, undefined);
  assert.equal(records.slice(1).map(({ data }) => data).join(""), screenshot.ciphertext);
  assert.ok(records.slice(1).every(({ data }) => data.length <= 3000));
  assert.equal(JSON.stringify(records).includes("private-value"), false);
  await assert.rejects(runVerification({ env: { ...env, F5_PROBE_AUTHENTICATE: "true" }, invoke }), /on its own/);
});

test("production OAuth probe invokes only the diagnostic and prints no credentials or post content", async () => {
  const reports = [];
  const result = await runVerification({ env: { F5_PROBE_DIAGNOSTICS: "oauth" }, emit: (line) => reports.push(JSON.parse(line)),
    invoke: async (event) => {
      assert.deepEqual(event, { redditOAuthProbe: true });
      return { StatusCode: 200, RedditOAuthResult: {
        stage: "listing", outcome: "success", tokenStatus: 200, listingStatus: 200, postCount: 1, token: "discard",
      } };
    } });
  assert.deepEqual(reports, [result]);
  assert.deepEqual(result, { eventType: "REDDIT_OAUTH_PROBE", stage: "listing", outcome: "success",
    tokenStatus: 200, listingStatus: 200, postCount: 1 });
});
