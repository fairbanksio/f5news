const mongoose = require("./db");
const { errorFields, sanitizeImageFailure, sanitizeUrl } = require("./telemetry");
const newPost = require("./models/newPost");
const supportedSubreddits = require("../posts/subreddits.json");
const { scrapePosts, scrapeBatch } = require("./browser-source");
const { inspectSession } = require("./browser-session");
const {
  hasUsableThumbnail,
  imageUrlWidth,
  isSmallRedditThumbnail,
  isExternalLinkPost,
  SMALL_THUMBNAIL_PATTERN,
  fetchImageWidth,
  imageSource,
  redditImageSource,
  mapWithConcurrency,
} = require("./imageSource");

const IMAGE_SOURCE_CONCURRENCY = 10;
const IMAGE_METRIC_NAMESPACE = "F5News/Scraper";
const IMAGE_BACKFILL_CONCURRENCY = 5;
const IMAGE_BACKFILL_LIMIT = 25;
const IMAGE_BACKFILL_LOOKBACK_SECONDS = 8 * 60 * 60;
const IMAGE_QUALITY_CHECK_INTERVAL_MS = 60 * 60 * 1000;

const persistenceOptions = (options, deadline) => {
  if (!deadline) return options;
  const remaining = deadline - Date.now();
  if (remaining < 1000) throw new Error("Batch persistence deadline exceeded");
  return { ...options, maxTimeMS: Math.min(5000, remaining - 500), timeoutMS: Math.min(10000, remaining - 250) };
};

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

const imageWorkKey = (post) => JSON.stringify(createPostKey(post));

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
  { now = () => new Date(), lookbackSeconds = IMAGE_BACKFILL_LOOKBACK_SECONDS, deadline } = {}
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
  if (deadline && typeof query.setOptions === "function") query = query.setOptions(persistenceOptions({}, deadline));

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
      $or: [
        ...missingThumbnailFilter().$or,
        { thumbnail: { $not: { $regex: "^https?://" } } },
        { thumbnail: { $regex: SMALL_THUMBNAIL_PATTERN, $options: "i" } },
      ],
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
      if (match && match[1].toLowerCase() === canonical.toLowerCase() && (!hasUsableThumbnail(post.thumbnail) || isSmallRedditThumbnail(post.thumbnail))) ids.add(`t3_${match[2].toLowerCase()}`);
    }
    return [...ids];
  } catch {
    (logger.warn || logger.log).call(logger, JSON.stringify({ eventType: "POST_IMAGE_PRIORITY_UNAVAILABLE", subreddit: canonical, severity: "warn" }));
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};

const updatePostThumbnail = (newPostModel, data, thumbnail, { qualityCheckedAt, deadline, expectedThumbnail, hasExpectedThumbnail = false } = {}) => {
  const postKey = data._id ? { _id: data._id } : createPostKey(data);
  const fields = {};
  if (qualityCheckedAt) {
    postKey.thumbnail = data.thumbnail;
    fields.thumbnailQualityCheckedAt = qualityCheckedAt;
  }
  if (thumbnail) {
    const candidateWidth = imageUrlWidth(thumbnail);
    const storedWidth = imageUrlWidth(expectedThumbnail);
    if (hasExpectedThumbnail && candidateWidth && storedWidth && candidateWidth < storedWidth) return null;
    if (hasExpectedThumbnail && candidateWidth && !isSmallRedditThumbnail(thumbnail)) {
      // A concurrent image change must survive this snapshot's optional write.
      postKey.thumbnail = expectedThumbnail === undefined ? { $exists: false } : expectedThumbnail;
    }
    fields.thumbnail = thumbnail;
    if (isSmallRedditThumbnail(thumbnail)) {
      // A low-resolution fallback must not replace a better image from another run.
      postKey.$or = [...missingThumbnailFilter().$or, { thumbnail: { $regex: SMALL_THUMBNAIL_PATTERN, $options: "i" } }];
    }
  }

  return newPostModel.findOneAndUpdate(
    postKey,
    { $set: fields },
    persistenceOptions({ upsert: false }, deadline)
  );
};

// Callbacks report exhausted failures, never retries that later recover.
const dependencyFailed = (diagnostics) => diagnostics.failures.some((failure) =>
  ["http_status", "request_timeout", "empty_response", "body_read_error", "body_read_timeout", "fetch_error", "redirect_missing_location", "too_many_redirects"].includes(failure.reason)
);

const resolvePostImage = async (post, subreddit, operation, metrics, imageSourceImpl, logger, secrets = [], { deadline, job } = {}) => {
  if (deadline && deadline - Date.now() < 6000) {
    if (job) job.optionalImagesDeferred = true;
    return "";
  }
  const storedThumbnail = job?.storedThumbnails?.get(imageWorkKey(post));
  const sourceThumbnail = redditImageSource(post);
  if (hasUsableThumbnail(storedThumbnail) && !isSmallRedditThumbnail(storedThumbnail)) {
    const storedWidth = imageUrlWidth(storedThumbnail);
    const candidateWidth = imageUrlWidth(sourceThumbnail);
    if (storedWidth && candidateWidth && candidateWidth < storedWidth) return "";
    return hasUsableThumbnail(sourceThumbnail) && !isSmallRedditThumbnail(sourceThumbnail) && sourceThumbnail !== storedThumbnail ? sourceThumbnail : "";
  }
  if (hasUsableThumbnail(storedThumbnail) && (!hasUsableThumbnail(sourceThumbnail) || isSmallRedditThumbnail(sourceThumbnail))) post = { ...post, thumbnail: storedThumbnail };
  if (job) {
    job.imageAttemptedKeys ||= new Set();
    job.imageAttemptedKeys.add(imageWorkKey(post));
  }
  const diagnostics = createImageFailureDiagnostics(secrets);
  let thumbnail = post.thumbnail || "";
  let resolutionError;
  const tracked = shouldTrackImageResolution(post);
  if (tracked) metrics.attempts += 1;
  try {
    thumbnail = await imageSourceImpl(post, { ...diagnostics.options, preferArticleImage: operation === "scrape" || isSmallRedditThumbnail(post.thumbnail),
      ...(deadline ? { timeoutMs: 1000, maxTransientRetries: 0, maxRedirects: 1 } : {}) });
  } catch (error) {
    resolutionError = error;
    if (tracked) metrics.errors += 1;
  }
  const exhaustedDependency = tracked && dependencyFailed(diagnostics);
  if (exhaustedDependency) metrics.dependencyFailures += 1;
  const resolved = hasUsableThumbnail(thumbnail);
  if (tracked) metrics[resolved ? "resolved" : "missing"] += 1;
  if (resolutionError || (tracked && !resolved) || (resolved && exhaustedDependency)) {
    const prefix = operation === "backfill" ? "POST_IMAGE_BACKFILL" : "POST_IMAGE_RESOLUTION";
    logStructured(logger, {
      eventType: `${prefix}_${resolutionError ? "ERROR" : resolved ? "DEGRADED" : "MISSING"}`,
      ...(resolved && exhaustedDependency && !resolutionError ? { outcome: "degraded" } : {}),
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
    const identity = imageWorkKey(post);
    const expectations = options.job?.thumbnailExpectations;
    const written = await updatePostThumbnail(newPostModel, post, thumbnail, {
      ...options,
      ...(expectations?.has(identity) ? { hasExpectedThumbnail: true, expectedThumbnail: expectations.get(identity) } : {}),
    });
    if (written && thumbnail && options.job) {
      expectations?.set(identity, thumbnail);
      options.job.storedThumbnails ||= new Map();
      options.job.storedThumbnails.set(identity, thumbnail);
    }
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
  { imageSourceImpl = imageSource, fetchImageWidthImpl = fetchImageWidth, logger = console, newPostModel = newPost, now = () => new Date(), redactionValues = [], deadline, job } = {}
) => {
  const metrics = createImageResolutionMetrics(subreddit, "backfill");
  let posts;
  try {
    posts = await findMissingThumbnailPosts(newPostModel, subreddit, { now, deadline });
  } catch (error) {
    logStructured(logger, { eventType: "POST_IMAGE_BACKFILL_ERROR", subreddit, stage: "backfill_query", ...errorFields(error, redactionValues) });
    return { ...metrics, queryErrors: 1 };
  }
  await mapWithConcurrency(posts || [], IMAGE_BACKFILL_CONCURRENCY, async (post) => {
    if (deadline && deadline - Date.now() < 6000) { if (job) job.optionalImagesDeferred = true; return; }
    if (!shouldTrackImageResolution(post) || job?.imageAttemptedKeys?.has(imageWorkKey(post))) return;
    const qualityCheck = hasUsableThumbnail(post.thumbnail);
    if (qualityCheck && (!isSmallRedditThumbnail(post.thumbnail) || !isExternalLinkPost(post))) return;
    const thumbnail = await resolvePostImage(post, subreddit, "backfill", metrics, imageSourceImpl, logger, redactionValues, { deadline, job });
    if (qualityCheck) {
      let better = false;
      if (thumbnail && thumbnail !== post.thumbnail) {
        const priorWidth = imageUrlWidth(post.thumbnail) || 320;
        const replacementWidth = await fetchImageWidthImpl(thumbnail);
        better = Number.isFinite(replacementWidth) && replacementWidth > priorWidth;
      }
      await saveOptionalThumbnail(newPostModel, post, better ? thumbnail : null, subreddit, "backfill", metrics, logger, redactionValues, { qualityCheckedAt: now(), deadline });
      return;
    }
    if (thumbnail) await saveOptionalThumbnail(newPostModel, post, thumbnail, subreddit, "backfill", metrics, logger, redactionValues, { deadline });
  });
  logImageResolutionMetrics(logger, metrics);
  return metrics;
};

const insertNewPosts = (
  newPosts,
  subreddit,
  { imageSourceImpl = imageSource, logger = console, newPostModel = newPost, job = {}, redactionValues = [], coreOnly = false, deadline } = {}
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
      const storedPost = await newPostModel.findOneAndUpdate(postKey, postUpdate, persistenceOptions({ upsert: true }, deadline));
      job.thumbnailExpectations ||= new Map();
      job.thumbnailExpectations.set(imageWorkKey(value.data), storedPost?.thumbnail);
      if (hasUsableThumbnail(storedPost?.thumbnail)) {
        job.storedThumbnails ||= new Map();
        job.storedThumbnails.set(imageWorkKey(value.data), storedPost.thumbnail);
      }
      job.savedCount = (job.savedCount || 0) + 1;
      if (coreOnly) {
        const thumbnail = redditImageSource(value.data);
        if (hasUsableThumbnail(thumbnail)) await saveOptionalThumbnail(newPostModel, value.data, thumbnail, subreddit, "scrape", imageMetrics, logger, redactionValues, { deadline, job });
        return null;
      }
      const thumbnail = await resolvePostImage(value.data, subreddit, "scrape", imageMetrics, imageSourceImpl, logger, redactionValues, { job });
      if (thumbnail) await saveOptionalThumbnail(newPostModel, value.data, thumbnail, subreddit, "scrape", imageMetrics, logger, redactionValues, { job });
      return null;
    }
  );

  return insertPromises.finally(() => {
    job.scrapeImages = imageMetrics;
    logImageResolutionMetrics(logger, imageMetrics);
  });
};

const finishFeed = ({ job, subreddit, stage, terminalError, startedAt, event, context, logger, redactionValues, sourceStatus, failureFields = {} }) => {
  const imageCounts = [job.scrapeImages, job.backfillImages].filter(Boolean);
  const degraded = job.sessionRenewalDeferred === true || job.optionalImagesDeferred === true || imageCounts.some((metrics) => metrics.missing || metrics.errors || metrics.dependencyFailures || metrics.updateErrors || metrics.queryErrors);
  const outcome = terminalError ? "failed" : degraded ? "degraded" : "success";
  logStructured(logger, {
    eventType: terminalError ? "SCRAPER_JOB_FAILED" : "SCRAPER_JOB_COMPLETED",
    subreddit, stage, trigger: event.scheduled === true ? "schedule" : "manual", outcome,
    durationMs: Date.now() - startedAt, requestId: context.awsRequestId || "",
    fetchedCount: job.fetchedCount, savedCount: job.savedCount,
    ...(job.sessionMode ? { sessionMode: job.sessionMode, sessionGeneration: job.sessionGeneration } : {}),
    ...(job.sessionRenewalDeferred ? { sessionRenewalDeferred: true } : {}),
    ...(job.optionalImagesDeferred ? { optionalImagesDeferred: true } : {}),
    ...(sourceStatus ? { sourceStatus, ...failureFields } : {}),
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
  return { subreddit, outcome, fetchedCount: job.fetchedCount, savedCount: job.savedCount,
    sessionMode: job.sessionMode, sessionGeneration: job.sessionGeneration };
};

const validBatchChildren = (children, subreddit) => Array.isArray(children) && children.length > 0 && children.length <= 25 && children.every((child) => {
  const data = child?.data;
  return child?.kind === "t3" && data && !Array.isArray(data) && /^[a-z0-9]+$/.test(data.id || "") &&
    ["title", "domain", "author", "url", "permalink"].every((field) => typeof data[field] === "string" && data[field].trim()) &&
    data.subreddit === subreddit && Number.isSafeInteger(data.created_utc) && data.created_utc >= 0 &&
    Number.isSafeInteger(data.ups) && Number.isSafeInteger(data.num_comments) && data.num_comments >= 0;
}) && new Set(children.map((child) => child.data.id)).size === children.length;

const batchFailureFields = (failure) => {
  const fields = {};
  const reasons = ["invalid_data", "input_file_invalid", "root_cookie_expired", "root_cookie_missing", "restore_exception", "navigation_network_error", "navigation_http_rejected", "navigation_rate_limited", "feed_cookie_missing", "feed_timeout", "feed_blocked", "feed_challenge"];
  if (reasons.includes(failure?.sessionReason)) fields.sessionReason = failure.sessionReason;
  if (Number.isInteger(failure?.httpStatus) && failure.httpStatus >= 400 && failure.httpStatus <= 599) fields.httpStatus = failure.httpStatus;
  if (Number.isInteger(failure?.retryAfterSeconds) && failure.retryAfterSeconds >= 0 && failure.retryAfterSeconds <= 86400) fields.retryAfterSeconds = failure.retryAfterSeconds;
  return fields;
};

const persistBatchImages = async (feed, dependencies, deadline) => {
  const { imageSourceImpl, logger, newPostModel, redactionValues, now } = dependencies;
  if (deadline - Date.now() < 6000) { feed.job.optionalImagesDeferred = true; return; }
  const metrics = createImageResolutionMetrics(feed.subreddit, "scrape");
  metrics.updateErrors = feed.job.scrapeImages?.updateErrors || 0;
  try {
    await mapWithConcurrency(feed.children, IMAGE_SOURCE_CONCURRENCY, async ({ data }) => {
      const thumbnail = await resolvePostImage(data, feed.subreddit, "scrape", metrics, imageSourceImpl, logger, redactionValues, { deadline, job: feed.job });
      if (thumbnail) await saveOptionalThumbnail(newPostModel, data, thumbnail, feed.subreddit, "scrape", metrics, logger, redactionValues, { deadline, job: feed.job });
    });
  } finally {
    feed.job.scrapeImages = metrics;
    logImageResolutionMetrics(logger, metrics);
  }
  if (deadline - Date.now() < 6000) { feed.job.optionalImagesDeferred = true; return; }
  feed.job.backfillImages = await backfillMissingPostImages(feed.subreddit, { imageSourceImpl, logger, newPostModel, now, redactionValues, deadline, job: feed.job });
};

const fetchAllFeeds = async (dependencies, event, context) => {
  const { env, scrapeBatchImpl, mongooseClient, newPostModel, logger, now } = dependencies;
  const startedAt = Date.now();
  const invocationDeadline = startedAt + (typeof context.getRemainingTimeInMillis === "function" ? context.getRemainingTimeInMillis() : 240000);
  const deadline = invocationDeadline - 5000;
  const redactionValues = [env.MONGO_CONNECTION_STRING, env.REDDIT_CLIENT_ID, env.REDDIT_SECRET_KEY, env.REDDIT_USERNAME, env.REDDIT_PASSWORD];
  const feeds = supportedSubreddits.map((subreddit) => ({ subreddit, job: { fetchedCount: 0, savedCount: 0 }, stage: "database_connect" }));
  const bySubreddit = new Map(feeds.map((feed) => [feed.subreddit, feed]));
  let result;
  let batchProblem;
  let sourceFailureFields;
  try {
    await mongooseClient.connect();
    const imagePriorityIdsBySubreddit = {};
    await mapWithConcurrency(feeds, 3, async ({ subreddit }) => {
      const ids = await findImagePriorityIds(newPostModel, subreddit, { now, logger });
      if (ids !== undefined) imagePriorityIdsBySubreddit[subreddit] = ids;
    });
    for (const feed of feeds) feed.stage = "browser_extract";
    const timeoutMs = Math.min(160000, invocationDeadline - Date.now() - 70000);
    if (timeoutMs < 10000) throw new Error("Insufficient time for batch collection and persistence");
    const session = event.session === true || (event.session !== false && env.F5_REDDIT_SESSION_ENABLED === "true");
    result = await scrapeBatchImpl({ subreddits: [...supportedSubreddits], limit: 25, timeoutMs, logger, session,
      authenticate: event.authenticate === true, renewSession: event.renewSession === true, imagePriorityIdsBySubreddit });
    if (!result || !Array.isArray(result.feeds) || result.feeds.length > feeds.length || !Array.isArray(result.failures || [])) throw new Error("Invalid batch collection result");
    if (session && (!["reused", "renewed"].includes(result.sessionMode) || !/^[A-Za-z0-9_-]{1,128}$/.test(result.sessionGeneration || ""))) throw new Error("Batch collection did not establish its session");
    const seen = new Set();
    for (const completed of result.feeds) {
      const feed = bySubreddit.get(completed?.subreddit);
      if (!feed) throw new Error("Batch collection returned an unsupported feed");
      if (seen.has(feed.subreddit) || !validBatchChildren(completed.children, feed.subreddit)) {
        feed.children = undefined;
        feed.sourceStatus = "metadata_invalid";
        feed.terminalError = new Error("Batch feed metadata is invalid");
      } else {
        feed.children = completed.children;
        feed.job.fetchedCount = completed.children.length;
      }
      seen.add(feed.subreddit);
    }
    for (const failure of result.failures || []) {
      const feed = bySubreddit.get(failure?.subreddit);
      if (!feed) throw new Error("Batch collection returned an unsupported failure");
      feed.children = undefined;
      feed.sourceStatus = "metadata_invalid";
      feed.terminalError = new Error("Batch feed metadata is invalid");
    }
    batchProblem = Boolean(result.batchFailure || result.readBackoffFailed);
    sourceFailureFields = batchFailureFields(result.batchFailure);
    for (const feed of feeds) {
      if (["reused", "renewed"].includes(result.sessionMode) && /^[A-Za-z0-9_-]{1,128}$/.test(result.sessionGeneration || "")) {
        feed.job.sessionMode = result.sessionMode;
        feed.job.sessionGeneration = result.sessionGeneration;
      }
      feed.job.sessionRenewalDeferred = result.sessionRenewalDeferred === true;
      if (feed.children && result.batchFailure?.subreddit === feed.subreddit && result.batchFailure.stage === "optional_preview") {
        feed.job.optionalImagesDeferred = true;
        feed.sourceStatus = "optional_preview_failed";
        feed.failureFields = batchFailureFields(result.batchFailure);
      }
      if (!feed.children && !feed.terminalError) {
        feed.sourceStatus = result.batchFailure?.subreddit === feed.subreddit ? "source_failed" : "not_attempted";
        feed.failureFields = batchFailureFields(result.batchFailure);
        feed.terminalError = new Error("Batch feed collection did not complete");
      }
    }
    // Persist all validated core rows before optional images can consume the reserve.
    await mapWithConcurrency(feeds.filter((feed) => feed.children && !feed.terminalError), 2, async (feed) => {
      feed.stage = "post_write";
      try {
        await insertNewPosts(feed.children, feed.subreddit, { newPostModel, logger, job: feed.job, redactionValues, coreOnly: true, deadline });
      } catch (error) { feed.terminalError = error; }
    });
    await mapWithConcurrency(feeds.filter((feed) => feed.children && !feed.terminalError), 2, async (feed) => {
      if (batchProblem) {
        feed.job.optionalImagesDeferred = true;
        feed.stage = "complete";
        return;
      }
      feed.stage = "image_backfill";
      try { await persistBatchImages(feed, { ...dependencies, redactionValues }, deadline); }
      catch { feed.job.optionalImagesDeferred = true; }
      feed.stage = "complete";
    });
  } catch (error) {
    batchProblem = true;
    sourceFailureFields = batchFailureFields(error);
    for (const feed of feeds) if (!feed.terminalError) {
      feed.terminalError = error;
      feed.sourceStatus = "source_failed";
      feed.failureFields = batchFailureFields(error);
    }
  }
  const feedResults = feeds.map((feed) => finishFeed({ ...feed, startedAt, event, context, logger, redactionValues }));
  const failed = feedResults.filter((feed) => feed.outcome === "failed").length;
  if (batchProblem || failed) {
    const cause = [sourceFailureFields.sessionReason, sourceFailureFields.httpStatus ? `HTTP ${sourceFailureFields.httpStatus}` : "",
      sourceFailureFields.retryAfterSeconds !== undefined ? `retry after ${sourceFailureFields.retryAfterSeconds}s` : ""].filter(Boolean).join(", ");
    throw new Error(`Browser batch did not complete cleanly: ${failed} feeds incomplete${cause ? `; stopped: ${cause}` : ""}`);
  }
  return { feedResults, sessionMode: result.sessionMode, sessionGeneration: result.sessionGeneration };
};

const createFetchPosts = ({
  env = process.env,
  scrapePostsImpl = scrapePosts,
  scrapeBatchImpl = scrapeBatch,
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
    if (event.allFeeds === true) return fetchAllFeeds({ env, scrapeBatchImpl, mongooseClient, newPostModel, logger, now, imageSourceImpl }, event, context);
    const startedAt = Date.now();
    const subreddit = event.subreddit || "politics";
    const job = { savedCount: 0, fetchedCount: 0 };
    const redactionValues = [env.MONGO_CONNECTION_STRING, env.REDDIT_CLIENT_ID, env.REDDIT_SECRET_KEY, env.REDDIT_USERNAME, env.REDDIT_PASSWORD];
    let stage = "database_connect";
    let terminalError;
    try {
      await mongooseClient.connect();
      const imagePriorityIds = event.renewSession === true ? [] : await findImagePriorityIds(newPostModel, subreddit, { now, logger });
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
      job.backfillImages = await backfillMissingPostImages(subreddit, { imageSourceImpl, logger, newPostModel, now, redactionValues, job });
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
