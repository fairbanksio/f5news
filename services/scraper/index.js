const mongoose = require("./db");
const newPost = require("./models/newPost");
const { normalizeFetch } = require("./fetchInterop");
const {
  hasUsableThumbnail,
  imageSource,
  mapWithConcurrency,
} = require("./imageSource");

const IMAGE_SOURCE_CONCURRENCY = 10;
const IMAGE_METRIC_NAMESPACE = "F5News/Scraper";
const IMAGE_BACKFILL_CONCURRENCY = 5;
const IMAGE_BACKFILL_LIMIT = 25;
const IMAGE_BACKFILL_LOOKBACK_SECONDS = 8 * 60 * 60;

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetchImpl }) => fetchImpl(...args));

const getPostDomain = (data) => data.domain || "unknown";

const getPostId = (data) => {
  if (data.id || data.name) {
    return data.id || data.name;
  }

  if (data._id) {
    return data._id.toString ? data._id.toString() : String(data._id);
  }

  return "";
};

const getPostUrl = (data) => data.url_overridden_by_dest || data.url || "";

const shouldTrackImageResolution = (data) => {
  return !data.is_self && !data.is_video && Boolean(getPostUrl(data));
};

const logStructured = (logger, payload) => {
  logger.log(JSON.stringify(payload));
};

const createImageFailureDiagnostics = () => {
  const failures = [];

  return {
    failures,
    options: {
      onArticleImageFailure: (failure) => {
        failures.push(failure);
      },
    },
  };
};

const imageFailureLogFields = (diagnostics) => {
  if (!diagnostics.failures.length) {
    return {};
  }

  return {
    imageResolutionFailures: diagnostics.failures.slice(-3),
  };
};

const createImageResolutionMetrics = (subreddit, operation) => ({
  subreddit,
  operation,
  attempts: 0,
  resolved: 0,
  missing: 0,
  errors: 0,
});

const logImageResolutionMetrics = (logger, metrics) => {
  if (metrics.attempts === 0) {
    return;
  }

  logStructured(logger, {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: IMAGE_METRIC_NAMESPACE,
          Dimensions: [["Service", "Subreddit", "Operation"]],
          Metrics: [
            {
              Name: "PostImageResolutionAttempts",
              Unit: "Count",
            },
            {
              Name: "PostImageResolutionResolved",
              Unit: "Count",
            },
            {
              Name: "PostImageResolutionMissing",
              Unit: "Count",
            },
            {
              Name: "PostImageResolutionErrors",
              Unit: "Count",
            },
          ],
        },
      ],
    },
    Service: "scraper",
    Subreddit: metrics.subreddit,
    Operation: metrics.operation,
    PostImageResolutionAttempts: metrics.attempts,
    PostImageResolutionResolved: metrics.resolved,
    PostImageResolutionMissing: metrics.missing,
    PostImageResolutionErrors: metrics.errors,
  });
};

const createPostKey = (data) => ({
  title: data.title,
  author: data.author,
  created_utc: data.created_utc,
});

const missingThumbnailFilter = () => ({
  $or: [
    { thumbnail: { $exists: false } },
    { thumbnail: null },
    { thumbnail: "" },
    { thumbnail: { $in: ["default", "self", "spoiler", "nsfw", "image"] } },
  ],
});

const findMissingThumbnailPosts = async (
  newPostModel,
  subreddit,
  { now = () => new Date(), lookbackSeconds = IMAGE_BACKFILL_LOOKBACK_SECONDS } = {}
) => {
  const createdAfter = Math.floor(now().getTime() / 1000) - lookbackSeconds;
  let query = newPostModel.find({
    sub: subreddit,
    created_utc: { $gt: createdAfter },
    is_self: { $ne: true },
    is_video: { $ne: true },
    url: { $exists: true, $ne: "" },
    ...missingThumbnailFilter(),
  });

  if (typeof query.sort === "function") {
    query = query.sort({ created_utc: -1 });
  }

  if (typeof query.limit === "function") {
    query = query.limit(IMAGE_BACKFILL_LIMIT);
  }

  return query;
};

const updatePostThumbnail = (newPostModel, data, thumbnail) => {
  const postKey = data._id ? { _id: data._id } : createPostKey(data);

  return newPostModel.findOneAndUpdate(
    postKey,
    { $set: { thumbnail } },
    { upsert: false }
  );
};

const backfillMissingPostImages = async (
  subreddit,
  {
    imageSourceImpl = imageSource,
    logger = console,
    newPostModel = newPost,
    now = () => new Date(),
  } = {}
) => {
  const imageMetrics = createImageResolutionMetrics(subreddit, "backfill");
  let posts;

  try {
    posts = await findMissingThumbnailPosts(newPostModel, subreddit, { now });
  } catch (error) {
    logger.warn(`Error finding posts missing images @ ${Date.now()}: ${error}`);
    return;
  }

  await mapWithConcurrency(
    posts || [],
    IMAGE_BACKFILL_CONCURRENCY,
    async (post) => {
      if (!shouldTrackImageResolution(post)) {
        return;
      }

      imageMetrics.attempts += 1;
      let thumbnail = "";
      const diagnostics = createImageFailureDiagnostics();

      try {
        thumbnail = await imageSourceImpl(post, diagnostics.options);
      } catch (error) {
        imageMetrics.errors += 1;
        logStructured(logger, {
          eventType: "POST_IMAGE_BACKFILL_ERROR",
          subreddit,
          domain: getPostDomain(post),
          postId: getPostId(post),
          postUrl: getPostUrl(post),
          title: post.title,
          errorMessage: error.message,
          ...imageFailureLogFields(diagnostics),
        });
      }

      if (hasUsableThumbnail(thumbnail)) {
        imageMetrics.resolved += 1;
        await updatePostThumbnail(newPostModel, post, thumbnail);
        logStructured(logger, {
          eventType: "POST_IMAGE_BACKFILL_RESOLVED",
          subreddit,
          domain: getPostDomain(post),
          postId: getPostId(post),
          postUrl: getPostUrl(post),
          title: post.title,
        });
        return;
      }

      imageMetrics.missing += 1;
      logStructured(logger, {
        eventType: "POST_IMAGE_BACKFILL_MISSING",
        subreddit,
        domain: getPostDomain(post),
        postId: getPostId(post),
        postUrl: getPostUrl(post),
        title: post.title,
        redditThumbnail: post.thumbnail || "",
        ...imageFailureLogFields(diagnostics),
      });
    }
  );

  logImageResolutionMetrics(logger, imageMetrics);
};

const insertNewPosts = (
  newPosts,
  subreddit,
  { imageSourceImpl = imageSource, logger = console, newPostModel = newPost } = {}
) => {
  logger.log("inserting new posts:", newPosts);
  const imageMetrics = createImageResolutionMetrics(subreddit, "scrape");
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

      const postKey = createPostKey(value.data);
      const trackImageResolution = shouldTrackImageResolution(value.data);

      if (trackImageResolution) {
        imageMetrics.attempts += 1;
      }

      await newPostModel.findOneAndUpdate(postKey, postUpdate, { upsert: true });

      let thumbnail = value.data.thumbnail || "";
      const diagnostics = createImageFailureDiagnostics();
      try {
        thumbnail = await imageSourceImpl(value.data, diagnostics.options);
      } catch (error) {
        if (trackImageResolution) {
          imageMetrics.errors += 1;
          logStructured(logger, {
            eventType: "POST_IMAGE_RESOLUTION_ERROR",
            subreddit,
            domain: getPostDomain(value.data),
            postId: getPostId(value.data),
            postUrl: getPostUrl(value.data),
            title: value.data.title,
            errorMessage: error.message,
            ...imageFailureLogFields(diagnostics),
          });
        }
        logger.warn(
          `Error resolving post image source @ ${Date.now()}: ${error}`
        );
      }

      const hasResolvedThumbnail = hasUsableThumbnail(thumbnail);

      if (hasResolvedThumbnail) {
        if (trackImageResolution) {
          imageMetrics.resolved += 1;
        }
        return updatePostThumbnail(newPostModel, value.data, thumbnail);
      }

      if (trackImageResolution) {
        imageMetrics.missing += 1;
        logStructured(logger, {
          eventType: "POST_IMAGE_RESOLUTION_MISSING",
          subreddit,
          domain: getPostDomain(value.data),
          postId: getPostId(value.data),
          postUrl: getPostUrl(value.data),
          title: value.data.title,
          redditThumbnail: value.data.thumbnail || "",
          ...imageFailureLogFields(diagnostics),
        });
      }

      return null;
    }
  );

  return insertPromises
    .then((result) => {
      logImageResolutionMetrics(logger, imageMetrics);
      return result;
    })
    .catch((e) => {
      logger.warn(`Error Inserting Posts @ ${Date.now()}: ${e}`);
      logImageResolutionMetrics(logger, imageMetrics);
    });
};

const createFetchPosts = ({
  env = process.env,
  fetchImpl = fetch,
  imageSourceImpl = imageSource,
  logger = console,
  mongooseClient = mongoose,
  newPostModel = newPost,
  now = () => new Date(),
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
        return backfillMissingPostImages(subreddit, {
          imageSourceImpl,
          logger,
          newPostModel,
          now,
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
module.exports.createImageResolutionMetrics = createImageResolutionMetrics;
module.exports.backfillMissingPostImages = backfillMissingPostImages;
module.exports.createImageFailureDiagnostics = createImageFailureDiagnostics;
module.exports.findMissingThumbnailPosts = findMissingThumbnailPosts;
module.exports.fetchPosts = createFetchPosts();
module.exports.logImageResolutionMetrics = logImageResolutionMetrics;
