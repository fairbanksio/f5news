const mongoose = require("./db");
const Post = require("./models/post");
const { createCorsHeaders, isAllowedOrigin } = require("./cors");

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
  now = () => new Date(),
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

    const utcDate = Math.floor(now().getTime() / 1000);
    const searchTime = utcDate - 14400;
    let subreddits = await postModel.distinct("sub", {
      created_utc: { $gt: searchTime },
      upvoteCount: { $gt: 5 },
    }).exec();

    if (subreddits.length === 0) {
      subreddits = await postModel.distinct("sub", {}).exec();
    }

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
