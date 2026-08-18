const mongoose = require("./db");
const Post = require("./models/post");
const { createCorsHeaders, isAllowedOrigin } = require("./cors");

const configuredSubreddits = [
  "politics",
  "worldnews",
  "news",
  "technology",
  "science",
  "environment",
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

const createGetSubreddits = ({
  mongooseClient = mongoose,
  postModel = Post,
} = {}) => async (event = {}) => {
  const origin = getRequestOrigin(event);

  if (!isAllowedOrigin(origin)) {
    return jsonResponse(403, {
      success: false,
      error: "Forbidden origin",
    }, origin);
  }

  try {
    // connect to database
    await mongooseClient.connect();

    const knownSubreddits = await postModel.distinct("sub", {}).exec();
    const subreddits = [...new Set([...configuredSubreddits, ...knownSubreddits])];

    // return results
    return jsonResponse(200, {
      success: true,
      count: subreddits.length,
      data: subreddits,
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
