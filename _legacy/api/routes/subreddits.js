const express = require('express');
const { getSubreddits } = require('../controllers/subreddit');

const router = express.Router();

router
  .route('/subreddits/')
  .get(getSubreddits);

module.exports = router;
