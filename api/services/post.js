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
    return await Post.find({ sub: subreddit });
  }
  catch (error) {
    throw new Error(error.message);
  }
};
