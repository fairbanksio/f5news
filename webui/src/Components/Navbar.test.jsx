import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '../test-utils';
import { LoadingContext } from '../Contexts/LoadingContext';
import { RefreshIntervalContext } from '../Contexts/RefreshIntervalContext';
import { SubredditContext } from '../Contexts/SubredditContext';
import { ViewModeContext } from '../Contexts/ViewModeContext';
import Nav, { getRefreshIntervalMenuValue } from './Navbar';

vi.mock('react-ga4', () => ({
  default: {
    event: vi.fn(),
  },
  event: vi.fn(),
}));

const renderNavbar = ({
  loading = false,
  refreshInterval = 60,
  subreddit = 'politics',
  subredditList = ['politics', 'technology'],
  setRefreshInterval = vi.fn(),
  setSubreddit = vi.fn(),
} = {}) => {
  render(
    <LoadingContext.Provider value={{ loading }}>
      <RefreshIntervalContext.Provider value={{ refreshInterval, setRefreshInterval }}>
        <SubredditContext.Provider value={{ subreddit, subredditList, setSubreddit }}>
          <ViewModeContext.Provider value={{ viewMode: 'grid', setViewMode: vi.fn() }}>
            <Nav />
          </ViewModeContext.Provider>
        </SubredditContext.Provider>
      </RefreshIntervalContext.Provider>
    </LoadingContext.Provider>
  );

  return { setRefreshInterval, setSubreddit };
};

beforeEach(() => {
  window.scrollTo = vi.fn();
});

test('normalizes refresh interval menu values for Chakra radio state', () => {
  expect(getRefreshIntervalMenuValue(120)).toBe('120');
});

test('renders the current subreddit and lets users choose another one', () => {
  const { setSubreddit } = renderNavbar();

  fireEvent.click(screen.getByRole('button', { name: /r\/politics/i }));
  fireEvent.click(screen.getByText('technology').closest('button'));

  expect(setSubreddit).toHaveBeenCalledWith('technology');
  expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
});

test('updates the desktop refresh interval from the menu', () => {
  const { setRefreshInterval } = renderNavbar({ refreshInterval: 60 });

  fireEvent.click(screen.getByRole('button', { name: /60s/i }));
  fireEvent.click(screen.getByText('5m').closest('button'));

  expect(setRefreshInterval).toHaveBeenCalledWith(600);
});

test('shows a determinate progress bar when not loading', () => {
  renderNavbar({ loading: false });

  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
});

test('toggles the logo artwork with pointer and keyboard activation', () => {
  renderNavbar();

  const logoButton = screen.getByRole('button', { name: /toggle f5 news logo/i });
  expect(screen.queryByRole('img')).not.toBeInTheDocument();

  fireEvent.click(logoButton);
  expect(screen.getByRole('img')).toHaveAttribute('src', '/usa.svg');

  fireEvent.keyDown(logoButton, { key: 'Enter' });
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
