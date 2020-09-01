import express from 'express';
import Q from 'q';
import mongoose from 'mongoose';
import path from 'path';
import newPost from './models/newPost';

mongoose.Promise = Q.Promise;

const app = express();
const port = process.env.PORT || 3000;

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
    err => console.warn(`MongoDB connect error: ${err}`) // eslint-disable-line no-console
  );
};

connectToDB();

mongoose.connection.on('connected', () => {
  console.log('F5 is connected to MongoDB...'); // eslint-disable-line no-console
});

mongoose.connection.on('disconnected', (err) => {
  console.warn(`MongoDB disconnected: ${err}`); // eslint-disable-line no-console
  setTimeout(() => { connectToDB(); }, 3000);
});

mongoose.connection.on('error', (err) => {
  console.warn(`MongoDB error: ${err}`); // eslint-disable-line no-console
  setTimeout(() => { connectToDB(); }, 3000);
});

app.use(express.static(path.resolve(__dirname, '/public')));
app.engine('html', require('ejs').renderFile);

app.get('/', (_req, res) => { res.render('index.html'); });
app.get('/getPosts', (_req, res) => {
  const utcDate = Math.floor((new Date()).getTime() / 1000);
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
  newPost
    .find({ created_utc: { $gt: searchTime },  upvoteCount: { $gt: 5 } })
    .sort({ upvoteCount: -1, created_utc: 1 })
    .limit(20)
    .exec()
    .then(data => res.send(data))
    .catch(console.warn); // eslint-disable-line no-console
});

app.listen(port, () => {
  console.log(`F5 is now running on port ${port}!`); // eslint-disable-line no-console
});
