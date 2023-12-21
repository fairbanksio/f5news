const express = require('express');
const postsRoute = require('./posts');
const subredditsRoute = require('./subreddits');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: 'ok' });
});

router.get('/healthz', (req, res) => {
  res.json({ message: 'ok' });
});

// Include other routes
router.use(postsRoute);
router.use(subredditsRoute);

module.exports = router;
