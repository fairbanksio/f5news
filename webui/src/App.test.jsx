import React, { StrictMode } from 'react';
import { screen } from '@testing-library/react';
import { render } from './test-utils';
import Navbar from './Components/Navbar';
import { LoadingContext } from './Contexts/LoadingContext';
import { RefreshIntervalContext } from './Contexts/RefreshIntervalContext';
import { SubredditContext } from './Contexts/SubredditContext';
import { ThemeContext } from './Contexts/ThemeContext';
import { ViewModeContext } from './Contexts/ViewModeContext';
import { getRefreshIntervalMenuValue } from './Components/Navbar';
const { matchMedia, setMedia } = require("mock-match-media");

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: matchMedia,
});

const renderNavbar = ({ refreshInterval = 30 } = {}) =>
  render(<StrictMode>
    <LoadingContext.Provider value={{ loading: false, setLoading: vi.fn() }}>
      <RefreshIntervalContext.Provider value={{ refreshInterval, setRefreshInterval: vi.fn() }}>
        <SubredditContext.Provider value={{ subreddit: 'news', subredditList: ['news'], setSubreddit: vi.fn() }}>
          <ThemeContext.Provider value={{ theme: 'custom', setTheme: vi.fn() }}>
            <ViewModeContext.Provider value={{ viewMode: 'grid', setViewMode: vi.fn() }}>
              <Navbar />
            </ViewModeContext.Provider>
          </ThemeContext.Provider>
        </SubredditContext.Provider>
      </RefreshIntervalContext.Provider>
    </LoadingContext.Provider>
  </StrictMode>);

beforeEach(() => {
  setMedia({
    width: '1024px',
    type: 'screen',
  });
});

test('renders F5 News header', () => {
  renderNavbar();
  const headerLogoControl = screen.getByRole('button', { name: /toggle f5 news logo/i });
  expect(headerLogoControl).toBeInTheDocument();
});

test('marks the active refresh interval in mobile settings when it came from storage', () => {
  expect(getRefreshIntervalMenuValue('30')).toBe('30');
  expect(getRefreshIntervalMenuValue(30)).toBe('30');
});
