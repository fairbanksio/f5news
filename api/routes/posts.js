const express = require('express');
const { getPosts, getPostsBySubreddit } = require('../controllers/post');

const router = express.Router();

router
  .route('/posts/')
  .get(getPosts);
router
  .route('/posts/:sub')
  .get(getPostsBySubreddit);

module.exports = router;
