const assert = require("assert");
const test = require("node:test");

const mongoose = require("mongoose");

const dbPath = require.resolve("./db");
const originalConnect = mongoose.connect;

const loadDb = ({ connectionString, connectImpl }) => {
  const previousConnectionString = process.env.MONGO_CONNECTION_STRING;

  delete require.cache[dbPath];
  process.env.MONGO_CONNECTION_STRING = connectionString;
  mongoose.connect = connectImpl;

  const db = require("./db");

  return {
    db,
    restore() {
      mongoose.connect = originalConnect;
      delete require.cache[dbPath];

      if (previousConnectionString === undefined) {
        delete process.env.MONGO_CONNECTION_STRING;
      } else {
        process.env.MONGO_CONNECTION_STRING = previousConnectionString;
      }
    },
  };
};

test("connect opens mongoose with the configured connection string", async () => {
  const calls = [];
  const { db, restore } = loadDb({
    connectionString: "mongodb://example.test/subreddits",
    connectImpl: async (...args) => {
      calls.push(args);
    },
  });

  try {
    const connection = await db.connect();

    assert.equal(connection, mongoose);
    assert.deepEqual(calls, [
      [
        "mongodb://example.test/subreddits",
        {
          serverSelectionTimeoutMS: 5000,
        },
      ],
    ]);
  } finally {
    restore();
  }
});

test("connect reuses the in-flight mongoose connection", async () => {
  let connectCount = 0;
  const { db, restore } = loadDb({
    connectionString: "mongodb://example.test/subreddits",
    connectImpl: async () => {
      connectCount += 1;
    },
  });

  try {
    const firstConnection = db.connect();
    const secondConnection = db.connect();

    assert.equal(await firstConnection, mongoose);
    assert.equal(await secondConnection, mongoose);
    assert.equal(connectCount, 1);
  } finally {
    restore();
  }
});
