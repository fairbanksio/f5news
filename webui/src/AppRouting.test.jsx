import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from './test-utils';
import App from './App';
import { ModalContext } from './Contexts/ModalContext';

vi.mock('react-ga4', () => ({
  default: {
    initialize: vi.fn(),
    send: vi.fn(),
  },
  initialize: vi.fn(),
  send: vi.fn(),
}));

vi.mock('./Components/Navbar', () => ({
  default: function MockNavbar() {
    const { setModalData } = React.useContext(ModalContext);
    return <div>Mock Navbar<button onClick={() => setModalData({ post_hint: 'image' })}>Open Media Preview</button></div>;
  },
}));
vi.mock('./Components/MainContent', () => ({
  default: () => <main>Mock MainContent</main>,
}));
vi.mock('./Components/Footer', () => ({
  default: () => <footer>Mock Footer</footer>,
}));
vi.mock('./Components/MediaModal', () => ({
  MediaModal: () => {
    const { setModalData } = React.useContext(ModalContext);
    return <div>Mock Media Modal<button onClick={() => setModalData(null)}>Close Media Preview</button></div>;
  },
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
  expect(screen.queryByText('Mock Media Modal')).not.toBeInTheDocument();
  expect(screen.getByText('Mock MainContent')).toBeInTheDocument();
  expect(screen.getByText('Mock Footer')).toBeInTheDocument();
});

test('opens and closes the media preview from the app shell', async () => {
  render(<App />);

  expect(screen.queryByText('Mock Media Modal')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open Media Preview' }));
  expect(await screen.findByText('Mock Media Modal')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Close Media Preview' }));
  expect(screen.queryByText('Mock Media Modal')).not.toBeInTheDocument();
});
