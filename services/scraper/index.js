const mongoose = require("./db");
const { errorFields, sanitizeImageFailure, sanitizeUrl } = require("./telemetry");
const newPost = require("./models/newPost");
const supportedSubreddits = require("../posts/subreddits.json");
const { scrapePosts } = require("./browser-source");
const { inspectSession } = require("./browser-session");
const {
  hasUsableThumbnail,
  imageUrlWidth,
  isSmallRedditThumbnail,
  isExternalLinkPost,
  SMALL_THUMBNAIL_PATTERN,
  fetchImageWidth,
  imageSource,
  mapWithConcurrency,
} = require("./imageSource");

const IMAGE_SOURCE_CONCURRENCY = 10;
const IMAGE_METRIC_NAMESPACE = "F5News/Scraper";
const IMAGE_BACKFILL_CONCURRENCY = 5;
const IMAGE_BACKFILL_LIMIT = 25;
const IMAGE_BACKFILL_LOOKBACK_SECONDS = 8 * 60 * 60;
const IMAGE_QUALITY_CHECK_INTERVAL_MS = 60 * 60 * 1000;

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
  if (payload._aws || payload.eventType === "POST_BATCH") {
    logger.log(JSON.stringify(payload));
    return;
  }
  const severity = /ERROR|FAILED/.test(payload.eventType) ? "error" : /MISSING/.test(payload.eventType) || payload.outcome === "degraded" ? "warn" : "info";
  const output = logger[severity === "info" ? "log" : severity] || logger.log;
  output.call(logger, JSON.stringify({ ...payload, severity }));
};

const createImageFailureDiagnostics = (secrets = []) => {
  const failures = [];

  return {
    failures,
    options: {
      onArticleImageFailure: (failure) => {
        failures.push(sanitizeImageFailure(failure, secrets));
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
  dependencyFailures: 0,
  updateErrors: 0,
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
            { Name: "PostImageDependencyFailures", Unit: "Count" },
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
    PostImageDependencyFailures: metrics.dependencyFailures,
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
    $or: [
      ...missingThumbnailFilter().$or,
      { $and: [
        { thumbnail: { $regex: SMALL_THUMBNAIL_PATTERN, $options: "i" } },
        { is_gallery: { $ne: true } },
        { post_hint: { $nin: ["image", "rich:video"] } },
        { $or: [
          { thumbnailQualityCheckedAt: { $exists: false } },
          { thumbnailQualityCheckedAt: { $lt: new Date(now().getTime() - IMAGE_QUALITY_CHECK_INTERVAL_MS) } },
        ] },
      ] },
    ],
  });

  if (typeof query.sort === "function") {
    query = query.sort({ created_utc: -1 });
  }

  if (typeof query.limit === "function") {
    query = query.limit(IMAGE_BACKFILL_LIMIT);
  }

  return query;
};

const findImagePriorityIds = async (newPostModel, subreddit, { now = () => new Date(), logger = console } = {}) => {
  const canonical = supportedSubreddits.find((name) => name.toLowerCase() === String(subreddit).toLowerCase());
  if (!canonical) return [];
  let timer;
  try {
    let query = newPostModel.find({
      sub: canonical,
      created_utc: { $gt: Math.floor(now().getTime() / 1000) - IMAGE_BACKFILL_LOOKBACK_SECONDS },
      is_self: { $ne: true }, is_video: { $ne: true }, is_gallery: { $ne: true },
      post_hint: { $nin: ["image", "rich:video"] },
      thumbnail: { $regex: SMALL_THUMBNAIL_PATTERN, $options: "i" },
      url: { $regex: "^https?://(?!(?:[a-z0-9-]+\\.)*(?:reddit\\.com|redd\\.it)(?:[:/]|$))", $options: "i" },
    });
    if (!Array.isArray(query) && typeof query.sort === "function") query = query.sort({ upvoteCount: -1 });
    if (typeof query.limit === "function") query = query.limit(25);
    if (typeof query.select === "function") query = query.select("commentLink thumbnail");
    if (typeof query.maxTimeMS === "function") query = query.maxTimeMS(1500);
    const rows = await Promise.race([
      Promise.resolve(query),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Image priority deadline")), 1500); }),
    ]);
    if (!Array.isArray(rows)) throw new Error("Invalid image priority results");
    const ids = new Set();
    for (const post of rows.slice(0, 25)) {
      const match = typeof post.commentLink === "string" && post.commentLink.match(/^\/r\/([a-z0-9_]{2,21})\/comments\/([a-z0-9]+)(?:\/[^?#]*)?$/i);
      if (match && match[1].toLowerCase() === canonical.toLowerCase() && isSmallRedditThumbnail(post.thumbnail)) ids.add(`t3_${match[2].toLowerCase()}`);
    }
    return [...ids];
  } catch {
    (logger.warn || logger.log).call(logger, JSON.stringify({ eventType: "POST_IMAGE_PRIORITY_UNAVAILABLE", subreddit: canonical, severity: "warn" }));
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};

const updatePostThumbnail = (newPostModel, data, thumbnail, { qualityCheckedAt } = {}) => {
  const postKey = data._id ? { _id: data._id } : createPostKey(data);
  const fields = {};
  if (qualityCheckedAt) {
    postKey.thumbnail = data.thumbnail;
    fields.thumbnailQualityCheckedAt = qualityCheckedAt;
  }
  if (thumbnail) {
    fields.thumbnail = thumbnail;
    if (isSmallRedditThumbnail(thumbnail)) {
      // A low-resolution fallback must not replace a better image from another run.
      postKey.$or = [...missingThumbnailFilter().$or, { thumbnail: { $regex: SMALL_THUMBNAIL_PATTERN, $options: "i" } }];
    }
  }

  return newPostModel.findOneAndUpdate(
    postKey,
    { $set: fields },
    { upsert: false }
  );
};

// Callbacks report exhausted failures, never retries that later recover.
const dependencyFailed = (diagnostics) => diagnostics.failures.some((failure) =>
  ["http_status", "request_timeout", "empty_response", "body_read_error", "body_read_timeout", "fetch_error", "redirect_missing_location", "too_many_redirects"].includes(failure.reason)
);

const resolvePostImage = async (post, subreddit, operation, metrics, imageSourceImpl, logger, secrets = []) => {
  const diagnostics = createImageFailureDiagnostics(secrets);
  let thumbnail = post.thumbnail || "";
  let resolutionError;
  const tracked = shouldTrackImageResolution(post);
  if (tracked) metrics.attempts += 1;
  try {
    thumbnail = await imageSourceImpl(post, { ...diagnostics.options, preferArticleImage: operation === "scrape" || isSmallRedditThumbnail(post.thumbnail) });
  } catch (error) {
    resolutionError = error;
    if (tracked) metrics.errors += 1;
  }
  if (tracked && dependencyFailed(diagnostics)) metrics.dependencyFailures += 1;
  const resolved = hasUsableThumbnail(thumbnail);
  if (tracked) metrics[resolved ? "resolved" : "missing"] += 1;
  if (resolutionError || (tracked && !resolved)) {
    const prefix = operation === "backfill" ? "POST_IMAGE_BACKFILL" : "POST_IMAGE_RESOLUTION";
    logStructured(logger, {
      eventType: `${prefix}_${resolutionError ? "ERROR" : "MISSING"}`,
      subreddit, domain: getPostDomain(post), postId: getPostId(post),
      postUrl: sanitizeUrl(getPostUrl(post)), title: post.title,
      ...(resolutionError ? errorFields(resolutionError, secrets) : { redditThumbnail: hasUsableThumbnail(post.thumbnail) ? sanitizeUrl(post.thumbnail) : post.thumbnail || "" }),
      ...imageFailureLogFields(diagnostics),
    });
  }
  return resolved ? thumbnail : "";
};

const saveOptionalThumbnail = async (newPostModel, post, thumbnail, subreddit, operation, metrics, logger, secrets = [], options = {}) => {
  try {
    await updatePostThumbnail(newPostModel, post, thumbnail, options);
  } catch (error) {
    metrics.updateErrors += 1;
    logStructured(logger, {
      eventType: "POST_IMAGE_UPDATE_ERROR", subreddit, operation,
      postId: getPostId(post), domain: getPostDomain(post), ...errorFields(error, secrets),
    });
  }
};

const backfillMissingPostImages = async (
  subreddit,
  { imageSourceImpl = imageSource, fetchImageWidthImpl = fetchImageWidth, logger = console, newPostModel = newPost, now = () => new Date(), redactionValues = [] } = {}
) => {
  const metrics = createImageResolutionMetrics(subreddit, "backfill");
  let posts;
  try {
    posts = await findMissingThumbnailPosts(newPostModel, subreddit, { now });
  } catch (error) {
    logStructured(logger, { eventType: "POST_IMAGE_BACKFILL_ERROR", subreddit, stage: "backfill_query", ...errorFields(error, redactionValues) });
    return { ...metrics, queryErrors: 1 };
  }
  await mapWithConcurrency(posts || [], IMAGE_BACKFILL_CONCURRENCY, async (post) => {
    if (!shouldTrackImageResolution(post)) return;
    const qualityCheck = hasUsableThumbnail(post.thumbnail);
    if (qualityCheck && (!isSmallRedditThumbnail(post.thumbnail) || !isExternalLinkPost(post))) return;
    const thumbnail = await resolvePostImage(post, subreddit, "backfill", metrics, imageSourceImpl, logger, redactionValues);
    if (qualityCheck) {
      let better = false;
      if (thumbnail && thumbnail !== post.thumbnail) {
        const priorWidth = imageUrlWidth(post.thumbnail) || 320;
        const replacementWidth = await fetchImageWidthImpl(thumbnail);
        better = Number.isFinite(replacementWidth) && replacementWidth > priorWidth;
      }
      await saveOptionalThumbnail(newPostModel, post, better ? thumbnail : null, subreddit, "backfill", metrics, logger, redactionValues, { qualityCheckedAt: now() });
      return;
    }
    if (thumbnail) await saveOptionalThumbnail(newPostModel, post, thumbnail, subreddit, "backfill", metrics, logger, redactionValues);
  });
  logImageResolutionMetrics(logger, metrics);
  return metrics;
};

const insertNewPosts = (
  newPosts,
  subreddit,
  { imageSourceImpl = imageSource, logger = console, newPostModel = newPost, job = {}, redactionValues = [] } = {}
) => {
  logStructured(logger, { eventType: "POST_BATCH", subreddit, count: newPosts.length });
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
      await newPostModel.findOneAndUpdate(postKey, postUpdate, { upsert: true });
      job.savedCount = (job.savedCount || 0) + 1;
      const thumbnail = await resolvePostImage(value.data, subreddit, "scrape", imageMetrics, imageSourceImpl, logger, redactionValues);
      if (thumbnail) await saveOptionalThumbnail(newPostModel, value.data, thumbnail, subreddit, "scrape", imageMetrics, logger, redactionValues);
      return null;
    }
  );

  return insertPromises.finally(() => {
    job.scrapeImages = imageMetrics;
    logImageResolutionMetrics(logger, imageMetrics);
  });
};

const createFetchPosts = ({
  env = process.env,
  scrapePostsImpl = scrapePosts,
  inspectSessionImpl = inspectSession,
  imageSourceImpl = imageSource,
  logger = console,
  mongooseClient = mongoose,
  newPostModel = newPost,
  now = () => new Date(),
} = {}) => {
  return async (event = {}, context = {}) => {
    if (event.inspectSession === true) {
      await mongooseClient.connect();
      const diagnostics = await inspectSessionImpl();
      logger.log(JSON.stringify({ eventType: "BROWSER_SESSION_DIAGNOSTICS", ...diagnostics }));
      return diagnostics;
    }
    const startedAt = Date.now();
    const subreddit = event.subreddit || "politics";
    const job = { savedCount: 0, fetchedCount: 0 };
    const redactionValues = [env.MONGO_CONNECTION_STRING, env.REDDIT_CLIENT_ID, env.REDDIT_SECRET_KEY, env.REDDIT_USERNAME, env.REDDIT_PASSWORD];
    let stage = "database_connect";
    let terminalError;
    try {
      await mongooseClient.connect();
      const imagePriorityIds = await findImagePriorityIds(newPostModel, subreddit, { now, logger });
      stage = "browser_extract";
      const remaining = typeof context.getRemainingTimeInMillis === "function" ? context.getRemainingTimeInMillis() : 120_000;
      const session = event.session === true || (event.session !== false && env.F5_REDDIT_SESSION_ENABLED === "true");
      const children = await scrapePostsImpl({ subreddit, limit: 25, timeoutMs: Math.min(session ? 210_000 : event.authenticate === true ? 150_000 : 90_000, remaining - 20_000), logger, authenticate: event.authenticate === true, session, renewSession: event.renewSession === true, imagePriorityIds });
      if (children?.sessionMode) {
        job.sessionMode = children.sessionMode;
        job.sessionGeneration = children.sessionGeneration;
        job.sessionRenewalDeferred = children.sessionRenewalDeferred === true;
      }
      if (!Array.isArray(children)) throw new Error("Browser extraction response missing posts");
      job.fetchedCount = children.length;
      stage = "post_write";
      await insertNewPosts(children, subreddit, { imageSourceImpl, logger, newPostModel, job, redactionValues });
      stage = "image_backfill";
      job.backfillImages = await backfillMissingPostImages(subreddit, { imageSourceImpl, logger, newPostModel, now, redactionValues });
      stage = "complete";
    } catch (error) {
      const safe = errorFields(error, redactionValues);
      terminalError = Object.assign(new Error(safe.errorMessage), { name: safe.errorName, code: safe.errorCode, status: safe.status });
      if (safe.stack) terminalError.stack = safe.stack;
      throw terminalError;
    } finally {
      const imageCounts = [job.scrapeImages, job.backfillImages].filter(Boolean);
      const degraded = job.sessionRenewalDeferred === true || imageCounts.some((metrics) => metrics.missing || metrics.errors || metrics.dependencyFailures || metrics.updateErrors || metrics.queryErrors);
      logStructured(logger, {
        eventType: terminalError ? "SCRAPER_JOB_FAILED" : "SCRAPER_JOB_COMPLETED",
        subreddit, stage, trigger: event.scheduled === true ? "schedule" : "manual", outcome: terminalError ? "failed" : degraded ? "degraded" : "success",
        durationMs: Date.now() - startedAt, requestId: context.awsRequestId || "",
        fetchedCount: job.fetchedCount, savedCount: job.savedCount,
        ...(job.sessionMode ? { sessionMode: job.sessionMode, sessionGeneration: job.sessionGeneration } : {}),
        ...(job.sessionRenewalDeferred ? { sessionRenewalDeferred: true } : {}),
        imageAttempts: imageCounts.reduce((count, metrics) => count + metrics.attempts, 0),
        imageResolved: imageCounts.reduce((count, metrics) => count + metrics.resolved, 0),
        imageMissing: imageCounts.reduce((count, metrics) => count + metrics.missing, 0),
        imageErrors: imageCounts.reduce((count, metrics) => count + metrics.errors, 0),
        imageDependencyFailures: imageCounts.reduce((count, metrics) => count + metrics.dependencyFailures, 0),
        imageUpdateErrors: imageCounts.reduce((count, metrics) => count + metrics.updateErrors, 0),
        backfillQueryErrors: job.backfillImages?.queryErrors || 0,
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        ...(terminalError ? errorFields(terminalError, redactionValues) : {}),
      });
    }
  };
};

module.exports.createFetchPosts = createFetchPosts;
module.exports.backfillMissingPostImages = backfillMissingPostImages;
module.exports.findImagePriorityIds = findImagePriorityIds;
module.exports.fetchPosts = createFetchPosts();
