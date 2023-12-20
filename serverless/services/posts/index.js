const mongoose = require("./db");
const Post = require("./models/post");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": true,
};

// CREATE
module.exports.get_posts_by_subreddit = async (event) => {
  // get subreddit from url
  const subreddit = event["pathParameters"]["subreddit"];

  // connect to database
  await mongoose.connect();

  // define time range
  // Depending on time per day 30 minute and 60 minute searches in database
  const utcDate = Math.floor(new Date().getTime() / 1000);

  const timeAdjust = () => {
    const today = new Date().getUTCHours();
    if (today >= 11 && today <= 23) {
      return "7200"; // 2 Hours
    }
    return "14400"; // 4 Hours
  };
  const searchTime = utcDate - timeAdjust();

  // fetch posts
  const posts = await Post.find({
    created_utc: { $gt: searchTime },
    upvoteCount: { $gt: 5 },
    sub: subreddit,
  })
    .sort({ upvoteCount: -1, created_utc: 1 })
    .limit(20);

  // return results
  return {
    statusCode: 200,
    headers: headers,
    body: JSON.stringify({
      success: true,
      count: posts.length,
      data: posts,
    }),
  };
};
