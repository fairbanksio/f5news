const mongoose = require("./db");
const Post = require("./models/post");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": true,
};

// CREATE
module.exports.get_subreddits = async (event) => {
  // connect to database
  await mongoose.connect();

  const utcDate = Math.floor(new Date().getTime() / 1000);
  const searchTime = utcDate - 14400;
  const subreddits = await Post.distinct("sub", {
    created_utc: { $gt: searchTime },
    upvoteCount: { $gt: 5 },
  }).exec();

  // return results
  return {
    statusCode: 200,
    headers: headers,
    body: JSON.stringify({
      success: true,
      count: subreddits.length,
      data: subreddits,
    }),
  };
};
