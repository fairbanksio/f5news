const http = require("http");

const { get_subreddits: getSubreddits } = require("./index");
const { createCorsHeaders } = require("./cors");

const defaultPreflightHeaders = {
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const writeJson = (res, statusCode, body, headers = {}) => {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    ...headers,
  });
  res.end(JSON.stringify(body));
};

const createLocalServer = ({ handler = getSubreddits } = {}) => http.createServer(
  async (req, res) => {
    const origin = req.headers.origin;
    const corsHeaders = createCorsHeaders(origin);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...defaultPreflightHeaders,
        ...corsHeaders,
      });
      res.end();
      return;
    }

    if (req.method !== "GET" || !["/subreddits", "/subreddits/"].includes(req.url)) {
      writeJson(res, 404, {
        success: false,
        error: "Not found",
      });
      return;
    }

    const response = await handler({
      headers: {
        origin,
      },
    });
    res.writeHead(response.statusCode, {
      "Content-Type": "application/json",
      ...response.headers,
    });
    res.end(response.body);
  }
);

const getStartPort = ({ port = process.env.PORT } = {}) => port || 3002;

const start = ({ port = getStartPort(), log = console.log } = {}) => {
  const server = createLocalServer();

  server.listen(port, () => {
    log(`Subreddits service listening on http://localhost:${server.address().port}/subreddits`);
  });

  return server;
};

module.exports = {
  createLocalServer,
  getStartPort,
  start,
};
