const mongoose = require('mongoose');

const fetchedPost = new mongoose.Schema({
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
    expires: 86400,
  },
  is_video: Boolean,
  media: Object,
  is_gallery: Boolean,
  gallery_data: Object,
  media_metadata: Object,
  is_self: Boolean, 
  selftext: 'string',
  selftext_html: 'string',
  upvote_ratio: 'number',
  post_hint: 'string',
  sub: 'string',
}, { collection: 'newposts' });

const newPost = mongoose.model('newPost', fetchedPost);

module.exports = newPost;
