import React, { useState, useEffect, useContext, useRef } from 'react';
import {
  Container,
  useBreakpointValue,
  Alert,
  Box,
  Text,
} from '@chakra-ui/react';
import { RefreshIntervalContext } from '../Contexts/RefreshIntervalContext';
import { SubredditContext } from '../Contexts/SubredditContext';
import { ViewModeContext } from '../Contexts/ViewModeContext';
import { LoadingContext } from '../Contexts/LoadingContext';
import GridView from './GridView';
import ListView from './ListView';
import usePageVisibility from '../Util/usePageVisibility';
import { getRuntimeConfigValue, normalizeApiEndpoint } from '../runtimeConfig';

const getPostsUrl = subreddit => {
  const apiEndpoint = normalizeApiEndpoint(getRuntimeConfigValue('REACT_APP_API'));
  const postsEndpoint = normalizeApiEndpoint(getRuntimeConfigValue('REACT_APP_POSTS_API')) ||
    (apiEndpoint ? apiEndpoint + '/posts' : '');
  return postsEndpoint ? postsEndpoint + '/' + encodeURIComponent(subreddit) : '';
};

const SCRAPER_REFRESH_INTERVAL_MS = 1000 * 60 * 5;
const SCRAPER_FRESHNESS_GRACE_MS = 1000 * 60 * 2;
const STALE_POSTS_THRESHOLD_MS =
  SCRAPER_REFRESH_INTERVAL_MS + SCRAPER_FRESHNESS_GRACE_MS;
const MIN_RESUME_REFRESH_AGE_MS = 1000 * 30;
const POST_REQUEST_TIMEOUT_MS = 1000 * 45;

const FRESHNESS_LOG_SUMMARY_INTERVAL_MS = 1000 * 60 * 5;

export const getPostsFreshness = (posts, now = Date.now()) => {
  let latestFetch = null;
  let invalidTimestampCount = 0;
  for (const post of posts) {
    const fetchedAt = post.fetchedAt;
    const timestamp = typeof fetchedAt === 'string' && fetchedAt.trim() !== ''
      ? new Date(fetchedAt).getTime()
      : typeof fetchedAt === 'number' ? new Date(fetchedAt).getTime() : NaN;
    if (!Number.isFinite(timestamp)) {
      invalidTimestampCount++;
    } else if (latestFetch === null || timestamp > latestFetch) {
      latestFetch = timestamp;
    }
  }

  return {
    state: posts.length === 0 ? 'empty' : latestFetch === null ? 'unknown' :
      now - latestFetch > STALE_POSTS_THRESHOLD_MS ? 'stale' : 'fresh',
    postCount: posts.length,
    invalidTimestampCount,
    latestFetchedAt: latestFetch === null ? null : new Date(latestFetch).toISOString(),
    expectedFreshWithinSeconds: STALE_POSTS_THRESHOLD_MS / 1000,
  };
};

// Summarize repeated observations while retaining transitions and recovery.
export const createFreshnessReporter = () => {
  let previous;
  return (subreddit, posts, now = Date.now()) => {
    const freshness = getPostsFreshness(posts, now);
    const changed = !previous || previous.subreddit !== subreddit ||
      previous.state !== freshness.state;
    const prior = previous && previous.subreddit === subreddit ? previous : null;
    if (changed) {
      previous = { subreddit, state: freshness.state, count: 0, firstSeenAt: now, lastLoggedAt: now };
    }
    previous.count++;
    const problem = freshness.state === 'stale' || freshness.state === 'unknown';
    const recovered = changed && prior && (prior.state === 'stale' || prior.state === 'unknown') && !problem;
    if (!(problem && (changed || now - previous.lastLoggedAt >= FRESHNESS_LOG_SUMMARY_INTERVAL_MS)) && !recovered) {
      return;
    }

    const context = {
      subreddit,
      ...freshness,
      observationCount: previous.count,
      firstObservedAt: new Date(previous.firstSeenAt).toISOString(),
      lastObservedAt: new Date(now).toISOString(),
      event: recovered && freshness.state === 'fresh' ? 'recovery' : changed ? 'transition' : 'summary',
      ...(changed && prior ? {
        previousState: prior.state,
        previousObservationCount: prior.count,
        previousFirstObservedAt: new Date(prior.firstSeenAt).toISOString(),
      } : {}),
    };
    previous.lastLoggedAt = now;
    if (recovered) {
      console.info('Posts freshness changed after a warning.', context);
    } else {
      console.warn(freshness.state === 'stale'
        ? 'Posts look stale relative to the expected refresh window.'
        : 'Posts freshness is unknown because fetchedAt timestamps are missing or invalid.', context);
    }
  };
};

const getValidatedPosts = json => {
  if (!json || !Array.isArray(json.data)) {
    throw new Error('Invalid posts payload');
  }

  return json.data;
};

export const sortPostsByUpvotes = posts =>
  [...posts].sort((a, b) => {
    const upvoteDiff = Number(b.upvoteCount || 0) - Number(a.upvoteCount || 0);

    if (upvoteDiff !== 0) {
      return upvoteDiff;
    }

    return Number(a.created_utc || 0) - Number(b.created_utc || 0);
  });

const logPostFetchFailure = (error, subreddit, startedAt) => {
  console.error('Failed to refresh posts. Keeping the last successful results until the next valid response.', {
    subreddit,
    error: error.message,
    errorType: error.name,
    status: error.status || null,
    durationMs: Date.now() - startedAt,
    endpoint: getPostsUrl(subreddit),
  });
};

const PostView = () => {
  const isVisible = usePageVisibility();
  const { refreshInterval } = useContext(RefreshIntervalContext);
  const { subreddit } = useContext(SubredditContext);
  const { viewMode } = useContext(ViewModeContext);
  const { setLoading } = useContext(LoadingContext);

  const [posts, setPosts] = useState([]);
  const [hasLoadedPosts, setHasLoadedPosts] = useState(false);
  const lastFetchStartedAtRef = useRef(0);
  const freshnessReporterRef = useRef(null);
  if (freshnessReporterRef.current === null) {
    freshnessReporterRef.current = createFreshnessReporter();
  }
  const [error, setError] = useState({
    level: 'warning',
    show: false,
    title: 'Warning:',
    message: 'There was a problem',
  });
  const padding = useBreakpointValue({ base: 2, sm: 2, md: 4 });
  const maxW = useBreakpointValue({
    base: '1280px',
    sm: '1280px',
    md: '1280px',
    xl: '1280px',
    '2xl': '1600px',
  });

  useEffect(() => {
    if (!isVisible || !refreshInterval || refreshInterval <= 0) return undefined;
    let disposed = false;
    let activeRequest = null;
    let requestDeadline;

    const fetchPosts = async () => {
      if (activeRequest || disposed) return;
      const controller = new AbortController();
      activeRequest = controller;
      let timedOut = false;
      const isCurrent = () => !disposed && activeRequest === controller && !controller.signal.aborted;
      const startedAt = Date.now();
      lastFetchStartedAtRef.current = startedAt;
      setLoading(true);
      const url = getPostsUrl(subreddit);
      try {
        if (!url) throw new Error('The news API is not configured.');
        const deadline = new Promise((resolve, reject) => {
          requestDeadline = setTimeout(() => {
            timedOut = true;
            const error = new Error('The posts request timed out after 45 seconds.');
            error.name = 'TimeoutError';
            reject(error);
            controller.abort();
          }, POST_REQUEST_TIMEOUT_MS);
        });
        const request = async () => {
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) {
            const error = new Error(`Failed to fetch posts: ${response.status}`);
            error.status = response.status;
            throw error;
          }
          return response.json();
        };
        const json = await Promise.race([request(), deadline]);
        if (!isCurrent()) return;
        const nextPosts = sortPostsByUpvotes(getValidatedPosts(json));
        setPosts(nextPosts);
        setHasLoadedPosts(true);
        setError({ show: false });
        setLoading(false);
        freshnessReporterRef.current(subreddit, nextPosts);
      } catch (error) {
        if (disposed || activeRequest !== controller || (controller.signal.aborted && !timedOut)) return;
        logPostFetchFailure(error, subreddit, startedAt);
        setError({
          level: 'error',
          show: true,
          title: url ? 'Refresh Failed' : 'Configuration Error',
          message: url ? 'There was a problem fetching new posts. Retrying.' : error.message,
        });
        setLoading(false);
      } finally {
        clearTimeout(requestDeadline);
        if (activeRequest === controller) activeRequest = null;
      }
    };

    const refreshPostsAfterResume = () => {
      if (document.visibilityState === 'hidden') return;
      const refreshAgeMs = Math.max(Number(refreshInterval) * 1000, MIN_RESUME_REFRESH_AGE_MS);
      if (Date.now() - lastFetchStartedAtRef.current >= refreshAgeMs) fetchPosts();
    };

    fetchPosts();
    const interval = setInterval(fetchPosts, refreshInterval * 1000);
    window.addEventListener('focus', refreshPostsAfterResume);
    window.addEventListener('pageshow', refreshPostsAfterResume);
    return () => {
      disposed = true;
      activeRequest?.abort();
      clearInterval(interval);
      clearTimeout(requestDeadline);
      window.removeEventListener('focus', refreshPostsAfterResume);
      window.removeEventListener('pageshow', refreshPostsAfterResume);
      setLoading(false);
    };
  }, [refreshInterval, subreddit, isVisible, setLoading]);

  return (
    <Container maxW={maxW} mt={16} pl={padding} pr={padding}>
      {error.show ? (
        <Box>
          <Alert.Root status={error.level}>
            <Alert.Indicator />
            <Alert.Title mr={2}>{error.title}</Alert.Title>
            <Alert.Description>{error.message}</Alert.Description>
          </Alert.Root>
        </Box>
      ) : null}

      {!error.show && hasLoadedPosts && posts.length === 0 ? (
        <Box
          mt={{ base: 14, md: 16 }}
          px={4}
          py={8}
          textAlign="center"
        >
          <Text color="textPrimary" textStyle="emptyState">
            Nothing notable is happening, surely everything is fine.
          </Text>
        </Box>
      ) : viewMode === 'list' ? (
        <ListView posts={posts} />
      ) : (
        <GridView posts={posts} />
      )}
    </Container>
  );
};

export default PostView;
