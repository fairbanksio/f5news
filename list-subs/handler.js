'use strict'
const fs = require('fs');
const mongoose = require('mongoose');
let mongoUri

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
    rpan_video: Object,
    sub: 'string',
  }, { collection: 'newposts' },
);

const post = mongoose.model('newPost', fetchedPost);

// Connect to database
fs.readFile('/var/openfaas/secrets/mongouri', 'utf8', function(err, mongoUri){
  mongoose
  .connect(mongoUri, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useFindAndModify: false,
    useUnifiedTopology: true,
  })
  .catch(
    err => console.warn(`MongoDB connect error: ${err}`) // eslint-disable-line no-console
  );
});

// Database event handlers
mongoose.connection.on('connected', () => {
  console.log('F5 is connected to MongoDB...'); // eslint-disable-line no-console
});
mongoose.connection.on('disconnected', (err) => {
  console.warn(`MongoDB disconnected: ${err}`); // eslint-disable-line no-console
  setTimeout(() => {
    connectToDB();
  }, 3000);
});
mongoose.connection.on('error', (err) => {
  console.warn(`MongoDB error: ${err}`); // eslint-disable-line no-console
  setTimeout(() => {
    connectToDB();
  }, 3000);
});

// main request handler
module.exports = async (event, context) => {
  const utcDate = Math.floor(new Date().getTime() / 1000);

  const searchTime = utcDate - 14400;
  // Search the db and return up to 20 docs
  try {
    const posts = await post
      .distinct('sub',{ created_utc: { $gt: searchTime }, upvoteCount: { $gt: 5 } })
      .exec()

    return context
      .headers(
        {
          'Content-type': 'application/json',
          "Access-Control-Allow-Origin": "*"
        }
      )
      .status(200)
      .succeed({subs:posts})

  } catch (error) {
    console.log(error)
    return context
      .headers(
        {
          'Content-type': 'application/json',
          "Access-Control-Allow-Origin": "*"
        }
      )
      .status(503)
      .succeed({error: "There was an error fetching posts"})
  }
  
}
