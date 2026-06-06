import ReactGA from 'react-ga4';
import { getRuntimeConfigValue } from './runtimeConfig';

const PRODUCTION_MEASUREMENT_ID = 'G-S20H9JRLT9';
const PRODUCTION_HOSTNAMES = new Set(['f5.news', 'www.f5.news']);
const SUPPORT_URL = 'https://www.buymeacoffee.com/f5news';

let initialized = false;
let lastPageView = null;

const compactParams = params =>
  Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );

const getHostname = () =>
  typeof window !== 'undefined' && window.location ? window.location.hostname : '';

export const getAnalyticsMeasurementId = ({ measurementId, hostname = getHostname() } = {}) => {
  if (measurementId) {
    return measurementId;
  }

  const configuredMeasurementId = getRuntimeConfigValue('REACT_APP_GA_MEASUREMENT_ID');
  if (configuredMeasurementId) {
    return configuredMeasurementId;
  }

  return PRODUCTION_HOSTNAMES.has(hostname) ? PRODUCTION_MEASUREMENT_ID : undefined;
};

export const initializeAnalytics = (options = {}) => {
  if (initialized) {
    return true;
  }

  const measurementId = getAnalyticsMeasurementId(options);
  if (!measurementId) {
    return false;
  }

  ReactGA.initialize([
    {
      trackingId: measurementId,
      gtagOptions: {
        send_page_view: false,
      },
    },
  ]);
  initialized = true;
  return true;
};

export const trackPageView = location => {
  if (!initializeAnalytics()) {
    return;
  }

  const page = `${location.pathname}${location.search || ''}`;
  if (page === lastPageView) {
    return;
  }

  ReactGA.send({ hitType: 'pageview', page });
  lastPageView = page;
};

export const trackColorModeChange = ({ fromMode, toMode, subreddit, surface }) => {
  if (!initializeAnalytics()) {
    return;
  }

  ReactGA.event(
    'change_color_mode',
    compactParams({
      from_mode: fromMode,
      to_mode: toMode,
      subreddit,
      surface,
    })
  );
};

export const trackViewModeChange = ({ fromMode, toMode, subreddit, surface }) => {
  if (!initializeAnalytics()) {
    return;
  }

  ReactGA.event(
    'change_view_mode',
    compactParams({
      from_mode: fromMode,
      to_mode: toMode,
      subreddit,
      surface,
    })
  );
};

export const getHotnessBucket = upvoteCount => {
  if (upvoteCount >= 10000) return 'f5oclockPeak';
  if (upvoteCount >= 2500) return 'f5oclockStrong';
  if (upvoteCount >= 500) return 'f5oclock';
  if (upvoteCount >= 250) return 'hot';
  if (upvoteCount >= 100) return 'trending';
  return 'normal';
};

export const trackPostSelection = ({
  contentType,
  post,
  position,
  subreddit,
  viewMode,
}) => {
  if (!initializeAnalytics()) {
    return;
  }

  ReactGA.event(
    'select_content',
    compactParams({
      content_type: contentType,
      item_id: post.id,
      item_name: post.title?.replace(/amp;/g, ''),
      source_domain: post.domain,
      position,
      subreddit,
      view_mode: viewMode,
      upvotes: post.upvoteCount,
      comments: post.commentCount,
      hotness_bucket: getHotnessBucket(post.upvoteCount),
      link_url: contentType === 'reddit_comments' ? `https://reddit.com${post.commentLink}` : post.url,
    })
  );
};

export const trackSupportClick = ({ surface }) => {
  if (!initializeAnalytics()) {
    return;
  }

  ReactGA.event(
    'support_click',
    compactParams({
      surface,
      link_url: SUPPORT_URL,
    })
  );
};
