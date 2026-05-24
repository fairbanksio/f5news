import ReactGA from 'react-ga4';
import {
  initializeAnalytics,
  trackColorModeChange,
  trackPageView,
  trackPostSelection,
  trackSupportClick,
  trackViewModeChange,
} from './analytics';

vi.mock('react-ga4', () => ({
  default: {
    initialize: vi.fn(),
    send: vi.fn(),
    event: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test('does not initialize analytics for local development without an explicit measurement id', () => {
  initializeAnalytics({ hostname: 'localhost' });

  expect(ReactGA.initialize).not.toHaveBeenCalled();
});

test('initializes analytics once with automatic pageviews disabled', () => {
  initializeAnalytics({ measurementId: 'G-TEST123', hostname: 'localhost' });
  initializeAnalytics({ measurementId: 'G-TEST123', hostname: 'localhost' });

  expect(ReactGA.initialize).toHaveBeenCalledTimes(1);
  expect(ReactGA.initialize).toHaveBeenCalledWith([
    {
      trackingId: 'G-TEST123',
      gtagOptions: {
        send_page_view: false,
      },
    },
  ]);
});

test('sends one manual pageview per distinct path and search', () => {
  initializeAnalytics({ measurementId: 'G-TEST123', hostname: 'localhost' });

  trackPageView({ pathname: '/r/news', search: '' });
  trackPageView({ pathname: '/r/news', search: '' });
  trackPageView({ pathname: '/r/news', search: '?sort=hot' });

  expect(ReactGA.send).toHaveBeenCalledTimes(2);
  expect(ReactGA.send).toHaveBeenNthCalledWith(1, {
    hitType: 'pageview',
    page: '/r/news',
  });
  expect(ReactGA.send).toHaveBeenNthCalledWith(2, {
    hitType: 'pageview',
    page: '/r/news?sort=hot',
  });
});

test('tracks display preference changes with GA4-style event names and params', () => {
  initializeAnalytics({ measurementId: 'G-TEST123', hostname: 'localhost' });

  trackColorModeChange({
    fromMode: 'dark',
    toMode: 'light',
    subreddit: 'news',
    surface: 'desktop',
  });
  trackViewModeChange({
    fromMode: 'grid',
    toMode: 'list',
    subreddit: 'news',
    surface: 'desktop',
  });

  expect(ReactGA.event).toHaveBeenCalledWith('change_color_mode', {
    from_mode: 'dark',
    to_mode: 'light',
    subreddit: 'news',
    surface: 'desktop',
  });
  expect(ReactGA.event).toHaveBeenCalledWith('change_view_mode', {
    from_mode: 'grid',
    to_mode: 'list',
    subreddit: 'news',
    surface: 'desktop',
  });
});

test('tracks article and comment selections as content selections', () => {
  initializeAnalytics({ measurementId: 'G-TEST123', hostname: 'localhost' });

  trackPostSelection({
    contentType: 'article',
    post: {
      id: 'abc123',
      title: 'Existing headline',
      domain: 'example.com',
      upvoteCount: 542,
      commentCount: 12,
      url: 'https://example.com/story',
    },
    position: 1,
    subreddit: 'news',
    viewMode: 'grid',
  });

  expect(ReactGA.event).toHaveBeenCalledWith('select_content', {
    content_type: 'article',
    item_id: 'abc123',
    item_name: 'Existing headline',
    source_domain: 'example.com',
    position: 1,
    subreddit: 'news',
    view_mode: 'grid',
    upvotes: 542,
    comments: 12,
    hotness_bucket: 'f5oclock',
    link_url: 'https://example.com/story',
  });
});

test('tracks support clicks with the clicked surface', () => {
  initializeAnalytics({ measurementId: 'G-TEST123', hostname: 'localhost' });

  trackSupportClick({ surface: 'footer' });

  expect(ReactGA.event).toHaveBeenCalledWith('support_click', {
    surface: 'footer',
    link_url: 'https://www.buymeacoffee.com/f5news',
  });
});
