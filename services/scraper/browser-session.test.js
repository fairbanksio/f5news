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
  return {
    objects, attempts, releases,
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
      metadata = { activeGeneration: generation, sessionCreatedAt: new Date(NOW), nextAttemptAt: new Date(NOW + 300000) };
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

test("sessions older than twelve hours renew without attempting to restore expired cookies", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW - 13 * 3600000) });
  store.read = async () => assert.fail("Expired session must not be restored");
  const result = await createSessionRunner({ store, now: () => NOW })(options(), async (request) => {
    assert.equal(request.authenticate, true);
    await writeFile(request.sessionOutput, SECRET, { mode: 0o600 });
    return { posts: [] };
  });
  assert.equal(result.sessionMode, "renewed");
  assert.notEqual(result.sessionGeneration, generation);
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
  assert.deepEqual(filter.$expr.$and.map((condition) => condition.$lte[0].$ifNull[0]), ["$leaseUntil", "$nextAttemptAt"]);
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


test("reuse failures report only a finite status when renewal is cooling down", async () => {
  const generation = randomUUID();
  const store = memoryStore({ activeGeneration: generation, sessionCreatedAt: new Date(NOW), nextAttemptAt: new Date(NOW + 300000) });
  store.objects.set(generation, SECRET);
  const messages = [];
  const runner = createSessionRunner({ store, now: () => NOW });
  let calls = 0;
  await assert.rejects(runner(options(messages), async (request) => {
    calls++;
    assert.equal(request.authenticate, false);
    throw new Error("Browser extraction failed: session_blocked");
  }), /cooling down.*session_blocked/);
  assert.equal(calls, 1);
  const record = messages.map(JSON.parse).find((item) => item.mode === "reuse_failed");
  assert.equal(record.status, "session_blocked");
  assert.equal(record.generation, generation);
  assert.ok(!messages.join().includes("private-cookie-value"));
});
