import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { normalizeApiEndpoint, SubredditContext, SubredditProvider } from './SubredditContext';

const Consumer = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const { subreddit, subredditList, setSubreddit } = React.useContext(SubredditContext);

  return (
    <div>
      <span data-testid='subreddit'>{subreddit}</span>
      <span data-testid='route'>{location.pathname}</span>
      <span data-testid='navigation-type'>{navigationType}</span>
      <span data-testid='subreddit-list'>{subredditList.join('|')}</span>
      <button onClick={() => setSubreddit('news')}>Choose News</button>
      <button onClick={() => navigate('/r/news')}>Visit News</button>
    </div>
  );
};

const originalConsoleWarn = console.warn;

const renderProvider = async ({ route = '/r/politics' } = {}) => {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route
              path='/:prefix?/:subredditPath?'
              element={(
                <SubredditProvider>
                  <Consumer />
                </SubredditProvider>
              )}
            />
          </Routes>
      </MemoryRouter>
    );
  });

};

beforeEach(() => {
  localStorage.clear();
  window.REACT_APP_API = 'api.f5.test';
  vi.spyOn(console, 'warn').mockImplementation((message, ...args) => {
    if (String(message).includes('React Router Future Flag Warning')) {
      return;
    }

    originalConsoleWarn(message, ...args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.REACT_APP_API;
  delete global.fetch;
});

describe('normalizeApiEndpoint', () => {
  test('preserves an explicit http protocol', () => {
    expect(normalizeApiEndpoint('http://127.0.0.1:5055/')).toBe(
      'http://127.0.0.1:5055'
    );
  });

  test('adds https when the host has no protocol', () => {
    expect(normalizeApiEndpoint('api.f5.news/')).toBe('https://api.f5.news');
  });
});

describe('SubredditProvider', () => {
  test('filters an outdated API response to the supported catalog', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: ['WorldNews', 'news', 'politics'] }),
    });

    await renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('subreddit-list')).toHaveTextContent(/^politics$/);
    });

    expect(global.fetch).toHaveBeenCalledWith('https://api.f5.test/subreddits', { signal: expect.any(AbortSignal), cache: 'no-store' });
    expect(localStorage.getItem('subredditList')).toBe('politics');
    expect(screen.getByTestId('route')).toHaveTextContent('/r/politics');
  });

  test('logs context on subreddit fetch failure', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    await renderProvider();

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to refresh subreddit list.',
        expect.objectContaining({
          endpoint: 'https://api.f5.test/subreddits',
        })
      );
    });

  });
});

test('does not request subreddits when API configuration is absent', async () => {
  delete window.REACT_APP_API;
  global.fetch = vi.fn();
  await renderProvider();
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each([undefined, null, '', '   '])('treats empty API configuration as unavailable', endpoint => {
  expect(normalizeApiEndpoint(endpoint)).toBe('');
});


const activeFeedsResponse = () => ({ ok: true, json: async () => ({ data: ['politics', 'news', 'worldnews'] }) });

test('replaces a retired route and cached selection before the catalog loads', async () => {
  localStorage.setItem('subreddit', 'science');
  localStorage.setItem('subredditList', 'politics,science,worldnews');
  let finish;
  global.fetch = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  await renderProvider({ route: '/r/science' });
  expect(screen.getByTestId('route')).toHaveTextContent('/r/politics');
  expect(screen.getByTestId('subreddit')).toHaveTextContent('politics');
  await act(async () => finish(activeFeedsResponse()));
  expect(screen.getByTestId('route')).toHaveTextContent('/r/politics');
  expect(screen.getByTestId('navigation-type')).toHaveTextContent('REPLACE');
  expect(localStorage.getItem('subreddit')).toBe('politics');
  expect(localStorage.getItem('subredditList')).toBe('politics');
});

test('preserves a valid route when the cached list is stale', async () => {
  localStorage.setItem('subredditList', 'politics,science');
  global.fetch = vi.fn().mockResolvedValue(activeFeedsResponse());
  await renderProvider({ route: '/r/politics' });
  expect(screen.getByTestId('route')).toHaveTextContent('/r/politics');
  expect(screen.getByTestId('navigation-type')).toHaveTextContent('POP');
  expect(localStorage.getItem('subreddit')).toBe('politics');
});

test('redirects a retired route when refreshing the list fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.setItem('subredditList', 'politics,news,worldnews');
  global.fetch = vi.fn().mockRejectedValue(new Error('Unavailable'));
  await renderProvider({ route: '/r/science' });
  expect(screen.getByTestId('route')).toHaveTextContent('/r/politics');
  expect(localStorage.getItem('subreddit')).toBe('politics');
});

test('keeps politics when a retired feed is selected or visited', async () => {
  global.fetch = vi.fn().mockResolvedValue(activeFeedsResponse());
  await renderProvider();
  fireEvent.click(screen.getByRole('button', { name: 'Choose News' }));
  expect(screen.getByTestId('navigation-type')).toHaveTextContent('POP');
  fireEvent.click(screen.getByRole('button', { name: 'Visit News' }));
  expect(screen.getByTestId('navigation-type')).toHaveTextContent('REPLACE');
  expect(screen.getByTestId('route')).toHaveTextContent('/r/politics');
  expect(localStorage.getItem('subreddit')).toBe('politics');
});

test('canonicalizes route case using the supported feed name', async () => {
  global.fetch = vi.fn().mockResolvedValue(activeFeedsResponse());
  await renderProvider({ route: '/r/Politics' });
  expect(screen.getByTestId('route')).toHaveTextContent('/r/politics');
  expect(localStorage.getItem('subreddit')).toBe('politics');
});

test.each([[], ['politics', null], ['politics', 'POLITICS'], 'politics', ['../news']].map(data => [data]))(
  'keeps politics when the API feed list is invalid: %j', async data => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('subredditList', 'politics,science');
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) });
    await renderProvider({ route: '/r/science' });
    expect(screen.getByTestId('route')).toHaveTextContent('/r/politics');
    expect(localStorage.getItem('subredditList')).toBe('politics');
  }
);


test('redirects a stale saved selection to politics when the API is missing its catalog entry', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.setItem('subreddit', 'science');
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: ['worldnews', 'news'] }) });
  await renderProvider({ route: '/' });
  expect(screen.getByTestId('route')).toHaveTextContent('/r/politics');
  expect(screen.getByTestId('navigation-type')).toHaveTextContent('REPLACE');
  expect(localStorage.getItem('subreddit')).toBe('politics');
});

test('never exposes retired cached feeds before a refresh or after a refresh failure', async () => {
  localStorage.setItem('subredditList', 'politics,news,worldnews,science,technology,Economics');
  let fail;
  global.fetch = vi.fn(() => new Promise((_resolve, reject) => { fail = reject; }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await renderProvider({ route: '/r/science' });
  expect(screen.getByTestId('subreddit-list')).toHaveTextContent(/^politics$/);
  expect(screen.getByTestId('route')).toHaveTextContent('/r/politics');
  await act(async () => fail(new Error('Unavailable')));
  expect(screen.getByTestId('subreddit-list')).toHaveTextContent(/^politics$/);
  expect(screen.getByTestId('route')).toHaveTextContent('/r/politics');
});

test('filters old API catalogs and refreshes an open session on focus without changing a valid selection', async () => {
  global.fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: ['politics', 'news', 'worldnews', 'science', 'technology'] }) })
    .mockResolvedValue(activeFeedsResponse());
  await renderProvider({ route: '/r/politics' });
  expect(screen.getByTestId('subreddit-list')).toHaveTextContent(/^politics$/);
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(global.fetch).toHaveBeenLastCalledWith('https://api.f5.test/subreddits', { signal: expect.any(AbortSignal), cache: 'no-store' });
  expect(screen.getByTestId('route')).toHaveTextContent('/r/politics');
  expect(localStorage.getItem('subreddit')).toBe('politics');
});

test('refreshes the catalog periodically while the session remains open', async () => {
  vi.useFakeTimers();
  try {
    global.fetch = vi.fn().mockResolvedValue(activeFeedsResponse());
    await renderProvider({ route: '/r/news' });
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60 * 1000));
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('route')).toHaveTextContent('/r/politics');
  } finally {
    vi.useRealTimers();
  }
});

test('coalesces resume events while a catalog refresh is pending', async () => {
  let finish;
  global.fetch = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  await renderProvider({ route: '/r/politics' });
  fireEvent.focus(window);
  fireEvent(window, new Event('pageshow'));
  fireEvent(document, new Event('visibilitychange'));
  expect(global.fetch).toHaveBeenCalledTimes(1);
  await act(async () => finish(activeFeedsResponse()));
  expect(screen.getByTestId('route')).toHaveTextContent('/r/politics');
});
