import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRuntimeConfigValue, normalizeApiEndpoint } from '../runtimeConfig';
import supportedSubreddits from '../../../services/posts/subreddits.json';

const activeSubreddits = [...supportedSubreddits].sort();
const catalogRefreshMs = 5 * 60 * 1000;

export { normalizeApiEndpoint } from '../runtimeConfig';

export const SubredditContext = React.createContext({
  subreddit: 'politics',
  subredditList: [],
  setSubreddit: () => {},
});

export const SubredditProvider = props => {
  const navigate = useNavigate();
  const { subredditPath } = useParams();
  const [subredditList, setList] = useState(activeSubreddits);
  const apiEndpoint = normalizeApiEndpoint(getRuntimeConfigValue('REACT_APP_API'));
  const [authoritativeList, setAuthoritativeList] = useState(null);
  const availableSubreddits = authoritativeList?.endpoint === apiEndpoint
    ? authoritativeList.subreddits
    : activeSubreddits;
  const fallback = availableSubreddits.includes('politics') ? 'politics' : availableSubreddits[0];
  const requested = (subredditPath || localStorage.getItem('subreddit'))?.toLowerCase();
  const subreddit = availableSubreddits.includes(requested) ? requested : fallback;

  const setSubreddit = nextSubreddit => {
    if (availableSubreddits.includes(nextSubreddit)) navigate('/r/' + nextSubreddit, { replace: true });
  };
  const setSubredditList = subreddits => {
    setList(activeSubreddits.filter(name => subreddits.some(value => value.toLowerCase() === name)));
  };

  useEffect(() => {
    localStorage.setItem('subreddit', subreddit);
  }, [subreddit]);

  useEffect(() => {
    localStorage.setItem('subredditList', subredditList);
  }, [subredditList]);

  useEffect(() => {
    if (!apiEndpoint) return undefined;
    let controller;
    let pending = false;
    let disposed = false;
    const refresh = async () => {
      if (pending || disposed || document.visibilityState === 'hidden') return;
      pending = true;
      controller = new AbortController();
      const request = controller;
      const timeout = setTimeout(() => request.abort(), 10000);
      try {
        const response = await fetch(apiEndpoint + '/subreddits', { signal: request.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`Failed to fetch subreddits: ${response.status}`);
        const json = await response.json();
        if (disposed || request.signal.aborted) return;
        if (!Array.isArray(json.data) || !json.data.length ||
            json.data.some(name => typeof name !== 'string' || !/^[a-zA-Z0-9_]{2,21}$/.test(name)) ||
            new Set(json.data.map(name => name.toLowerCase())).size !== json.data.length) {
          throw new Error('Invalid subreddit list.');
        }
        const subreddits = activeSubreddits.filter(name => json.data.some(value => value.toLowerCase() === name));
        if (!subreddits.length) throw new Error('No supported subreddits.');
        setList(subreddits);
        setAuthoritativeList({ endpoint: apiEndpoint, subreddits });
      } catch (error) {
        if (disposed) return;
        console.error('Failed to refresh subreddit list.', {
          error: error.message,
          endpoint: apiEndpoint + '/subreddits',
        });
      } finally {
        clearTimeout(timeout);
        pending = false;
      }
    };
    refresh();
    const interval = setInterval(refresh, catalogRefreshMs);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [apiEndpoint]);

  useEffect(() => {
    if (subredditPath !== subreddit) navigate('/r/' + subreddit, { replace: true });
  }, [subreddit, subredditPath, navigate]);

  return (
    <SubredditContext.Provider value={{ subreddit, subredditList, setSubreddit, setSubredditList }}>
      {props.children}
    </SubredditContext.Provider>
  );
};
