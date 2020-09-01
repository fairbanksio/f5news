const env = process.env.NODE_ENV || 'dev';

module.exports = require(`./${env}`); // eslint-disable-line import/no-dynamic-require