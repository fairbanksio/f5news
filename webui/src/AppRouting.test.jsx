import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { render } from './test-utils';
import App from './App';

vi.mock('react-ga4', () => ({
  default: {
    initialize: vi.fn(),
    send: vi.fn(),
  },
  initialize: vi.fn(),
  send: vi.fn(),
}));

vi.mock('./Components/Navbar', () => ({
  default: () => <div>Mock Navbar</div>,
}));
vi.mock('./Components/MainContent', () => ({
  default: () => <main>Mock MainContent</main>,
}));
vi.mock('./Components/Footer', () => ({
  default: () => <footer>Mock Footer</footer>,
}));
vi.mock('./Components/MediaModal', () => ({
  MediaModal: () => <div>Mock Media Modal</div>,
}));
vi.mock('./Contexts/SubredditContext', () => ({
  SubredditProvider: ({ children }) => <>{children}</>,
}));

let consoleWarnSpy;
const originalConsoleWarn = console.warn;

beforeEach(() => {
  localStorage.clear();
  window.history.pushState({}, '', '/');
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation((message, ...args) => {
    if (String(message).includes('React Router Future Flag Warning')) {
      return;
    }

    originalConsoleWarn(message, ...args);
  });
});

afterEach(() => {
  consoleWarnSpy.mockRestore();
  vi.resetAllMocks();
});

test('redirects unknown routes to the default politics subreddit', async () => {
  render(<App />);

  await waitFor(() => {
    expect(window.location.pathname).toBe('/r/politics');
  });

  expect(screen.getByText('Mock Navbar')).toBeInTheDocument();
  expect(screen.getByText('Mock MainContent')).toBeInTheDocument();
  expect(screen.getByText('Mock Footer')).toBeInTheDocument();
});

test('uses the stored subreddit for the default redirect destination', async () => {
  localStorage.setItem('subreddit', 'technology');

  render(<App />);

  await waitFor(() => {
    expect(window.location.pathname).toBe('/r/technology');
  });
});

test('renders the app shell on subreddit routes', () => {
  window.history.pushState({}, '', '/r/worldnews');

  render(<App />);

  expect(screen.getByText('Mock Navbar')).toBeInTheDocument();
  expect(screen.getByText('Mock Media Modal')).toBeInTheDocument();
  expect(screen.getByText('Mock MainContent')).toBeInTheDocument();
  expect(screen.getByText('Mock Footer')).toBeInTheDocument();
});
