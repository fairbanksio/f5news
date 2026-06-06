const assert = require("assert");
const test = require("node:test");

const { createLocalServer, getStartPort, start } = require("./local-server");

const closeServer = (server) => new Promise((resolve) => {
  if (!server.listening) {
    resolve();
    return;
  }

  server.close(resolve);
});

const request = (server, path, options = {}) => new Promise((resolve, reject) => {
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    const req = require("http").request({
      hostname: "127.0.0.1",
      port,
      path,
      method: options.method || "GET",
      headers: options.headers || {},
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        closeServer(server).then(() => {
          resolve({ res, body });
        });
      });
    });

    req.on("error", async (error) => {
      await closeServer(server);
      reject(error);
    });
    req.end();
  });

  server.on("error", async (error) => {
    await closeServer(server);
    reject(error);
  });
});

test("serves the subreddits handler at /subreddits", async () => {
  const server = createLocalServer({
    handler: async () => ({
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "https://f5.news",
      },
      body: JSON.stringify({
        success: true,
        count: 1,
        data: ["news"],
      }),
    }),
  });

  const { res, body } = await request(server, "/subreddits", {
    headers: {
      origin: "https://f5.news",
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["access-control-allow-origin"], "https://f5.news");
  assert.deepEqual(JSON.parse(body), {
    success: true,
    count: 1,
    data: ["news"],
  });
});

test("serves the subreddits handler at /subreddits/", async () => {
  const server = createLocalServer({
    handler: async () => ({
      statusCode: 200,
      headers: {},
      body: JSON.stringify({ success: true, count: 0, data: [] }),
    }),
  });

  const { res } = await request(server, "/subreddits/");

  assert.equal(res.statusCode, 200);
});

test("returns not found for unsupported paths", async () => {
  const server = createLocalServer();

  const { res, body } = await request(server, "/posts");

  assert.equal(res.statusCode, 404);
  assert.deepEqual(JSON.parse(body), {
    success: false,
    error: "Not found",
  });
});

test("returns no content for options requests", async () => {
  const server = createLocalServer();

  const { res, body } = await request(server, "/subreddits", {
    method: "OPTIONS",
    headers: {
      origin: "https://www.f5.news",
    },
  });

  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["access-control-allow-origin"], "https://www.f5.news");
  assert.equal(res.headers["access-control-allow-credentials"], undefined);
  assert.equal(body, "");
});

test("start listens on the configured port and logs the local URL", async () => {
  const messages = [];
  const server = start({
    port: 0,
    log: (message) => messages.push(message),
  });

  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();

    assert.deepEqual(messages, [
      `Subreddits service listening on http://localhost:${port}/subreddits`,
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("start defaults to port 3002", () => {
  const previousPort = process.env.PORT;

  delete process.env.PORT;

  try {
    assert.equal(getStartPort(), 3002);
  } finally {
    if (previousPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
  }
});

test("start uses the PORT environment override", () => {
  const previousPort = process.env.PORT;

  process.env.PORT = "3999";

  try {
    assert.equal(getStartPort(), "3999");
  } finally {
    if (previousPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
  }
});
