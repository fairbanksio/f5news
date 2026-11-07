import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRuntimeConfigValue, normalizeApiEndpoint } from '../runtimeConfig';

export { normalizeApiEndpoint } from '../runtimeConfig';

export const SubredditContext = React.createContext({
  subreddit: 'politics',
  subredditList: [],
  setSubreddit: () => {},
});

export const SubredditProvider = props => {
  const navigate = useNavigate();
  const { subredditPath } = useParams();
  const subreddit = subredditPath || localStorage.getItem('subreddit') || 'politics';
  const [subredditList, setList] = useState(() =>
    localStorage.getItem('subredditList')?.split(',') || ['politics']
  );
  const apiEndpoint = normalizeApiEndpoint(getRuntimeConfigValue('REACT_APP_API'));
  const [authoritativeList, setAuthoritativeList] = useState(null);

  const setSubreddit = nextSubreddit => {
    navigate('/r/' + nextSubreddit, { replace: true });
  };
  const setSubredditList = subreddits => {
    localStorage.setItem('subredditList', subreddits);
    setList(subreddits);
  };

  useEffect(() => {
    localStorage.setItem('subreddit', subreddit);
  }, [subreddit]);

  useEffect(() => {
    if (!apiEndpoint) return undefined;
    const controller = new AbortController();
    fetch(apiEndpoint + '/subreddits', { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Failed to fetch subreddits: ${response.status}`);
        return response.json();
      })
      .then(json => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(json.data) || !json.data.length ||
            json.data.some(name => typeof name !== 'string' || !/^[a-zA-Z0-9_]{2,21}$/.test(name)) ||
            new Set(json.data.map(name => name.toLowerCase())).size !== json.data.length) {
          throw new Error('Invalid subreddit list.');
        }
        const subreddits = [...json.data].sort((a, b) =>
          a.toLowerCase().localeCompare(b.toLowerCase())
        );
        setSubredditList(subreddits);
        setAuthoritativeList({ endpoint: apiEndpoint, subreddits });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        console.error('Failed to refresh subreddit list.', {
          error: error.message,
          endpoint: apiEndpoint + '/subreddits',
        });
      });
    return () => controller.abort();
  }, [apiEndpoint]);

  useEffect(() => {
    if (!authoritativeList || authoritativeList.endpoint !== apiEndpoint) return;
    const subreddits = authoritativeList.subreddits;
    const canonical = subreddits.find(name => name.toLowerCase() === subreddit.toLowerCase());
    const destination = canonical || subreddits.find(name => name.toLowerCase() === 'politics') || subreddits[0];
    if (subredditPath !== destination) navigate('/r/' + destination, { replace: true });
  }, [authoritativeList, apiEndpoint, subreddit, subredditPath, navigate]);

  return (
    <SubredditContext.Provider value={{ subreddit, subredditList, setSubreddit, setSubredditList }}>
      {props.children}
    </SubredditContext.Provider>
  );
};
