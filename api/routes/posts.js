const express = require('express');
const { getPosts, getPostsBySubreddit, getPostTitlesBySubreddit } = require('../controllers/post');

const router = express.Router();

router
  .route('/posts/')
  .get(getPosts);
router
  .route('/posts/:sub')
  .get(getPostsBySubreddit);

router
  .route('/posts/:sub/titles')
  .get(getPostTitlesBySubreddit);

module.exports = router;
