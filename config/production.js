'use strict';

module.exports = {
  mongo: {
    uri: "mongodb://f5oclock:" + process.env.MONGO_PASSWORD + "@ds113566.mlab.com:13566/heroku_w5x4rzvr"
  },
  logToMonitoring: true
};