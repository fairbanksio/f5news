const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const yaml = require("js-yaml");

const getScheduledSubreddits = () => {
  const serverlessConfig = yaml.load(
    fs.readFileSync(path.join(__dirname, "serverless.yml"), "utf8"),
  );

  return serverlessConfig.functions.fetchPosts.events
    .filter((event) => event.schedule)
    .map((event) => event.schedule.input.subreddit);
};

test("fetchPosts is scheduled for the supported news subreddits", () => {
  assert.deepEqual(getScheduledSubreddits(), [
    "politics",
    "worldnews",
    "europe",
    "news",
    "technology",
    "science",
    "health",
    "environment",
    "energy",
    "sports",
    "business",
    "Economics",
  ]);
});
