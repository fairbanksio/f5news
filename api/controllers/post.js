const { getPosts, getPostsBySubreddit, getPostTitlesBySubreddit } = require('../services/post');

exports.getPosts = async (req, res) => {
  try {
    const posts = await getPosts();

    return res.status(200).json({
      success: true,
      count: posts.length,
      data: posts
    });
  }
  catch (error) {
    return res.sendStatus(500);
  }
};

exports.getPostsBySubreddit = async (req, res) => {
  const { sub } = req.params;
  try {
    const posts = await getPostsBySubreddit(sub);

    return res.status(200).json({
      success: true,
      count: posts.length,
      data: posts
    });
  }
  catch (error) {
    return res.sendStatus(500);
  }
};

exports.getPostTitlesBySubreddit = async (req, res) => {
  const { sub } = req.params;
  try {
    const posts = await getPostTitlesBySubreddit(sub);

    return res.status(200).json({
      success: true,
      count: posts.length,
      data: posts
    });
  }
  catch (error) {
    return res.sendStatus(500);
  }
};