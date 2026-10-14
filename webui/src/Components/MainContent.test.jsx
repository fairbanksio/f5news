import React from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import { render } from '../test-utils';
import MainContent from './MainContent';
import { RefreshIntervalContext } from '../Contexts/RefreshIntervalContext';
import { SubredditContext } from '../Contexts/SubredditContext';
import { ViewModeContext } from '../Contexts/ViewModeContext';
import { LoadingContext } from '../Contexts/LoadingContext';
const { matchMedia } = require('mock-match-media');

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: matchMedia,
});

const mainContentTree = ({ refreshInterval = 1, subreddit = 'politics', setLoading = vi.fn() } = {}) => (
    <LoadingContext.Provider value={{ loading: false, setLoading }}>
      <RefreshIntervalContext.Provider
        value={{ refreshInterval, setRefreshInterval: vi.fn() }}
      >
        <SubredditContext.Provider
          value={{
            subreddit,
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

const renderMainContent = options => render(mainContentTree(options));

describe('MainContent', () => {
  beforeEach(() => {
    window.REACT_APP_API = 'https://api.f5.test';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-06T12:00:00.000Z'));
  });

  afterEach(() => {
    delete window.REACT_APP_API;
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
        screen.getByText('There was a problem fetching new posts. Retrying.')
      ).toBeInTheDocument();
    });

    expect(screen.getByText('Existing headline')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);

    consoleErrorSpy.mockRestore();
  });

  test('records HTTP status and request duration when a refresh fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    await act(async () => {
      renderMainContent();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(errorLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        subreddit: 'politics',
        errorType: 'Error',
        status: 503,
        durationMs: 0,
        endpoint: 'https://api.f5.test/posts/politics',
      })
    );
    errorLog.mockRestore();
  });

  test('refreshes posts when a stale suspended tab receives focus', async () => {
    const stalePost = {
      title: 'Before laptop sleep headline',
      url: 'https://example.com/before',
      commentCount: 12,
      upvoteCount: 42,
      created_utc: Math.floor(Date.now() / 1000),
      domain: 'example.com',
      commentLink: '/r/politics/comments/before/example',
    };
    const freshPost = {
      title: 'After laptop wake headline',
      url: 'https://example.com/after',
      commentCount: 24,
      upvoteCount: 84,
      created_utc: Math.floor(Date.now() / 1000),
      domain: 'example.com',
      commentLink: '/r/politics/comments/after/example',
    };

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [stalePost] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [freshPost] }),
      });

    await act(async () => {
      renderMainContent({ refreshInterval: 600 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Before laptop sleep headline')).toBeInTheDocument();

    vi.setSystemTime(new Date('2026-06-06T12:11:00.000Z'));

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('After laptop wake headline')).toBeInTheDocument();
    });
    expect(screen.queryByText('Before laptop sleep headline')).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

test('shows a configuration error without requesting an implicit endpoint', async () => {
  delete window.REACT_APP_API;
  global.fetch = vi.fn();
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  renderMainContent();
  await waitFor(() => expect(screen.getByText('The news API is not configured.')).toBeInTheDocument());
  expect(global.fetch).not.toHaveBeenCalled();
  errorLog.mockRestore();
});


const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const responseFor = title => ({ ok: true, json: async () => ({ data: [{
  id: title, title, url: 'https://example.com/story', created_utc: 1780000000,
  commentLink: '/r/science/comments/test', commentCount: 1, upvoteCount: 2,
  fetchedAt: new Date().toISOString(),
}] }) });

describe('request lifecycle', () => {
  beforeEach(() => { window.REACT_APP_API = 'https://api.f5.test'; });
  afterEach(() => {
    delete window.REACT_APP_API;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

test('ignores the old feed response after a subreddit changes', async () => {
  const old = deferred();
  const next = deferred();
  const setLoading = vi.fn();
  global.fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const view = renderMainContent({ subreddit: 'politics', setLoading, refreshInterval: 600 });
  view.rerender(mainContentTree({ subreddit: 'science', setLoading, refreshInterval: 600 }));
  expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => next.resolve(responseFor('Science headline')));
  expect(screen.getByText('Science headline')).toBeInTheDocument();
  await act(async () => old.resolve(responseFor('Old politics headline')));
  expect(screen.getByText('Science headline')).toBeInTheDocument();
  expect(screen.queryByText('Old politics headline')).not.toBeInTheDocument();
  view.unmount();
});

test('does not overlap interval and resume refreshes with an active request', async () => {
  vi.useFakeTimers();
  const pending = deferred();
  global.fetch = vi.fn().mockReturnValue(pending.promise);
  const view = renderMainContent({ refreshInterval: 1 });
  await act(async () => {
    vi.advanceTimersByTime(31000);
    window.dispatchEvent(new Event('focus'));
  });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  vi.useRealTimers();
});

test('stops loading as soon as a successful response renders', async () => {
  vi.useFakeTimers();
  const pending = deferred();
  const setLoading = vi.fn();
  global.fetch = vi.fn().mockReturnValue(pending.promise);
  const view = renderMainContent({ setLoading, refreshInterval: 600 });
  expect(setLoading).toHaveBeenLastCalledWith(true);
  await act(async () => pending.resolve(responseFor('Loaded headline')));
  expect(screen.getByText('Loaded headline')).toBeInTheDocument();
  expect(setLoading).toHaveBeenLastCalledWith(false);
  setLoading.mockClear();
  await act(async () => vi.advanceTimersByTime(1700));
  expect(setLoading).not.toHaveBeenCalled();
  view.unmount();
});

test('does not update loading after unmount', async () => {
  vi.useFakeTimers();
  const setLoading = vi.fn();
  global.fetch = vi.fn().mockResolvedValue(responseFor('Loaded headline'));
  let view;
  await act(async () => { view = renderMainContent({ setLoading, refreshInterval: 600 }); });
  view.unmount();
  setLoading.mockClear();
  await act(async () => vi.advanceTimersByTime(2000));
  expect(setLoading).not.toHaveBeenCalled();
  vi.useRealTimers();
});

test('ignores a rejected request after unmount', async () => {
  let reject;
  const pending = new Promise((resolve, fail) => { reject = fail; });
  const setLoading = vi.fn();
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  global.fetch = vi.fn().mockReturnValue(pending);
  const view = renderMainContent({ setLoading });
  view.unmount();
  setLoading.mockClear();
  await act(async () => reject(new Error('Late failure')));
  expect(setLoading).not.toHaveBeenCalled();
  expect(errorLog).not.toHaveBeenCalled();
  errorLog.mockRestore();
});


test('keeps loading active while the next refresh is pending', async () => {
  vi.useFakeTimers();
  const pending = deferred();
  const setLoading = vi.fn();
  global.fetch = vi.fn().mockResolvedValueOnce(responseFor('Loaded headline')).mockReturnValueOnce(pending.promise);
  let view;
  await act(async () => { view = renderMainContent({ setLoading, refreshInterval: 1 }); });
  await act(async () => vi.advanceTimersByTime(1000));
  setLoading.mockClear();
  await act(async () => vi.advanceTimersByTime(700));
  expect(setLoading).not.toHaveBeenCalledWith(false);
  view.unmount();
});


test.each(['fetch', 'body'])('retries after a never-settling %s request reaches its deadline', async phase => {
  vi.useFakeTimers();
  const pending = deferred();
  const setLoading = vi.fn();
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  global.fetch = vi.fn()
    .mockReturnValueOnce(phase === 'fetch' ? pending.promise : Promise.resolve({ ok: true, json: () => pending.promise }))
    .mockResolvedValueOnce(responseFor('Recovered headline'));
  let view;
  await act(async () => { view = renderMainContent({ setLoading, refreshInterval: 30 }); });
  await act(async () => vi.advanceTimersByTime(45000));
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(screen.getByText('Refresh Failed')).toBeInTheDocument();
  expect(setLoading).toHaveBeenLastCalledWith(false);
  expect(errorLog).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ errorType: 'TimeoutError' }));
  await act(async () => vi.advanceTimersByTime(15000));
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Recovered headline')).toBeInTheDocument();
  expect(screen.queryByText('Refresh Failed')).not.toBeInTheDocument();
  await act(async () => pending.resolve(phase === 'fetch' ? responseFor('Expired headline') : { data: [] }));
  expect(screen.getByText('Recovered headline')).toBeInTheDocument();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

});
