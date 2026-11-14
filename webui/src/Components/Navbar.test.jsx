import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '../test-utils';
import { LoadingContext } from '../Contexts/LoadingContext';
import { RefreshIntervalContext } from '../Contexts/RefreshIntervalContext';
import { SubredditContext, SubredditProvider } from '../Contexts/SubredditContext';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ViewModeContext } from '../Contexts/ViewModeContext';
import Nav, { getRefreshIntervalMenuValue } from './Navbar';

const viewport = vi.hoisted(() => ({ desktop: false }));

vi.mock('@chakra-ui/react', async importOriginal => ({
  ...(await importOriginal()),
  useBreakpointValue: values => values[viewport.desktop ? 'md' : 'base'],
}));

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
  viewport.desktop = false;
});

test('normalizes refresh interval menu values for Chakra radio state', () => {
  expect(getRefreshIntervalMenuValue(120)).toBe('120');
});

test('renders the current subreddit and lets users choose another one', async () => {
  const { setSubreddit } = renderNavbar();

  fireEvent.click(screen.getByRole('button', { name: /r\/politics/i }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'technology' }));

  expect(setSubreddit).toHaveBeenCalledWith('technology');
  expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
});

test('sets a five-minute refresh interval from the mobile menu', async () => {
  const { setRefreshInterval } = renderNavbar({ refreshInterval: 60 });

  fireEvent.click(screen.getByRole('button', { name: /open display settings/i }));
  expect(await screen.findByRole('menuitemradio', { name: '1m' })).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(screen.getByRole('menuitemradio', { name: '5m' }));

  await waitFor(() => expect(setRefreshInterval).toHaveBeenCalledWith(300));
});

test('sets a five-minute refresh interval from the desktop menu', async () => {
  viewport.desktop = true;
  const { setRefreshInterval } = renderNavbar({ refreshInterval: 60 });

  fireEvent.click(await screen.findByRole('button', { name: '60s' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '5m' }));

  expect(setRefreshInterval).toHaveBeenCalledWith(300);
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


test('supports keyboard navigation and Escape in the subreddit menu', async () => {
  const { setSubreddit } = renderNavbar();
  const trigger = screen.getByRole('button', { name: /r\/politics/i });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown', code: 'ArrowDown' });
  const firstItem = await screen.findByRole('menuitem', { name: 'politics' });
  const menu = screen.getByRole('menu');
  await waitFor(() => expect(menu).toHaveAttribute('aria-activedescendant', firstItem.id));
  fireEvent.keyDown(menu, { key: 'ArrowDown', code: 'ArrowDown' });
  const secondItem = screen.getByRole('menuitem', { name: 'technology' });
  await waitFor(() => expect(menu).toHaveAttribute('aria-activedescendant', secondItem.id));
  fireEvent.keyDown(menu, { key: 'Escape', code: 'Escape' });
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
  expect(setSubreddit).not.toHaveBeenCalled();
});


test('the live feed selector only shows politics even when an old catalog advertises other feeds', async () => {
  localStorage.setItem('subredditList', 'politics,news,worldnews,science,technology,Economics');
  window.REACT_APP_API = 'https://api.f5.test';
  const originalFetch = global.fetch;
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: ['politics', 'news', 'worldnews'] }) });
  try {
    render(
      <MemoryRouter initialEntries={['/r/worldnews']}>
        <Routes><Route path='/r/:subredditPath' element={
          <SubredditProvider><Nav /></SubredditProvider>
        } /></Routes>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'r/politics' }));
    await screen.findByRole('menuitem', { name: 'politics' });
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['politics']);
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['politics']);
    expect(screen.getByRole('button', { name: 'r/politics' })).toBeInTheDocument();
  } finally {
    global.fetch = originalFetch;
    delete window.REACT_APP_API;
  }
});
