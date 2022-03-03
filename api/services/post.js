const Post = require('../models/post');

/*
  * if you need to make calls to additional tables, data stores (Redis, for example),
  * or call an external endpoint as part of creating the blogpost, add them to this service
*/

exports.getPosts = async () => {
  try {
    return await Post.find();
  }
  catch (error) {
    throw new Error(error.message);
  }
};

exports.getPostsBySubreddit = async (subreddit) => {
  try {
    const utcDate = Math.floor(new Date().getTime() / 1000);
    // Depending on time per day 30 minute and 60 minute searches in database
    const timeAdjust = () => {
      const today = new Date().getUTCHours();
      if (today >= 11 && today <= 23) {
        return '7200'; // 2 Hours
      } else {
        return '14400'; // 4 Hours
      }
    };
    const searchTime = utcDate - timeAdjust();

    return await Post.find({ created_utc: { $gt: searchTime }, upvoteCount: { $gt: 5 }, sub: subreddit  })
    .sort({ upvoteCount: -1, created_utc: 1 })
    .limit(20)
  }
  catch (error) {
    throw new Error(error.message);
  }
};
