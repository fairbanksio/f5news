'use strict'
const fs = require('fs');
const mongoose = require('mongoose');
let mongoUri

// Get secret for MongoDB access


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
  console.log(event.query); // eslint-disable-line no-console
  const result = {
    'body': JSON.stringify({extra: mongoUri}),
    'content-type': event.headers["content-type"]
  }

  const utcDate = Math.floor(new Date().getTime() / 1000);
  // Depending on time per day 30 minute and 60 minute searches in database
  const timeAdjust = () => {
    const today = new Date().getUTCHours();
    if (today >= 11 && today <= 23) {
      return '7200'; // 2 Hours
    } else {
      return '14400'; // 4 Hours
    }
  };

  const searchTime = utcDate - timeAdjust();
  // Search the db and return up to 20 docs
  try {
    const searchSub = event.query? event.query.sub? event.query.sub: "politics" : "politics";
    const posts = await post
      .find({ created_utc: { $gt: searchTime }, upvoteCount: { $gt: 5 }, sub: searchSub  })
      .sort({ upvoteCount: -1, created_utc: 1 })
      .limit(20)
      .exec()

    return context
      .headers(
        {
          'Content-type': 'application/json',
          "Access-Control-Allow-Origin": "*"
        }
      )
      .status(200)
      .succeed({posts:posts})

  } catch (error) {
    return context
      .status(503)
      .succeed({error: "There was an error fetching posts"})
  }
  
}
