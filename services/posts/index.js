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

const createGetPostsBySubreddit = ({
  mongooseClient = mongoose,
  postModel = Post,
  now = () => new Date(),
} = {}) => async (event) => {
  const origin = getRequestOrigin(event);

  if (!isAllowedOrigin(origin)) {
    return jsonResponse(403, {
      success: false,
      error: "Forbidden origin",
    }, origin);
  }

  const subreddit = event.pathParameters && event.pathParameters.subreddit;

  if (!subreddit) {
    return jsonResponse(400, {
      success: false,
      error: "Missing subreddit path parameter",
    }, origin);
  }

  try {
    // connect to database
    await mongooseClient.connect();

    // define time range
    // Depending on time per day 30 minute and 60 minute searches in database
    const currentDate = now();
    const utcDate = Math.floor(currentDate.getTime() / 1000);

    const timeAdjust = () => {
      const today = currentDate.getUTCHours();
      if (today >= 11 && today <= 23) {
        return "14400"; // 4 Hours
      }
      return "28800"; // 8 Hours
    };
    const searchTime = utcDate - timeAdjust();

    // fetch posts
    const posts = await postModel.find({
      created_utc: { $gt: searchTime },
      upvoteCount: { $gt: 5 },
      sub: subreddit,
    })
      .sort({ upvoteCount: -1, created_utc: 1 })
      .limit(20);

    // return results
    return jsonResponse(200, {
      success: true,
      count: posts.length,
      data: posts,
    }, origin);
  } catch (error) {
    return jsonResponse(500, {
      success: false,
      error: "Failed to fetch posts",
    }, origin);
  }
};

module.exports.createGetPostsBySubreddit = createGetPostsBySubreddit;

// CREATE
module.exports.get_posts_by_subreddit = createGetPostsBySubreddit();
