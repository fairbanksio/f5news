import React from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import { render } from '../test-utils';
import MainContent from './MainContent';
import { RefreshIntervalContext } from '../Contexts/RefreshIntervalContext';
import { SubredditContext } from '../Contexts/SubredditContext';
import { ViewModeContext } from '../Contexts/ViewModeContext';
import { LoadingContext } from '../Contexts/LoadingContext';
const { matchMedia } = require('mock-match-media');

jest.mock('react-page-visibility', () => ({
  usePageVisibility: () => true,
}));

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: matchMedia,
});

const renderMainContent = () =>
  render(
    <LoadingContext.Provider value={{ loading: false, setLoading: jest.fn() }}>
      <RefreshIntervalContext.Provider
        value={{ refreshInterval: 1, setRefreshInterval: jest.fn() }}
      >
        <SubredditContext.Provider
          value={{
            subreddit: 'politics',
            subredditList: ['politics'],
            setSubreddit: jest.fn(),
          }}
        >
          <ViewModeContext.Provider
            value={{ viewMode: 'list', setViewMode: jest.fn() }}
          >
            <MainContent />
          </ViewModeContext.Provider>
        </SubredditContext.Provider>
      </RefreshIntervalContext.Provider>
    </LoadingContext.Provider>
  );

describe('MainContent', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.resetAllMocks();
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
      jest.advanceTimersByTime(1000);
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
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        screen.getByText('There was a problem fetching new posts. Retrying..')
      ).toBeInTheDocument();
    });

    expect(screen.getByText('Existing headline')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);

    consoleErrorSpy.mockRestore();
  });
});
