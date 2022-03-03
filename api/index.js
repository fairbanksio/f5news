const express = require('express');
const mongoose = require('mongoose');
var cors = require('cors')
const fs = require('fs');

const app = express();
const api = require('./routes');

const PORT = process.env.PORT || 3000;
const mongoURI = process.env.MONGOURI || fs.readFileSync('/home/mgmtadmin/bsord-io/secrets/mongouri').toString();

// Connect to database
mongoose
  .connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .catch((err) => {
    console.warn(`MongoDB connect error: ${err}`); // eslint-disable-line no-console
  });

// Enable Cors
var corsOptions = {
  origin: '*',
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
}
app.use(cors(corsOptions))

// Express body parser
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Routes
app.use('/', api);

// Listen
app.listen(PORT, console.log(`Server started on port ${PORT}`)); // eslint-disable-line no-console
