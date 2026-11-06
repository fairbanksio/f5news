const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const yaml = require("js-yaml");

test("one scheduled batch covers the supported news feeds", () => {
  const config = yaml.load(fs.readFileSync(path.join(__dirname, "serverless.yml"), "utf8"));
  const schedules = config.functions.fetchPosts.events.filter((event) => event.schedule?.input.allFeeds === true);
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].schedule.rate, "rate(5 minutes)");
  assert.equal(schedules[0].schedule.input.allFeeds, true);
  assert.equal(schedules[0].schedule.input.subreddit, undefined);
  assert.deepEqual(require("../posts/subreddits.json"), [
    "politics", "worldnews", "europe", "news", "technology", "science",
    "health", "energy", "sports", "business", "Economics",
  ]);
});

test("browser scraper uses an ARM64 image without Reddit API client credentials", () => {
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
  assert.ok(config.functions.fetchPosts.memorySize >= 4096);
  assert.equal(config.provider.environment.REDDIT_CLIENT_ID, undefined);
  assert.equal(config.provider.environment.REDDIT_SECRET_KEY, undefined);
  assert.deepEqual(Object.keys(config.provider.environment), ["MONGO_CONNECTION_STRING", "REDDIT_USERNAME", "REDDIT_PASSWORD", "F5_REDDIT_SESSION_BUCKET", "F5_REDDIT_SESSION_ENABLED"]);
});

test("scheduled feeds reuse the shared session without independent login attempts", () => {
  const config = yaml.load(fs.readFileSync(path.join(__dirname, "serverless.yml"), "utf8"));
  assert.equal(config.provider.environment.F5_REDDIT_SESSION_BUCKET, "${env:F5_REDDIT_SESSION_BUCKET, ssm:/f5_reddit_session_bucket}");
  assert.equal(config.provider.environment.F5_REDDIT_SESSION_ENABLED, "true");
  const schedules = config.functions.fetchPosts.events.map((event) => event.schedule);
  assert.equal(schedules.length, 2);
  for (const schedule of schedules) {
    assert.equal(schedule.enabled, true);
    assert.equal(schedule.input.session, true);
    assert.equal(schedule.input.scheduled, true);
    assert.equal(schedule.input.authenticate, undefined);
  }
  const renewal = schedules.find((schedule) => schedule.input.renewSession === true);
  assert.equal(renewal.rate, "rate(12 hours)");
  assert.equal(renewal.input.subreddit, "politics");
  assert.equal(renewal.input.allFeeds, undefined);
  assert.deepEqual(config.provider.iam.role.statements, [{
    Sid: "SharedRedditSessionObjects",
    Effect: "Allow",
    Action: ["s3:GetObject", "s3:PutObject"],
    Resource: { "Fn::Join": ["", ["arn:", { Ref: "AWS::Partition" }, ":s3:::", "${self:provider.environment.F5_REDDIT_SESSION_BUCKET}", "/reddit/sessions/*.json"]] },
  }]);
});

test("renaming the scraper retains its previous log group", () => {
  const config = yaml.load(fs.readFileSync(path.join(__dirname, "serverless.yml"), "utf8"));
  assert.equal(config.resources.extensions.FetchPostsLogGroup.UpdateReplacePolicy, "Retain");
  assert.equal(config.resources.extensions.FetchPostsLogGroup.DeletionPolicy, undefined);
});
