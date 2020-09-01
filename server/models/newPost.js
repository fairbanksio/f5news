
const mongoose = require('mongoose');

const fetchedPost = new mongoose.Schema(
  {
    title: 'string',
    domain: 'string',
    commentLink: 'string',
    url: 'string',
    thumbnail: 'string',
    created_utc: 'number',
    upvoteCount: 'number',
    commentCount: 'number',
    author: 'string',
    fetchedAt: {
      type: Date,
      default: new Date(),
      expires: 360,
    },
  }, { collection: 'newposts' },
);

const newPost = mongoose.model('newPost', fetchedPost);

module.exports = newPost;
