
const { getSubreddits } = require('../services/subreddit');

exports.getSubreddits = async (req, res) => {
  try {
    const subreddits = await getSubreddits();

    return res.status(200).json({
      success: true,
      count: subreddits.length,
      data: subreddits
    });
  }
  catch (error) {
    return res.sendStatus(500);
  }
};