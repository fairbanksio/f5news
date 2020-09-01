

const Q = require('q');
const mongoose = require('mongoose');

mongoose.Promise = Q.Promise;
// const _ = require('lodash');
const rp = require('request-promise');

const newPost = require('./models/newPost');

function connectToDB() {
  mongoose.connect(
    process.env.MONGO_URI || 'mongodb://localhost/f5oclock',
    {
      useNewUrlParser: true,
      useCreateIndex: true,
      useFindAndModify: false,
      useUnifiedTopology: true,
    },
  ).catch(
    err => console.warn(`MongoDB connect error: ${err}`), // eslint-disable-line no-console
  );
}

connectToDB();

mongoose.connection.on('connected', () => {
  console.log('f5 o\'clock is now saving posts to MongoDB...'); // eslint-disable-line no-console
});

mongoose.connection.on('disconnected', (err) => {
  console.warn(`MongoDB disconnected: ${err}`); // eslint-disable-line no-console
  setTimeout(() => { connectToDB(); }, 3000);
});

mongoose.connection.on('error', (err) => {
  console.warn(`MongoDB error: ${err}`); // eslint-disable-line no-console
  setTimeout(() => { connectToDB(); }, 3000);
});

function wait(sec = 5) {
  const deferred = Q.defer();
  setTimeout(deferred.resolve, sec * 1000);
  return deferred.promise;
}

function parseHtmlJson(htmlString) {
  const jsonData = JSON.parse(htmlString);
  return jsonData.data.children;
}

function insertNewPosts(newPosts) {
  const insertPromises = [];
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

  return Q.all(insertPromises);
}

function fetchPosts() {
  return rp('https://www.reddit.com/r/politics/rising.json')
    .then(parseHtmlJson)
    .then(insertNewPosts)
    .then(() => wait())
    .then(fetchPosts)
    .catch((_err) => {
      console.warn(`Error Fetching Posts. This may be due to a timeout on Reddit's side. f5 will try again shortly.`); // eslint-disable-line no-console
      wait(10).then(fetchPosts);
    });
}

fetchPosts(); // Start
