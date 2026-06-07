import React from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import { render } from '../test-utils';
import MainContent from './MainContent';
import { RefreshIntervalContext } from '../Contexts/RefreshIntervalContext';
import { SubredditContext } from '../Contexts/SubredditContext';
import { ViewModeContext } from '../Contexts/ViewModeContext';
import { LoadingContext } from '../Contexts/LoadingContext';
const { matchMedia } = require('mock-match-media');

vi.mock('react-page-visibility', () => ({
  usePageVisibility: () => true,
}));

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: matchMedia,
});

const renderMainContent = () =>
  render(
    <LoadingContext.Provider value={{ loading: false, setLoading: vi.fn() }}>
      <RefreshIntervalContext.Provider
        value={{ refreshInterval: 1, setRefreshInterval: vi.fn() }}
      >
        <SubredditContext.Provider
          value={{
            subreddit: 'politics',
            subredditList: ['politics'],
            setSubreddit: vi.fn(),
          }}
        >
          <ViewModeContext.Provider
            value={{ viewMode: 'list', setViewMode: vi.fn() }}
          >
            <MainContent />
          </ViewModeContext.Provider>
        </SubredditContext.Provider>
      </RefreshIntervalContext.Provider>
    </LoadingContext.Provider>
  );

describe('MainContent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-06T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  test('clears posts when a refresh returns a valid empty response', async () => {
    const post = {
      title: 'Existing headline',
      url: 'https://example.com/story',
      commentCount: 12,
      upvoteCount: 42,
      created_utc: Math.floor(Date.now() / 1000),
      domain: 'example.com',
      commentLink: '/r/politics/comments/abc123/example',
    };

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [post] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

    await act(async () => {
      renderMainContent();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Existing headline')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByText('Existing headline')).not.toBeInTheDocument();
    });

    expect(
      screen.getByText('Nothing notable is happening, surely everything is fine.')
    ).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('does not show the empty state while the first refresh is still loading', async () => {
    global.fetch = vi.fn(
      () =>
        new Promise(() => {
          // Keep the first request pending so the loading state is observable.
        })
    );

    await act(async () => {
      renderMainContent();
      await Promise.resolve();
    });

    expect(
      screen.queryByText('Nothing notable is happening, surely everything is fine.')
    ).not.toBeInTheDocument();
  });

  test('renders posts in descending upvote order even when the API response is unsorted', async () => {
    const lowerPost = {
      title: 'Lower upvote headline',
      url: 'https://example.com/lower',
      commentCount: 12,
      upvoteCount: 42,
      created_utc: Math.floor(Date.now() / 1000),
      domain: 'example.com',
      commentLink: '/r/politics/comments/lower/example',
    };
    const higherPost = {
      title: 'Higher upvote headline',
      url: 'https://example.com/higher',
      commentCount: 24,
      upvoteCount: 420,
      created_utc: Math.floor(Date.now() / 1000),
      domain: 'example.com',
      commentLink: '/r/politics/comments/higher/example',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [lowerPost, higherPost] }),
    });

    await act(async () => {
      renderMainContent();
      await Promise.resolve();
      await Promise.resolve();
    });

    const renderedTitles = screen
      .getAllByRole('link', { name: /upvote headline/i })
      .map(link => link.textContent)
      .filter(Boolean);

    expect(renderedTitles).toEqual([
      'Higher upvote headline',
      'Lower upvote headline',
    ]);
  });

  test('does not warn about stale posts inside the scraper refresh window', async () => {
    const post = {
      title: 'Fresh enough headline',
      url: 'https://example.com/story',
      commentCount: 12,
      upvoteCount: 42,
      created_utc: Math.floor(Date.now() / 1000),
      domain: 'example.com',
      commentLink: '/r/politics/comments/abc123/example',
      fetchedAt: '2026-06-06T11:54:30.000Z',
    };
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [post] }),
    });

    await act(async () => {
      renderMainContent();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Fresh enough headline')).toBeInTheDocument();
    expect(consoleWarnSpy).not.toHaveBeenCalledWith(
      'Posts look stale relative to the expected refresh window.',
      expect.anything()
    );

    consoleWarnSpy.mockRestore();
  });

  test('warns when posts are older than the scraper refresh window plus grace period', async () => {
    const post = {
      title: 'Actually stale headline',
      url: 'https://example.com/story',
      commentCount: 12,
      upvoteCount: 42,
      created_utc: Math.floor(Date.now() / 1000),
      domain: 'example.com',
      commentLink: '/r/politics/comments/abc123/example',
      fetchedAt: '2026-06-06T11:52:30.000Z',
    };
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [post] }),
    });

    await act(async () => {
      renderMainContent();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Posts look stale relative to the expected refresh window.',
      expect.objectContaining({
        subreddit: 'politics',
        postCount: 1,
        latestFetchedAt: '2026-06-06T11:52:30.000Z',
        expectedFreshWithinSeconds: 420,
      })
    );

    consoleWarnSpy.mockRestore();
  });

  test('keeps the last successful posts when a refresh payload is invalid', async () => {
    const post = {
      title: 'Existing headline',
      url: 'https://example.com/story',
      commentCount: 12,
      upvoteCount: 42,
      created_utc: Math.floor(Date.now() / 1000),
      domain: 'example.com',
      commentLink: '/r/politics/comments/abc123/example',
    };

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [post] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nope: true }),
      });

    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await act(async () => {
      renderMainContent();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Existing headline')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        screen.getByText('There was a problem fetching new posts. Retrying..')
      ).toBeInTheDocument();
    });

    expect(screen.getByText('Existing headline')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);

    consoleErrorSpy.mockRestore();
  });
});
