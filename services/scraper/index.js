const mongoose = require("./db");
const newPost = require("./models/newPost");
const { normalizeFetch } = require("./fetchInterop");
const {
  hasUsableThumbnail,
  imageSource,
  mapWithConcurrency,
} = require("./imageSource");

const IMAGE_SOURCE_CONCURRENCY = 10;

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetchImpl }) => fetchImpl(...args));

const insertNewPosts = (
  newPosts,
  subreddit,
  { imageSourceImpl = imageSource, logger = console, newPostModel = newPost } = {}
) => {
  logger.log("inserting new posts:", newPosts);
  // Fill array with promises
  const insertPromises = mapWithConcurrency(
    newPosts,
    IMAGE_SOURCE_CONCURRENCY,
    async (value) => {
      const postUpdate = {
        $set: {
          title: value.data.title,
          domain: value.data.domain,
          url: value.data.url,
          commentLink: value.data.permalink,
          author: value.data.author,
          created_utc: value.data.created_utc,
          upvoteCount: value.data.ups,
          commentCount: value.data.num_comments,
          fetchedAt: new Date(),
          post_hint: value.data.post_hint,
          is_video: value.data.is_video,
          media: value.data.media,
          is_gallery: value.data.is_gallery,
          gallery_data: value.data.gallery_data,
          media_metadata: value.data.media_metadata,
          is_self: value.data.is_self,
          selftext: value.data.selftext,
          selftext_html: value.data.selftext_html,
          upvote_ratio: value.data.upvote_ratio,
          rpan_video: value.data.rpan_video,
          sub: subreddit,
        },
      };

      const postKey = {
        title: value.data.title,
        author: value.data.author,
        created_utc: value.data.created_utc,
      };

      await newPostModel.findOneAndUpdate(postKey, postUpdate, { upsert: true });

      let thumbnail = value.data.thumbnail || "";
      try {
        thumbnail = await imageSourceImpl(value.data);
      } catch (error) {
        logger.warn(
          `Error resolving post image source @ ${Date.now()}: ${error}`
        );
      }

      const hasResolvedThumbnail = hasUsableThumbnail(thumbnail);

      if (hasResolvedThumbnail) {
        return newPostModel.findOneAndUpdate(
          postKey,
          { $set: { thumbnail } },
          { upsert: false }
        );
      }

      return null;
    }
  );

  return insertPromises.catch((e) => {
    logger.warn(`Error Inserting Posts @ ${Date.now()}: ${e}`);
  });
};

const createFetchPosts = ({
  env = process.env,
  fetchImpl = fetch,
  imageSourceImpl = imageSource,
  logger = console,
  mongooseClient = mongoose,
  newPostModel = newPost,
} = {}) => {
  const normalizedFetch = normalizeFetch(fetchImpl);

  return async (event) => {
    logger.log(event);
    const subreddit = event.subreddit || "politics";
    const redditUrl = `https://oauth.reddit.com/r/${subreddit}/rising`;
    logger.log(redditUrl);

    await mongooseClient.connect();

    // reddit api auth
    var username = env["REDDIT_USERNAME"];
    var password = env["REDDIT_PASSWORD"];
    var client_id = env["REDDIT_CLIENT_ID"];
    var client_secret = env["REDDIT_SECRET_KEY"];

    var details = {
      username: username,
      password: password,
      grant_type: "password",
    };
    var formBody = [];
    for (var property in details) {
      var encodedKey = encodeURIComponent(property);
      var encodedValue = encodeURIComponent(details[property]);
      formBody.push(encodedKey + "=" + encodedValue);
    }
    formBody = formBody.join("&");

    const access_token = await normalizedFetch(
      "https://www.reddit.com/api/v1/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Authorization: "Basic " + btoa(client_id + ":" + client_secret),
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        body: formBody,
      }
    )
      .then((response) => {
        return response.json();
      })
      .then((json) => {
        return json.access_token;
      });

    await normalizedFetch(redditUrl, {
      method: "GET",
      headers: {
        Authorization: "bearer " + access_token,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 f5",
      },
    })
      .then((response) => {
        return response.json();
      })
      .then((json) => {
        return json.data.children;
      })
      .then((posts) => {
        return insertNewPosts(posts, subreddit, {
          imageSourceImpl,
          logger,
          newPostModel,
        });
      })
      .then(() => {
        logger.log(`Saved New Posts @ ${Date.now()}`);
        logger.log(
          `Currently using ${(
            process.memoryUsage().heapUsed /
            1024 /
            1024
          ).toFixed(2)} MB of memory \n`
        );
      })
      .catch((error) => {
        logger.log("Error fetching posts:", error);
      });
  };
};

module.exports.createFetchPosts = createFetchPosts;
module.exports.fetchPosts = createFetchPosts();
