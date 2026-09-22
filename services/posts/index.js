const mongoose = require("./db");
const Post = require("./models/post");
const { createCorsHeaders, isAllowedOrigin } = require("./cors");

const configuredSubreddits = require("./subreddits.json");
const subredditNames = new Map(configuredSubreddits.map((name) => [name.toLowerCase(), name]));

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
} = {}) => {
  const cache = new Map();
  const pending = new Map();
  const loadPosts = async (subreddit) => {
    const currentDate = now();
    const cached = cache.get(subreddit);
    if (cached && cached.expiresAt > currentDate.getTime()) return cached.posts;
    if (pending.has(subreddit)) return pending.get(subreddit);

    const request = (async () => {
      await mongooseClient.connect();
      const hours = currentDate.getUTCHours();
      const searchTime = Math.floor(currentDate.getTime() / 1000) -
        (hours >= 11 && hours <= 23 ? 14400 : 28800);
      const posts = await postModel.find({
        created_utc: { $gt: searchTime },
        upvoteCount: { $gt: 5 },
        sub: subreddit,
      }).sort({ upvoteCount: -1, created_utc: 1 }).maxTimeMS(2000).limit(20);
      cache.set(subreddit, { posts, expiresAt: now().getTime() + 10000 });
      return posts;
    })();
    pending.set(subreddit, request);
    try {
      return await request;
    } finally {
      pending.delete(subreddit);
    }
  };

  return async (event = {}) => {
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

    const canonicalSubreddit = typeof subreddit === "string" &&
      subredditNames.get(subreddit.toLowerCase());
    if (!canonicalSubreddit) {
      return jsonResponse(400, { success: false, error: "Unsupported subreddit" }, origin);
    }

    try {
      const posts = await loadPosts(canonicalSubreddit);

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
};

module.exports.createGetPostsBySubreddit = createGetPostsBySubreddit;

// CREATE
module.exports.get_posts_by_subreddit = createGetPostsBySubreddit();
