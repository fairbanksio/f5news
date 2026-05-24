import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoadingContext } from './LoadingContext';
import { normalizeApiEndpoint, SubredditContext, SubredditProvider } from './SubredditContext';

const Consumer = () => {
  const { subreddit, subredditList, setSubreddit } = React.useContext(SubredditContext);

  return (
    <div>
      <span data-testid='subreddit'>{subreddit}</span>
      <span data-testid='subreddit-list'>{subredditList.join('|')}</span>
      <button onClick={() => setSubreddit('science')}>Choose Science</button>
    </div>
  );
};

const originalConsoleWarn = console.warn;

const renderProvider = async ({ route = '/r/politics', setLoading = vi.fn() } = {}) => {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[route]}>
        <LoadingContext.Provider value={{ loading: false, setLoading }}>
          <Routes>
            <Route
              path='/r/:subredditPath'
              element={(
                <SubredditProvider>
                  <Consumer />
                </SubredditProvider>
              )}
            />
          </Routes>
        </LoadingContext.Provider>
      </MemoryRouter>
    );
  });

  return { setLoading };
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
      json: async () => ({ data: ['WorldNews', 'apple', 'Technology'] }),
    });

    const { setLoading } = await renderProvider();

    expect(screen.getByTestId('subreddit')).toHaveTextContent('politics');
    expect(setLoading).toHaveBeenCalledWith(true);

    await waitFor(() => {
      expect(screen.getByTestId('subreddit-list')).toHaveTextContent('apple|Technology|WorldNews');
    });

    expect(global.fetch).toHaveBeenCalledWith('https://api.f5.test/subreddits');
    expect(localStorage.getItem('subredditList')).toBe('apple,Technology,WorldNews');
  });

  test('keeps the route and stored preference in sync when changing subreddit', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: ['politics', 'science'] }),
    });

    await renderProvider();

    fireEvent.click(screen.getByRole('button', { name: /choose science/i }));

    expect(screen.getByTestId('subreddit')).toHaveTextContent('science');
    expect(localStorage.getItem('subreddit')).toBe('science');
  });

  test('stops loading and logs context on subreddit fetch failure', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    const { setLoading } = await renderProvider();

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to refresh subreddit list.',
        expect.objectContaining({
          endpoint: 'https://api.f5.test/subreddits',
        })
      );
    });

    expect(setLoading).toHaveBeenLastCalledWith(false);
  });
});
