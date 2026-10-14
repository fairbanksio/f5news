import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { normalizeApiEndpoint, SubredditContext, SubredditProvider } from './SubredditContext';

const Consumer = () => {
  const navigate = useNavigate();
  const { subreddit, subredditList, setSubreddit } = React.useContext(SubredditContext);

  return (
    <div>
      <span data-testid='subreddit'>{subreddit}</span>
      <span data-testid='subreddit-list'>{subredditList.join('|')}</span>
      <button onClick={() => setSubreddit('science')}>Choose Science</button>
      <button onClick={() => navigate('/r/technology')}>Visit Technology</button>
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
              path='/r/:subredditPath'
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
      json: async () => ({ data: ['WorldNews', 'apple', 'Technology'] }),
    });

    await renderProvider();

    expect(screen.getByTestId('subreddit')).toHaveTextContent('politics');

    await waitFor(() => {
      expect(screen.getByTestId('subreddit-list')).toHaveTextContent('apple|Technology|WorldNews');
    });

    expect(global.fetch).toHaveBeenCalledWith('https://api.f5.test/subreddits', { signal: expect.any(AbortSignal) });
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
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: ['politics', 'science'] }) });
  await renderProvider();
  await waitFor(() => expect(screen.getByTestId('subreddit-list')).toHaveTextContent('politics|science'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose Science' }));
  expect(screen.getByTestId('subreddit')).toHaveTextContent('science');
  expect(screen.getByTestId('subreddit-list')).toHaveTextContent('politics|science');
});

test('keeps a new selection when the list arrives late', async () => {
  let resolve;
  global.fetch = vi.fn(() => new Promise(done => { resolve = done; }));
  await renderProvider();
  fireEvent.click(screen.getByRole('button', { name: 'Choose Science' }));
  await act(async () => resolve({ ok: true, json: async () => ({ data: ['politics', 'science'] }) }));
  expect(screen.getByTestId('subreddit')).toHaveTextContent('science');
  expect(screen.getByTestId('subreddit-list')).toHaveTextContent('politics|science');
});

test('tracks client-side route navigation without a menu selection', async () => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: ['politics', 'technology'] }) });
  await renderProvider();
  fireEvent.click(screen.getByRole('button', { name: 'Visit Technology' }));
  expect(screen.getByTestId('subreddit')).toHaveTextContent('technology');
  expect(localStorage.getItem('subreddit')).toBe('technology');
});
