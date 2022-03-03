const Post = require('../models/post');

/*
  * if you need to make calls to additional tables, data stores (Redis, for example),
  * or call an external endpoint as part of creating the blogpost, add them to this service
*/

exports.getSubreddits = async () => {
  const utcDate = Math.floor(new Date().getTime() / 1000);
  const searchTime = utcDate - 14400;
  try {
    return await Post
      .distinct('sub', {
        created_utc: { $gt: searchTime },
        upvoteCount: { $gt: 5 }
      })
      .exec();
  }
  catch (error) {
    throw new Error(error.message);
  }
};
