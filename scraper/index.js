const Q = require('q');
const mongoose = require('mongoose');
const fs = require('fs');

mongoose.Promise = Q.Promise;
const rp = require('request-promise');

const newPost = require('./models/newPost');

const subreddit = process.env.SUBREDDIT || 'politics';
const redditUrl = `https://www.reddit.com/r/${subreddit}/rising.json`;

fs.readFile('/var/openfaas/secrets/mongouri', 'utf8', (secretError, mongoUri) => {
  if (secretError) {
    console.log(secretError); // eslint-disable-line no-console
  }

  mongoose.connect(
    mongoUri,
    {
      useNewUrlParser: true,
      useCreateIndex: true,
      useFindAndModify: false,
      useUnifiedTopology: true,
    },
  ).catch(
    (dbError) => console.warn(`MongoDB connection error: ${dbError}`), // eslint-disable-line no-console
  );
});

const parseHtmlJson = (htmlString) => {
  let jsonData = null;
  jsonData = JSON.parse(htmlString);
  return jsonData.data.children;
};

const insertNewPosts = (newPosts) => {
  let insertPromises = [];
  // Fill array with promises
  newPosts.forEach((value) => {
    insertPromises.push(newPost.findOneAndUpdate({
      title: value.data.title,
      author: value.data.author,
      created_utc: value.data.created_utc,
    }, {
      title: value.data.title,
      domain: value.data.domain,
      url: value.data.url,
      commentLink: value.data.permalink,
      thumbnail: value.data.thumbnail,
      author: value.data.author,
      created_utc: value.data.created_utc,
      upvoteCount: value.data.ups,
      commentCount: value.data.num_comments,
      fetchedAt: new Date(),
      sub: subreddit,
    }, { upsert: true }));
  });

  return Q.all(insertPromises)
    .catch((e) => {
      console.warn(`Error Inserting Posts @ ${Date.now()}: ${e}`); // eslint-disable-line no-console
    })
    .fin(() => {
      insertPromises = [];
      mongoose.disconnect();
    })
    .done();
};

const fetchPosts = () => {
  rp({ uri: redditUrl, timeout: 4000 })
    .then(parseHtmlJson)
    .then(insertNewPosts)
    .then(
      console.log(`Saved New Posts @ ${Date.now()}`), // eslint-disable-line no-console
      console.log(`Currently using ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB of memory \n`), // eslint-disable-line no-console
    )
    .catch(() => {
      console.warn(`Error Fetching Posts @ ${Date.now()}. This may be due to a timeout from Reddit.`); // eslint-disable-line no-console
      mongoose.disconnect();
    })
    .done();
};

mongoose.connection.on('connected', () => {
  console.log(`F5 is now saving posts to MongoDB from ${subreddit}...\n`); // eslint-disable-line no-console
  fetchPosts();
});

mongoose.connection.on('disconnected', (err) => {
  console.warn(`MongoDB disconnected: ${err}`); // eslint-disable-line no-console
});

mongoose.connection.on('error', (err) => {
  console.warn(`MongoDB error: ${err}`); // eslint-disable-line no-console
});
