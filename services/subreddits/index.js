const { createCorsHeaders, isAllowedOrigin } = require("./cors");

const configuredSubreddits = [
  "politics",
  "worldnews",
  "europe",
  "news",
  "technology",
  "science",
  "health",
  "energy",
  "sports",
  "business",
  "Economics",
];

const getRequestOrigin = (event = {}) => {
  const headers = event.headers || {};
  return headers.origin || headers.Origin;
};

const jsonResponse = (statusCode, body, origin) => ({
  statusCode,
  headers: createCorsHeaders(origin),
  body: JSON.stringify(body),
});

const getSubreddits = async (event = {}) => {
  const origin = getRequestOrigin(event);

  if (!isAllowedOrigin(origin)) {
    return jsonResponse(403, {
      success: false,
      error: "Forbidden origin",
    }, origin);
  }

  return jsonResponse(200, {
    success: true,
    count: configuredSubreddits.length,
    data: configuredSubreddits,
  }, origin);
};

module.exports.get_subreddits = getSubreddits;
