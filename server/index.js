const Q = require('q');
const mongoose = require('mongoose');

mongoose.Promise = Q.Promise;
const rp = require('request-promise');

const newPost = require('./models/newPost');

const connectToDB = () => {
  mongoose.connect(
    process.env.MONGO_URI || 'mongodb://localhost/f5oclock',
    {
      useNewUrlParser: true,
      useCreateIndex: true,
      useFindAndModify: false,
      useUnifiedTopology: true,
    },
  ).catch(
    err => console.warn(`MongoDB connection error: ${err}`), // eslint-disable-line no-console
  );
};

const wait = (sec = 5) => {
  const deferred = Q.defer();
  setTimeout(deferred.resolve, sec * 1000);
  return deferred.promise;
};

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
    }, { upsert: true }));
  });

  return Q.all(insertPromises)
    .catch((e) => {
      console.warn(`Error Inserting Posts @ ${Date.now()}: ${e}`); // eslint-disable-line no-console
    })
    .fin(() => {
      insertPromises = [];
    })
    .done();
};

const subreddit = process.env.SUBREDDIT || 'politics';
const redditUrl = `https://www.reddit.com/r/${subreddit}/rising.json`;

const fetchPosts = () => rp(redditUrl)
  .then(parseHtmlJson)
  .then(insertNewPosts)
  .then(() => wait())
  .then(fetchPosts)
  .then(
    console.log(`Saved New Posts @ ${Date.now()}`), // eslint-disable-line no-console
    console.log(`Currently using ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB of memory \n`), // eslint-disable-line no-console
  )
  .catch(() => {
    console.warn(`Error Fetching Posts @ ${Date.now()}. This may be due to a timeout from Reddit. F5 will try again shortly.`); // eslint-disable-line no-console
    wait(3).then(fetchPosts);
  });

connectToDB();

mongoose.connection.on('connected', () => {
  console.log('F5 is now saving posts to MongoDB...\n'); // eslint-disable-line no-console
  wait(3).then(fetchPosts); // Start
});

mongoose.connection.on('disconnected', (err) => {
  console.warn(`MongoDB disconnected: ${err}`); // eslint-disable-line no-console
  setTimeout(() => { connectToDB(); }, 3000);
});

mongoose.connection.on('error', (err) => {
  console.warn(`MongoDB error: ${err}`); // eslint-disable-line no-console
  setTimeout(() => { connectToDB(); }, 3000);
});
