const Post = require('../models/post');

exports.getSubreddits = async (req, res) => {
  try {
    const posts = await Post.find();

    return res.status(200).json({
      success: true,
      count: posts.length,
      data: posts
    });
  }
  catch (error) {
    return res.status(500).json({
      success: false,
      error: `Error fetching data: ${error.message}`
    });
  }
};
