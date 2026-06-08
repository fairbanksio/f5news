const { createCorsHeaders, isAllowedOrigin } = require("./cors");

const configuredSubreddits = [
  "politics",
  "worldnews",
  "europe",
  "news",
  "technology",
  "science",
  "health",
  "environment",
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

const createGetSubreddits = () => async (event = {}) => {
  const origin = getRequestOrigin(event);

  if (!isAllowedOrigin(origin)) {
    return jsonResponse(403, {
      success: false,
      error: "Forbidden origin",
    }, origin);
  }

  try {
    // return results
    return jsonResponse(200, {
      success: true,
      count: configuredSubreddits.length,
      data: configuredSubreddits,
    }, origin);
  } catch (error) {
    return jsonResponse(500, {
      success: false,
      error: "Failed to fetch subreddits",
    }, origin);
  }
};

module.exports.createGetSubreddits = createGetSubreddits;

// CREATE
module.exports.get_subreddits = createGetSubreddits();
