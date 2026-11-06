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
    "energy",
    "sports",
    "business",
    "Economics",
  ]);
});

test("browser scraper uses an ARM64 image without Reddit API credentials", () => {
  const config = yaml.load(fs.readFileSync(path.join(__dirname, "serverless.yml"), "utf8"));
  assert.equal(config.provider.architecture, "arm64");
  assert.deepEqual(config.provider.ecr.images.scraper, {
    path: "../..", file: "services/scraper/Dockerfile", platform: "linux/arm64", provenance: false,
  });
  assert.equal(config.functions.fetchPosts.image, "scraper");
  assert.equal(config.functions.fetchPosts.name, "${self:service}-${sls:stage}-fetchPosts-browser");
  assert.equal(config.functions.fetchPosts.handler, undefined);
  assert.equal(config.provider.runtime, undefined);
  assert.ok(config.functions.fetchPosts.timeout < 300);
  assert.ok(config.functions.fetchPosts.memorySize >= 2048);
  assert.deepEqual(Object.keys(config.provider.environment), ["MONGO_CONNECTION_STRING"]);
});

test("renaming the scraper retains its previous log group", () => {
  const config = yaml.load(fs.readFileSync(path.join(__dirname, "serverless.yml"), "utf8"));
  assert.equal(config.resources.extensions.FetchPostsLogGroup.UpdateReplacePolicy, "Retain");
  assert.equal(config.resources.extensions.FetchPostsLogGroup.DeletionPolicy, undefined);
});
