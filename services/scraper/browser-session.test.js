const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile, writeFile, stat, access } = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createSessionRunner, createSessionStore, key } = require("./browser-session");

const NOW = Date.parse("2026-11-06T12:00:00Z");
const SECRET = JSON.stringify({ cookies: [{ name: "reddit_session", value: "private-cookie-value" }], seed: 42 });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const options = (messages = []) => ({ subreddit: "politics", limit: 25, timeoutMs: 210000,
  logger: { log: (message) => messages.push(message) } });
const memoryStore = (initial = null) => {
  let metadata = initial;
  const objects = new Map();
  const attempts = [];
  const releases = [];
  const readPauses = [];
  return {
    objects, attempts, releases, readPauses,
    pauseReads: async (seconds) => { readPauses.push(seconds); metadata = { ...metadata, readBackoffSeconds: seconds }; },
    current: async () => metadata && { ...metadata },
    acquire: async (owner, observed) => {
      attempts.push(owner);
      if (metadata?.owner || (metadata?.activeGeneration || undefined) !== observed || metadata?.nextAttemptAt > NOW) return null;
      metadata = { ...metadata, owner, leaseUntil: new Date(NOW + 300000), nextAttemptAt: new Date(NOW + 900000) };
      return { ...metadata };
    },
    read: async (generation) => objects.get(generation) || null,
    publish: async (owner, generation, bytes) => {
      if (metadata.owner !== owner) throw new Error("Session renewal lease expired");
      objects.set(generation, bytes);
      metadata = { ...metadata, owner: undefined, leaseUntil: new Date(0), activeGeneration: generation, sessionCreatedAt: new Date(NOW), nextAttemptAt: new Date(NOW + 300000) };
    },
    release: async (owner) => {
      releases.push(owner);
      if (metadata?.owner === owner) metadata = { ...metadata, owner: undefined, leaseUntil: new Date(0) };
    },
  };
};

test("concurrent bootstrap authenticates once and the waiter reuses the published session", async () => {
  const store = memoryStore();
  const started = deferred();
  const continueLogin = deferred();
  const waiterWaiting = deferred();
  const published = deferred();
  const publish = store.publish;
  store.publish = async (...args) => { await publish(...args); published.resolve(); };
  const files = [];
  const messages = [];
  let authentications = 0;
  const runBrowser = async ({ authenticate, sessionInput, sessionOutput }) => {
    if (authenticate) {
      authentications += 1;
      files.push(sessionOutput);
      assert.equal((await stat(path.dirname(sessionOutput))).mode & 0o777, 0o700);
      started.resolve();
      await continueLogin.promise;
      await writeFile(sessionOutput, SECRET, { mode: 0o600 });
      assert.equal((await stat(sessionOutput)).mode & 0o777, 0o600);
    } else {
      files.push(sessionInput);
      assert.equal(await readFile(sessionInput, "utf8"), SECRET);
      assert.equal((await stat(sessionInput)).mode & 0o777, 0o600);
    }
    return { posts: ["post"] };
  };
  const runner = createSessionRunner({ store, now: () => NOW, pause: async () => {
    waiterWaiting.resolve();
    await published.promise;
  } });
  const owner = runner(options(messages), runBrowser);
  await started.promise;
  const waiter = runner(options(messages), runBrowser);
  await waiterWaiting.promise;
  continueLogin.resolve();
  const [first, second] = await Promise.all([owner, waiter]);
  assert.equal(authentications, 1);
  assert.equal(first.sessionMode, "renewed");
  assert.equal(second.sessionMode, "reused");
  assert.equal(second.sessionGeneration, first.sessionGeneration);
  assert.equal(store.releases.length, 0);
  for (const file of files) await assert.rejects(access(path.dirname(file)), { code: "ENOENT" });
  assert.ok(messages.every((message) => !message.includes("private-cookie-value") && !message.includes("reddit_session")));
});

test("sessions older than twelve hours are restored before proactive renewal", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW - 13 * 3600000) });
  store.objects.set(generation, SECRET);
  const modes = [];
  const result = await createSessionRunner({ store, now: () => NOW })(options(), async (request) => {
    modes.push(request.authenticate);
    if (!request.authenticate) return { posts: ["old"] };
    await writeFile(request.sessionOutput, SECRET, { mode: 0o600 });
    return { posts: [] };
  });
  assert.equal(result.sessionMode, "renewed");
  assert.notEqual(result.sessionGeneration, generation);
  assert.deepEqual(modes, [false, true]);
});

test("failed login releases ownership but preserves cooldown for the following invocation", async () => {
  const store = memoryStore();
  const runner = createSessionRunner({ store, now: () => NOW });
  let calls = 0;
  let directory;
  const runBrowser = async (request) => {
    calls += 1;
    directory = path.dirname(request.sessionOutput);
    throw new Error("Browser extraction failed: session_invalid");
  };
  await assert.rejects(runner(options(), runBrowser), /session_invalid/);
  await assert.rejects(runner(options(), runBrowser), /cooling down/);
  assert.equal(calls, 1);
  assert.equal(store.releases.length, 1);
  await assert.rejects(access(directory), { code: "ENOENT" });
});

test("unrelated extraction failures never trigger an authentication retry", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW) });
  store.objects.set(generation, Buffer.from(SECRET));
  let calls = 0;
  let directory;
  await assert.rejects(createSessionRunner({ store, now: () => NOW })(options(), async (request) => {
    calls += 1;
    assert.equal(request.authenticate, false);
    directory = path.dirname(request.sessionInput);
    throw new Error("Browser page crashed");
  }), /Browser page crashed/);
  assert.equal(calls, 1);
  assert.equal(store.attempts.length, 0);
  await assert.rejects(access(directory), { code: "ENOENT" });
});

test("an invalid restored session renews once and publishes a new generation", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW) });
  store.objects.set(generation, Buffer.from(SECRET));
  const modes = [];
  const result = await createSessionRunner({ store, now: () => NOW })(options(), async (request) => {
    modes.push(request.authenticate);
    if (!request.authenticate) throw new Error("Browser extraction failed: session_invalid");
    await writeFile(request.sessionOutput, SECRET, { mode: 0o600 });
    return { posts: [] };
  });
  assert.deepEqual(modes, [false, true]);
  assert.notEqual(result.sessionGeneration, generation);
});

test("explicit renewal skips valid cookies and still acquires the shared lease", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW) });
  store.read = async () => assert.fail("Explicit renewal must skip the initial session");
  const result = await createSessionRunner({ store, now: () => NOW })({ ...options(), renewSession: true }, async (request) => {
    assert.equal(request.authenticate, true);
    assert.equal(store.attempts.length, 1);
    await writeFile(request.sessionOutput, SECRET, { mode: 0o600 });
    return { posts: [] };
  });
  assert.equal(result.sessionMode, "renewed");
  assert.notEqual(result.sessionGeneration, generation);
});

test("explicit renewal cannot bypass the persisted cooldown", async () => {
  const store = memoryStore({ activeGeneration: randomUUID(), sessionCreatedAt: new Date(NOW), nextAttemptAt: new Date(NOW + 300000) });
  store.read = async () => assert.fail("Forced renewal must not restore the initial session");
  await assert.rejects(createSessionRunner({ store, now: () => NOW })({ ...options(), renewSession: true }, async () => {
    assert.fail("Cooldown must prevent login");
  }), /cooling down/);
  assert.equal(store.attempts.length, 1);
});

test("concurrent explicit renewals accept the first new generation instead of logging in twice", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW) });
  store.objects.set(generation, Buffer.from(SECRET));
  const started = deferred();
  const continueLogin = deferred();
  const waiting = deferred();
  const published = deferred();
  const publish = store.publish;
  store.publish = async (...args) => { await publish(...args); published.resolve(); };
  const modes = [];
  const runner = createSessionRunner({ store, now: () => NOW, pause: async () => {
    waiting.resolve();
    await published.promise;
  } });
  const runBrowser = async (request) => {
    modes.push(request.authenticate);
    if (request.authenticate) {
      started.resolve();
      await continueLogin.promise;
      await writeFile(request.sessionOutput, SECRET, { mode: 0o600 });
    } else {
      assert.equal(await readFile(request.sessionInput, "utf8"), SECRET);
    }
    return { posts: [] };
  };
  const owner = runner({ ...options(), renewSession: true }, runBrowser);
  await started.promise;
  const waiter = runner({ ...options(), renewSession: true }, runBrowser);
  await waiting.promise;
  continueLogin.resolve();
  const [first, second] = await Promise.all([owner, waiter]);
  assert.deepEqual(modes, [true, false]);
  assert.equal(first.sessionMode, "renewed");
  assert.equal(second.sessionMode, "reused");
  assert.equal(first.sessionGeneration, second.sessionGeneration);
  assert.notEqual(first.sessionGeneration, generation);
});

test("publication stores an encrypted immutable object but a stale holder cannot activate it", async () => {
  const active = randomUUID();
  const stale = randomUUID();
  const commands = [];
  let activationFilter;
  const collection = { findOneAndUpdate: async (filter) => { activationFilter = filter; return null; } };
  const store = createSessionStore({ bucket: "private-sessions", collection,
    client: { send: async (command) => { commands.push(command.input); return {}; } } });
  await assert.rejects(store.publish("expired-owner", stale, Buffer.from(SECRET)), /Unable to publish/);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].Key, key(stale));
  assert.notEqual(commands[0].Key, key(active));
  assert.equal(commands[0].ServerSideEncryption, "AES256");
  assert.equal(commands[0].IfNoneMatch, "*");
  assert.equal(activationFilter.owner, "expired-owner");
  assert.deepEqual(activationFilter.$expr, { $gt: ["$leaseUntil", "$$NOW"] });
});

test("lease acquisition requires both server-time expiry and cooldown, and release is owner-scoped", async () => {
  const updates = [];
  let acquisition;
  const collection = {
    updateOne: async (...args) => updates.push(args),
    findOneAndUpdate: async (...args) => { acquisition = args; return { owner: "holder" }; },
  };
  const store = createSessionStore({ collection });
  const generation = randomUUID();
  await store.acquire("holder", generation);
  const [filter, pipeline] = acquisition;
  assert.equal(filter.activeGeneration, generation);
  assert.deepEqual(filter.$expr.$and.map((condition) => condition.$lte[0].$ifNull[0]), ["$leaseUntil", "$nextAttemptAt", "$readBackoffUntil"]);
  assert.ok(filter.$expr.$and.every((condition) => condition.$lte[1] === "$$NOW"));
  assert.equal(pipeline[0].$set.lastAttemptAt, "$$NOW");
  assert.equal(pipeline[0].$set.nextAttemptAt.$dateAdd.amount, 900);
  await store.release("holder");
  assert.deepEqual(updates.at(-1)[0], { _id: "reddit", owner: "holder" });
});

test("duplicate bootstrap insertion is treated as contention without leaking database details", async () => {
  const store = createSessionStore({ collection: {
    updateOne: async () => { throw Object.assign(new Error("private database details"), { code: 11000 }); },
  } });
  assert.equal(await store.acquire("holder"), null);
});


test("access failures report only a finite status and never request renewal", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW), nextAttemptAt: new Date(NOW + 300000) });
  store.objects.set(generation, SECRET);
  const messages = [];
  const runner = createSessionRunner({ store, now: () => NOW, pause: async () => {} });
  let calls = 0;
  await assert.rejects(runner(options(messages), async (request) => {
    calls++;
    assert.equal(request.authenticate, false);
    throw new Error("Browser extraction failed: session_blocked");
  }), /Browser extraction failed: session_blocked/);
  assert.equal(calls, 2);
  assert.equal(store.attempts.length, 0);
  const record = messages.map(JSON.parse).find((item) => item.mode === "reuse_failed");
  assert.equal(record.status, "session_blocked");
  assert.equal(record.generation, generation);
  assert.ok(!messages.join().includes("private-cookie-value"));
});


test("a transient access failure retries the same session without another login", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW) });
  store.objects.set(generation, SECRET);
  const calls = [];
  const delays = [];
  const runner = createSessionRunner({ store, now: () => NOW, pause: async (ms) => { delays.push(ms); } });
  const result = await runner(options(), async (request) => {
    calls.push(request);
    if (calls.length === 1) throw new Error("Browser extraction failed: session_blocked");
    return { status: "accessible", posts: [] };
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((request) => request.authenticate === false));
  assert.equal(calls[0].sessionInput, calls[1].sessionInput);
  assert.deepEqual(delays, [2000]);
  assert.equal(result.sessionGeneration, generation);
  assert.equal(result.sessionMode, "reused");
  assert.equal(store.attempts.length, 0);
});

test("transport and restore failures retry reads twice without acquiring a password lease", async () => {
  for (const reason of ["restore_exception", "navigation_network_error", "feed_timeout", "input_file_invalid"]) {
    const generation = randomUUID();
    const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW) });
    store.objects.set(generation, SECRET);
    let calls = 0;
    const messages = [];
    const runner = createSessionRunner({ store, now: () => NOW, pause: async () => {} });
    await assert.rejects(runner(options(messages), async (request) => {
      calls++;
      assert.equal(request.authenticate, false);
      throw Object.assign(new Error("Browser extraction failed: session_invalid"), { sessionReason: reason });
    }), (error) => error.sessionReason === reason && error.message === `Browser extraction failed: session_invalid/${reason}`);
    assert.equal(calls, 2);
    assert.equal(store.attempts.length, 0);
    assert.equal(store.releases.length, 0);
    assert.ok(!messages.join().includes("private-cookie-value"));
  }
});

test("explicit HTTP rejection stops after one saved-session read without a password lease", async () => {
  for (const [reason, httpStatus, retryAfterSeconds] of [
    ["navigation_http_rejected", 401, 0], ["navigation_http_rejected", 403, 60], ["navigation_rate_limited", 429, 86400],
  ]) {
    const generation = randomUUID();
    const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW) });
    store.objects.set(generation, SECRET);
    const messages = [];
    let calls = 0;
    const runner = createSessionRunner({ store, now: () => NOW, pause: async () => assert.fail("Explicit rejection must not retry") });
    await assert.rejects(runner(options(messages), async (request) => {
      calls++;
      assert.equal(request.authenticate, false);
      throw Object.assign(new Error("Browser extraction failed: session_invalid"), { sessionReason: reason, httpStatus, retryAfterSeconds });
    }), (error) => error.sessionReason === reason && error.httpStatus === httpStatus && error.retryAfterSeconds === retryAfterSeconds &&
      error.message.includes(reason) && error.message.includes(`httpStatus=${httpStatus}`));
    assert.equal(calls, 1);
    assert.equal(store.attempts.length, 0);
    assert.equal(store.releases.length, 0);
    const diagnostic = messages.map(JSON.parse).find((entry) => entry.mode === "reuse_failed");
    assert.equal(diagnostic.httpStatus, httpStatus);
    assert.equal(diagnostic.retryAfterSeconds, retryAfterSeconds);
    assert.equal(diagnostic.attempt, 1);
  }
});

test("rejected navigation errors and logs discard untrusted provider diagnostics", async () => {
  for (const [httpStatus, retryAfterSeconds] of [["private-cookie-value", "private-cookie-value"], [500, 86401], [200, -1], ["403", 0.5]]) {
    const generation = randomUUID();
    const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW) });
    store.objects.set(generation, SECRET);
    const messages = [];
    let calls = 0;
    await assert.rejects(createSessionRunner({ store, now: () => NOW })(options(messages), async () => {
      calls++;
      throw Object.assign(new Error("private-cookie-value"), { sessionReason: "navigation_http_rejected", httpStatus, retryAfterSeconds });
    }), (error) => error.message === "Browser extraction failed: runtime_error/navigation_http_rejected" &&
      !Object.hasOwn(error, "httpStatus") && !Object.hasOwn(error, "retryAfterSeconds"));
    assert.equal(calls, 1);
    assert.equal(store.attempts.length, 0);
    assert.ok(!messages.join().includes("private-cookie-value"));
    const diagnostic = messages.map(JSON.parse).find((entry) => entry.mode === "reuse_failed");
    assert.ok(!Object.hasOwn(diagnostic, "httpStatus"));
    assert.ok(!Object.hasOwn(diagnostic, "retryAfterSeconds"));
  }
});

test("credential-invalid states permit one coordinated renewal without retrying the same cookies", async () => {
  for (const reason of ["root_cookie_expired", "root_cookie_missing", "invalid_data", "feed_cookie_missing"]) {
    const generation = randomUUID();
    const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW) });
    store.objects.set(generation, SECRET);
    const modes = [];
    const result = await createSessionRunner({ store, now: () => NOW })(options(), async (request) => {
      modes.push(request.authenticate);
      if (!request.authenticate) throw Object.assign(new Error("Browser extraction failed: session_invalid"), { sessionReason: reason });
      await writeFile(request.sessionOutput, SECRET, { mode: 0o600 });
      return { posts: ["renewed"] };
    });
    assert.deepEqual(modes, [false, true]);
    assert.equal(store.attempts.length, 1);
    assert.equal(result.sessionMode, "renewed");
  }
});

test("failed proactive authentication retains proven posts, the old pointer, and failure cooldown", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW - 13 * 3600000) });
  store.objects.set(generation, SECRET);
  const modes = [];
  const messages = [];
  const result = await createSessionRunner({ store, now: () => NOW })(options(messages), async (request) => {
    modes.push(request.authenticate);
    if (!request.authenticate) return { posts: ["proven"] };
    throw new Error("private-provider-details");
  });
  assert.deepEqual(modes, [false, true]);
  assert.deepEqual(result.posts, ["proven"]);
  assert.equal(result.sessionMode, "reused");
  assert.equal(result.sessionGeneration, generation);
  assert.equal(result.sessionRenewalDeferred, true);
  const current = await store.current();
  assert.equal(current.activeGeneration, generation);
  assert.equal(current.owner, undefined);
  assert.equal(current.nextAttemptAt.getTime(), NOW + 900000);
  assert.equal(store.releases.length, 1);
  assert.ok(messages.map(JSON.parse).some((entry) => entry.mode === "renewal_deferred" && entry.reason === "renewal_failed"));
  assert.ok(!messages.join().includes("private-provider-details"));
});

test("valid old sessions keep serving during another renewal or a cooldown", async () => {
  for (const busy of [false, true]) {
    const generation = randomUUID();
    const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW - 13 * 3600000),
      nextAttemptAt: new Date(NOW + 900000), ...(busy ? { owner: "another-holder", leaseUntil: new Date(NOW + 300000) } : {}) });
    store.objects.set(generation, SECRET);
    let calls = 0;
    const result = await createSessionRunner({ store, now: () => NOW })(options(), async (request) => {
      calls++;
      assert.equal(request.authenticate, false);
      return { posts: ["proven"] };
    });
    assert.equal(calls, 1);
    assert.equal(result.sessionGeneration, generation);
    assert.equal(result.sessionRenewalDeferred, true);
    assert.deepEqual(result.posts, ["proven"]);
    assert.equal(store.releases.length, 0);
  }
});

test("explicit renewal never falls back to old posts after failed verification", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW - 13 * 3600000) });
  store.objects.set(generation, SECRET);
  let calls = 0;
  await assert.rejects(createSessionRunner({ store, now: () => NOW })({ ...options(), renewSession: true }, async (request) => {
    calls++;
    assert.equal(request.authenticate, true);
    throw new Error("Browser extraction failed: auth_unverified");
  }), /auth_unverified/);
  assert.equal(calls, 1);
  assert.equal((await store.current()).activeGeneration, generation);
  assert.equal(store.releases.length, 1);
});

test("session inspection returns only safe counts and expiry metadata without writes", async () => {
  const { inspectSession } = require("./browser-session");
  const generation = randomUUID();
  const state = { version: 1, seed: 42, cookies: [
    { name: "reddit_session", value: "private-account-cookie", domain: ".reddit.com", path: "/", expires: -1 },
    { name: "reddit_session", value: "private-expired-cookie", domain: ".reddit.com", path: "/", expires: NOW / 1000 - 30 },
    { name: "reddit_session", value: "private-subdomain-cookie", domain: ".www.reddit.com", path: "/", expires: NOW / 1000 - 30 },
    { name: "private-cookie-name", value: "private-cookie-value", domain: ".reddit.com", path: "/", expires: NOW / 1000 - 1, size: 3 },
  ], origins: [{ origin: "https://www.reddit.com", localStorage: [{ name: "private-key", value: "private-storage" }] }] };
  const report = await inspectSession({ now: () => NOW, store: {
    current: async () => ({ activeGeneration: generation, sessionCreatedAt: new Date(NOW - 60000), owner: "private-owner", leaseUntil: new Date(NOW + 10000), nextAttemptAt: new Date(NOW + 20000) }),
    read: async () => Buffer.from(JSON.stringify(state)),
  } });
  assert.equal(report.sessionAgeSeconds, 60);
  assert.equal(report.leaseActive, true);
  assert.equal(report.cooldownSeconds, 20);
  assert.equal(report.rootAccountCookieCount, 2);
  assert.equal(report.unexpiredRootAccountCookieCount, 1);
  assert.equal(report.expiredRootAccountCookieCount, 1);
  assert.equal(report.sessionRootAccountCookieCount, 1);
  assert.equal(report.otherExpiredCookieCount, 2);
  assert.equal(report.minimumRootAccountExpirySeconds, -30);
  assert.equal(report.unknownCookieAttributeCount, 1);
  assert.ok(!JSON.stringify(report).includes("private"));
});


test("read backoff uses Mongo server time and changes only its dedicated expiry", async () => {
  const updates = [];
  let aggregation;
  const store = createSessionStore({ collection: {
    updateOne: async (...args) => { updates.push(args); },
    aggregate: (...args) => { aggregation = args; return { toArray: async () => [{ activeGeneration: "existing", readBackoffSeconds: 17 }] }; },
  } });
  for (const [input, expected] of [[undefined, 600], [null, 600], [0, 600], [-1, 600], ["private", 600], [1, 1], [60, 60], [100000, 86400]]) {
    await store.pauseReads(input);
    const [filter, pipeline, settings] = updates.at(-1);
    assert.deepEqual(filter, { _id: "reddit" });
    assert.deepEqual(Object.keys(pipeline[0].$set), ["readBackoffUntil"]);
    const maximum = pipeline[0].$set.readBackoffUntil.$max;
    assert.deepEqual(maximum[0], { $ifNull: ["$readBackoffUntil", "$$NOW"] });
    assert.deepEqual(maximum[1], { $dateAdd: { startDate: "$$NOW", unit: "second", amount: expected } });
    assert.equal(settings.timeoutMS, 10000);
    assert.equal(settings.maxTimeMS, 5000);
    assert.equal(settings.upsert, true);
  }
  assert.equal((await store.current()).readBackoffSeconds, 17);
  assert.ok(JSON.stringify(aggregation[0]).includes('"$$NOW"'));
  assert.ok(!JSON.stringify(aggregation[0]).includes(String(NOW)));
  assert.equal(aggregation[1].timeoutMS, 10000);
});

test("shared read backoff prevents saved-session reads, leases, and forced authentication", async () => {
  for (const renewSession of [false, true]) {
    const store = memoryStore({ activeGeneration: randomUUID(), readBackoffSeconds: 120 });
    store.read = async () => assert.fail("Backoff must precede session reads");
    await assert.rejects(createSessionRunner({ store, now: () => NOW })({ ...options(), renewSession }, async () => assert.fail("Backoff must precede browser launch")),
      (error) => error.readBackoffSeconds === 120);
    assert.equal(store.attempts.length, 0);
    assert.deepEqual(store.readPauses, []);
  }
});

test("a challenge stops the current attempt and the next scheduled read resumes after expiry", async () => {
  const generation = randomUUID();
  let clock = NOW;
  let expiry = NOW;
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW) });
  store.objects.set(generation, SECRET);
  const current = store.current;
  const pauseReads = store.pauseReads;
  store.current = async () => ({ ...await current(), readBackoffSeconds: Math.max(0, (expiry - clock) / 1000) });
  store.pauseReads = async (seconds) => { expiry = Math.max(expiry, clock + seconds * 1000); await pauseReads(seconds); };
  const run = createSessionRunner({ store, now: () => clock, pause: async () => assert.fail("Challenge must not retry immediately") });
  let calls = 0;
  const browser = async ({ authenticate }) => {
    assert.equal(authenticate, false);
    if (++calls <= 2) throw Object.assign(new Error("Browser extraction failed: session_challenge"), { sessionReason: "feed_challenge" });
    return { status: "accessible", posts: [] };
  };
  await assert.rejects(run(options(), browser), { sessionReason: "feed_challenge" });
  clock += 300000;
  await assert.rejects(run(options(), browser), { readBackoffSeconds: 300 });
  await assert.rejects(run({ ...options(), renewSession: true }, browser), { readBackoffSeconds: 300 });
  assert.equal(calls, 1);
  clock = expiry;
  await assert.rejects(run(options(), browser), { sessionReason: "feed_challenge" });
  clock = expiry;
  const resumed = await run(options(), browser);
  assert.equal(resumed.sessionGeneration, generation);
  assert.equal(calls, 3);
  assert.deepEqual(store.readPauses, [600, 600]);
  assert.equal(store.attempts.length, 0);
});

test("a challenge during renewal pauses reads and leaves the saved session in place", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW) });
  const run = createSessionRunner({ store, now: () => NOW });
  await assert.rejects(run({ ...options(), renewSession: true }, async ({ authenticate }) => {
    assert.equal(authenticate, true);
    throw new Error("Browser extraction failed: auth_challenge");
  }), /auth_challenge/);
  assert.deepEqual(store.readPauses, [600]);
  assert.equal((await store.current()).activeGeneration, generation);
  assert.equal(store.releases.length, 1);
});

test("a rejected saved-session read pauses all reads once and never requests a login", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW) });
  store.objects.set(generation, SECRET);
  let calls = 0;
  const run = createSessionRunner({ store, now: () => NOW });
  await assert.rejects(run(options(), async () => {
    calls += 1;
    throw Object.assign(new Error("Browser extraction failed: session_invalid"), { sessionReason: "navigation_rate_limited", httpStatus: 429 });
  }), (error) => error.httpStatus === 429);
  await assert.rejects(run({ ...options(), renewSession: true }, async () => assert.fail("Must not login during shared backoff")), /cooling down/);
  assert.equal(calls, 1);
  assert.deepEqual(store.readPauses, [600]);
  assert.equal(store.attempts.length, 0);
});

const partialBatch = () => ({ status: "accessible", feeds: [{ subreddit: "politics", posts: [{ data: { title: "Story" } }] }],
  batchFailure: { subreddit: "worldnews", status: "session_invalid", sessionReason: "navigation_rate_limited", httpStatus: 429, retryAfterSeconds: 30 } });

test("a partial rate-limited batch pauses once and retains proven posts without proactive login", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW - 13 * 3600000) });
  store.objects.set(generation, SECRET);
  let calls = 0;
  const result = await createSessionRunner({ store, now: () => NOW })(options(), async () => { calls += 1; return partialBatch(); });
  assert.deepEqual(result.feeds, partialBatch().feeds);
  assert.equal(result.batchFailure.httpStatus, 429);
  assert.deepEqual(store.readPauses, [30]);
  assert.equal(store.attempts.length, 0);
  assert.equal(calls, 1);
});

test("an authenticated partial batch publishes its proven session while preserving shared read backoff", async () => {
  const store = memoryStore();
  const result = await createSessionRunner({ store, now: () => NOW })(options(), async (request) => {
    assert.equal(request.authenticate, true);
    await writeFile(request.sessionOutput, SECRET);
    return partialBatch();
  });
  assert.equal(result.sessionMode, "renewed");
  assert.deepEqual(result.feeds, partialBatch().feeds);
  assert.deepEqual(store.readPauses, [30]);
  assert.equal((await store.current()).activeGeneration, result.sessionGeneration);
  assert.equal((await store.current()).readBackoffSeconds, 30);
});

test("authentication rate limits pause reads before releasing the existing renewal lease", async () => {
  const store = memoryStore();
  await assert.rejects(createSessionRunner({ store, now: () => NOW })(options(), async () => {
    throw Object.assign(new Error("Browser extraction failed: login_failed"), { sessionReason: "navigation_rate_limited", httpStatus: 429, retryAfterSeconds: 120 });
  }), /login_failed/);
  assert.deepEqual(store.readPauses, [120]);
  assert.equal(store.releases.length, 1);
  assert.equal((await store.current()).nextAttemptAt.getTime(), NOW + 900000);
  assert.equal((await store.current()).readBackoffSeconds, 120);
});

test("backoff coordination failures retain partial posts with an explicit failure marker", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW) });
  store.objects.set(generation, SECRET);
  store.pauseReads = async () => { throw new Error("private-provider"); };
  const messages = [];
  const result = await createSessionRunner({ store, now: () => NOW })(options(messages), async () => partialBatch());
  assert.equal(result.readBackoffFailed, true);
  assert.deepEqual(result.feeds, partialBatch().feeds);
  assert.equal(store.attempts.length, 0);
  assert.equal(messages.join().includes("private-provider"), false);
  await assert.rejects(createSessionRunner({ store, now: () => NOW })(options(), async () => {
    throw Object.assign(new Error("private-provider"), { sessionReason: "navigation_rate_limited" });
  }), (error) => error.readBackoffFailed === true && !error.message.includes("private-provider"));
});


test("batch reuse and authentication receive the remaining deadline while single-feed caps stay unchanged", async () => {
  for (const allFeeds of [false, true]) {
    for (const authenticate of [false, true]) {
      const generation = randomUUID();
      const store = memoryStore(authenticate ? null : { activeGeneration: generation, sessionCreatedAt: new Date(NOW) });
      if (!authenticate) store.objects.set(generation, SECRET);
      let timeout;
      await createSessionRunner({ store, now: () => NOW })({ ...options(), timeoutMs: 160000, allFeeds }, async (request) => {
        timeout = request.timeoutMs;
        assert.equal(request.authenticate, authenticate);
        if (authenticate) await writeFile(request.sessionOutput, SECRET);
        return { posts: [] };
      });
      assert.equal(timeout, allFeeds ? 145000 : authenticate ? 140000 : 100000);
    }
  }
});

test("batch transport retry receives only the actual remaining deadline", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW) });
  store.objects.set(generation, SECRET);
  let clock = NOW;
  const timeouts = [];
  await createSessionRunner({ store, now: () => clock, pause: async (ms) => { clock += ms; } })({ ...options(), timeoutMs: 160000, allFeeds: true }, async (request) => {
    timeouts.push(request.timeoutMs);
    if (timeouts.length === 1) {
      clock += 30000;
      throw Object.assign(new Error("Browser extraction failed: session_invalid"), { sessionReason: "navigation_network_error" });
    }
    return { posts: [] };
  });
  assert.deepEqual(timeouts, [145000, 113000]);
  assert.equal(store.attempts.length, 0);
});


test("aged partial batch failures retain the prefix without proactive authentication", async () => {
  for (const failure of [
    { status: "session_invalid", sessionReason: "navigation_http_rejected", httpStatus: 403 },
    { status: "challenge_required", sessionReason: "feed_challenge" },
    { status: "loading_timeout", sessionReason: "feed_timeout" },
  ]) {
    const generation = randomUUID();
    const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW - 13 * 3600000) });
    store.objects.set(generation, SECRET);
    const messages = [];
    let calls = 0;
    const partial = { ...partialBatch(), batchFailure: { subreddit: "worldnews", ...failure } };
    const result = await createSessionRunner({ store, now: () => NOW })(options(messages), async (request) => {
      calls += 1;
      assert.equal(request.authenticate, false);
      return partial;
    });
    assert.equal(calls, 1);
    assert.equal(store.attempts.length, 0);
    assert.deepEqual(store.readPauses, failure.sessionReason === "feed_challenge" ? [600] : []);
    assert.deepEqual(result.feeds, partial.feeds);
    assert.deepEqual(result.batchFailure, partial.batchFailure);
    assert.equal(result.sessionMode, "reused");
    assert.equal(result.sessionRenewalDeferred, true);
    assert.equal(messages.map(JSON.parse).find((entry) => entry.mode === "renewal_deferred").reason, "batch_incomplete");
  }
});

test("fresh partial batches do not claim an age-related renewal deferral", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW) });
  store.objects.set(generation, SECRET);
  const partial = { ...partialBatch(), batchFailure: { subreddit: "worldnews", status: "loading_timeout" } };
  const result = await createSessionRunner({ store, now: () => NOW })(options(), async () => partial);
  assert.equal(result.sessionRenewalDeferred, undefined);
  assert.equal(store.attempts.length, 0);
  assert.deepEqual(result.feeds, partial.feeds);
});


test("session inspection reports bounded shared read backoff without reading private state", async () => {
  const { inspectSession } = require("./browser-session");
  for (const [value, expected] of [[undefined, 0], [0, 0], [120, 120], [86400, 86400], [100000, 86400],
    [-1, 0], [0.5, 0], ["private-provider", 0], [null, 0], [Infinity, 0]]) {
    const report = await inspectSession({ now: () => NOW, store: {
      current: async () => ({ readBackoffSeconds: value, owner: "private-owner", privateField: "private-data" }),
      read: async () => assert.fail("Backoff metadata inspection must not read session state without a generation"),
    } });
    assert.equal(report.readBackoffSeconds, expected);
    assert.ok(Number.isInteger(report.readBackoffSeconds) && report.readBackoffSeconds >= 0 && report.readBackoffSeconds <= 86400);
    assert.equal(JSON.stringify(report).includes("private"), false);
  }
});


test("aged complete feed batches reuse once and leave renewal to separate maintenance", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW - 13 * 3600000) });
  store.objects.set(generation, SECRET);
  let calls = 0;
  const complete = { status: "accessible", feeds: [{ subreddit: "politics", posts: [] }] };
  const result = await createSessionRunner({ store, now: () => NOW })({ ...options(), allFeeds: true }, async (request) => {
    calls += 1;
    assert.equal(request.authenticate, false);
    return complete;
  });
  assert.equal(calls, 1);
  assert.equal(store.attempts.length, 0);
  assert.equal(result.sessionMode, "reused");
  assert.equal(result.sessionRenewalDeferred, undefined);
  assert.deepEqual(result.feeds, complete.feeds);
});

test("explicit batch renewal still authenticates once under the shared lease", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW - 13 * 3600000) });
  store.objects.set(generation, SECRET);
  let calls = 0;
  const result = await createSessionRunner({ store, now: () => NOW })({ ...options(), allFeeds: true, renewSession: true }, async (request) => {
    calls += 1;
    assert.equal(request.authenticate, true);
    await writeFile(request.sessionOutput, SECRET);
    return { status: "accessible", feeds: [] };
  });
  assert.equal(calls, 1);
  assert.equal(store.attempts.length, 1);
  assert.equal(result.sessionMode, "renewed");
  assert.notEqual(result.sessionGeneration, generation);
});

test("an optional single-feed rate limit retains posts and prevents aged proactive login", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW - 13 * 3600000) });
  store.objects.set(generation, SECRET);
  let calls = 0;
  const original = { status: "accessible", posts: [{ data: { title: "Story" } }], navigationRateLimit: { httpStatus: 429, retryAfterSeconds: 45 } };
  const result = await createSessionRunner({ store, now: () => NOW })(options(), async () => { calls += 1; return original; });
  assert.equal(calls, 1);
  assert.deepEqual(result.posts, original.posts);
  assert.deepEqual(store.readPauses, [45]);
  assert.equal(store.attempts.length, 0);
  assert.equal(result.sessionMode, "reused");
  assert.equal(result.sessionRenewalDeferred, undefined);
});

test("batch and optional HTTP rate-limit signals share one backoff write", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW) });
  store.objects.set(generation, SECRET);
  await createSessionRunner({ store, now: () => NOW })(options(), async () => ({ ...partialBatch(), navigationRateLimit: { httpStatus: 429, retryAfterSeconds: 60 } }));
  assert.deepEqual(store.readPauses, [60]);
});

test("optional rate-limit coordination failure retains valid posts with a clear marker", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW - 13 * 3600000) });
  store.objects.set(generation, SECRET);
  store.pauseReads = async () => { throw new Error("private-provider"); };
  const posts = [{ data: { title: "Story" } }];
  const result = await createSessionRunner({ store, now: () => NOW })(options(), async () => ({ posts, navigationRateLimit: { httpStatus: 429 } }));
  assert.equal(result.readBackoffFailed, true);
  assert.deepEqual(result.posts, posts);
  assert.equal(store.attempts.length, 0);
});
