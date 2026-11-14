const catalogPath = require.resolve("../../posts/subreddits.json");
const multipleFeeds = Object.freeze(["politics", "news", "worldnews"]);

// Batch failure and concurrency scenarios still need more than one configured feed.
const loadWithMultipleFeeds = (load) => {
  require(catalogPath);
  const catalog = require.cache[catalogPath];
  const activeFeeds = catalog.exports;
  try {
    catalog.exports = multipleFeeds;
    return load();
  } finally {
    catalog.exports = activeFeeds;
  }
};

module.exports = { multipleFeeds, loadWithMultipleFeeds };
