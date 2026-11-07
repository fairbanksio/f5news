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
      <button onClick={() => navigate('/r/worldnews')}>Visit World News</button>
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
  test('loads and alphabetizes subreddits from the API', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: ['WorldNews', 'news', 'politics'] }),
    });

    await renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('subreddit-list')).toHaveTextContent('news|politics|worldnews');
    });

    expect(global.fetch).toHaveBeenCalledWith('https://api.f5.test/subreddits', { signal: expect.any(AbortSignal), cache: 'no-store' });
    expect(localStorage.getItem('subredditList')).toBe('news,politics,worldnews');
    expect(screen.getByTestId('route')).toHaveTextContent('/r/politics');
  });

  test('keeps the route and stored preference in sync when changing subreddit', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: ['politics', 'news'] }),
    });

    await renderProvider();

    fireEvent.click(screen.getByRole('button', { name: /choose news/i }));

    expect(screen.getByTestId('subreddit')).toHaveTextContent('news');
    expect(localStorage.getItem('subreddit')).toBe('news');
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


test('keeps the loaded list when selecting a subreddit', async () => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: ['politics', 'news'] }) });
  await renderProvider();
  await waitFor(() => expect(screen.getByTestId('subreddit-list')).toHaveTextContent('news|politics'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose News' }));
  expect(screen.getByTestId('subreddit')).toHaveTextContent('news');
  expect(screen.getByTestId('subreddit-list')).toHaveTextContent('news|politics');
});

test('keeps a new selection when the list arrives late', async () => {
  let resolve;
  global.fetch = vi.fn(() => new Promise(done => { resolve = done; }));
  await renderProvider();
  fireEvent.click(screen.getByRole('button', { name: 'Choose News' }));
  await act(async () => resolve({ ok: true, json: async () => ({ data: ['politics', 'news'] }) }));
  expect(screen.getByTestId('subreddit')).toHaveTextContent('news');
  expect(screen.getByTestId('subreddit-list')).toHaveTextContent('news|politics');
});

test('tracks client-side route navigation without a menu selection', async () => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: ['politics', 'news'] }) });
  await renderProvider();
  fireEvent.click(screen.getByRole('button', { name: 'Visit News' }));
  expect(screen.getByTestId('subreddit')).toHaveTextContent('news');
  expect(localStorage.getItem('subreddit')).toBe('news');
});


const activeFeedsResponse = () => ({ ok: true, json: async () => ({ data: ['politics', 'news', 'worldnews'] }) });

test('replaces a retired route and cached selection after the authoritative list loads', async () => {
  localStorage.setItem('subreddit', 'science');
  localStorage.setItem('subredditList', 'politics,science,worldnews');
  let finish;
  global.fetch = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  await renderProvider({ route: '/r/science' });
  expect(screen.getByTestId('route')).toHaveTextContent('/r/science');
  await act(async () => finish(activeFeedsResponse()));
  expect(screen.getByTestId('route')).toHaveTextContent('/r/politics');
  expect(screen.getByTestId('navigation-type')).toHaveTextContent('REPLACE');
  expect(localStorage.getItem('subreddit')).toBe('politics');
  expect(localStorage.getItem('subredditList')).toBe('news,politics,worldnews');
});

test('preserves a valid route when the cached list is stale', async () => {
  localStorage.setItem('subredditList', 'politics,science');
  global.fetch = vi.fn().mockResolvedValue(activeFeedsResponse());
  await renderProvider({ route: '/r/worldnews' });
  expect(screen.getByTestId('route')).toHaveTextContent('/r/worldnews');
  expect(screen.getByTestId('navigation-type')).toHaveTextContent('POP');
  expect(localStorage.getItem('subreddit')).toBe('worldnews');
});

test('does not redirect a retired route when refreshing the list fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.setItem('subredditList', 'politics,news,worldnews');
  global.fetch = vi.fn().mockRejectedValue(new Error('Unavailable'));
  await renderProvider({ route: '/r/science' });
  expect(screen.getByTestId('route')).toHaveTextContent('/r/science');
  expect(localStorage.getItem('subreddit')).toBe('science');
});

test('uses the current route when the authoritative list arrives after navigation', async () => {
  let finish;
  global.fetch = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  await renderProvider({ route: '/r/science' });
  fireEvent.click(screen.getByRole('button', { name: 'Visit World News' }));
  await act(async () => finish(activeFeedsResponse()));
  expect(screen.getByTestId('route')).toHaveTextContent('/r/worldnews');
  expect(localStorage.getItem('subreddit')).toBe('worldnews');
});

test('canonicalizes route case using the authoritative feed name', async () => {
  global.fetch = vi.fn().mockResolvedValue(activeFeedsResponse());
  await renderProvider({ route: '/r/WorldNews' });
  expect(screen.getByTestId('route')).toHaveTextContent('/r/worldnews');
  expect(localStorage.getItem('subreddit')).toBe('worldnews');
});

test.each([[], ['politics', null], ['politics', 'POLITICS'], 'politics', ['../news']].map(data => [data]))(
  'keeps the current route when the API feed list is invalid: %j', async data => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('subredditList', 'politics,science');
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) });
    await renderProvider({ route: '/r/science' });
    expect(screen.getByTestId('route')).toHaveTextContent('/r/science');
    expect(localStorage.getItem('subredditList')).toBe('news,politics,worldnews');
  }
);


test('redirects a stale saved selection to an active fallback when politics is absent', async () => {
  localStorage.setItem('subreddit', 'science');
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: ['worldnews', 'news'] }) });
  await renderProvider({ route: '/' });
  expect(screen.getByTestId('route')).toHaveTextContent('/r/news');
  expect(screen.getByTestId('navigation-type')).toHaveTextContent('REPLACE');
  expect(localStorage.getItem('subreddit')).toBe('news');
});

test('never exposes retired cached feeds before a refresh or after a refresh failure', async () => {
  localStorage.setItem('subredditList', 'politics,news,worldnews,science,technology,Economics');
  let fail;
  global.fetch = vi.fn(() => new Promise((_resolve, reject) => { fail = reject; }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await renderProvider({ route: '/r/science' });
  expect(screen.getByTestId('subreddit-list')).toHaveTextContent('news|politics|worldnews');
  expect(screen.getByTestId('route')).toHaveTextContent('/r/science');
  await act(async () => fail(new Error('Unavailable')));
  expect(screen.getByTestId('subreddit-list')).toHaveTextContent('news|politics|worldnews');
  expect(screen.getByTestId('route')).toHaveTextContent('/r/science');
});

test('filters old API catalogs and refreshes an open session on focus without changing a valid selection', async () => {
  global.fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: ['politics', 'news', 'worldnews', 'science', 'technology'] }) })
    .mockResolvedValue(activeFeedsResponse());
  await renderProvider({ route: '/r/worldnews' });
  expect(screen.getByTestId('subreddit-list')).toHaveTextContent('news|politics|worldnews');
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(global.fetch).toHaveBeenLastCalledWith('https://api.f5.test/subreddits', { signal: expect.any(AbortSignal), cache: 'no-store' });
  expect(screen.getByTestId('route')).toHaveTextContent('/r/worldnews');
  expect(localStorage.getItem('subreddit')).toBe('worldnews');
});

test('refreshes the catalog periodically while the session remains open', async () => {
  vi.useFakeTimers();
  try {
    global.fetch = vi.fn().mockResolvedValue(activeFeedsResponse());
    await renderProvider({ route: '/r/news' });
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60 * 1000));
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('route')).toHaveTextContent('/r/news');
  } finally {
    vi.useRealTimers();
  }
});

test('coalesces resume events while a catalog refresh is pending', async () => {
  let finish;
  global.fetch = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  await renderProvider({ route: '/r/worldnews' });
  fireEvent.focus(window);
  fireEvent(window, new Event('pageshow'));
  fireEvent(document, new Event('visibilitychange'));
  expect(global.fetch).toHaveBeenCalledTimes(1);
  await act(async () => finish(activeFeedsResponse()));
  expect(screen.getByTestId('route')).toHaveTextContent('/r/worldnews');
});
