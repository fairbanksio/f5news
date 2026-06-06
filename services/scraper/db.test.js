const assert = require("assert");
const test = require("node:test");

const dbPath = require.resolve("./db");
const mongoosePath = require.resolve("mongoose");

const loadDbWithMongoose = (fakeMongoose) => {
  const originalMongooseCache = require.cache[mongoosePath];
  delete require.cache[dbPath];
  require.cache[mongoosePath] = {
    id: mongoosePath,
    filename: mongoosePath,
    loaded: true,
    exports: fakeMongoose,
  };

  const db = require("./db");

  return {
    db,
    restore: () => {
      delete require.cache[dbPath];
      if (originalMongooseCache) {
        require.cache[mongoosePath] = originalMongooseCache;
      } else {
        delete require.cache[mongoosePath];
      }
    },
  };
};

test("connect shares one in-flight mongoose connection", async (t) => {
  let connectCount = 0;
  const fakeMongoose = {
    connect: async () => {
      connectCount += 1;
      return fakeMongoose;
    },
  };
  const { db, restore } = loadDbWithMongoose(fakeMongoose);
  t.after(restore);

  const [first, second] = await Promise.all([db.connect(), db.connect()]);

  assert.equal(connectCount, 1);
  assert.equal(first, fakeMongoose);
  assert.equal(second, fakeMongoose);
});

test("connect retries after an initial mongoose connection failure", async (t) => {
  let connectCount = 0;
  const fakeMongoose = {
    connect: async () => {
      connectCount += 1;
      if (connectCount === 1) {
        throw new Error("temporary mongo outage");
      }
      return fakeMongoose;
    },
  };
  const { db, restore } = loadDbWithMongoose(fakeMongoose);
  t.after(restore);

  await assert.rejects(db.connect(), /temporary mongo outage/);
  const connection = await db.connect();

  assert.equal(connectCount, 2);
  assert.equal(connection, fakeMongoose);
});
