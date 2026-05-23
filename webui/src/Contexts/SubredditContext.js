import React, { useState, useEffect, useContext } from 'react';
import { LoadingContext } from '../Contexts/LoadingContext';
import { useParams, useNavigate } from 'react-router-dom';

export const SubredditContext = React.createContext({
  subreddit: 'politics',
  subredditList: [],
  setSubreddit: () => {},
});

export const SubredditProvider = props => {
  let navigate = useNavigate();
  let { subredditPath } = useParams();

  const { setLoading } = useContext(LoadingContext);

  const setSubreddit = subreddit => {
    localStorage.setItem('subreddit', subreddit);
    setState({ ...state, subreddit: subreddit });
    navigate('/r/' + subreddit, { replace: true });
  };

  const setSubredditList = subreddits => {
    localStorage.setItem('subredditList', subreddits);
    setState({ ...state, subredditList: subreddits });
  };

  const initState = {
    subreddit: subredditPath
      ? subredditPath
      : localStorage.getItem('subreddit')
        ? localStorage.getItem('subreddit')
        : 'politics',
    subredditList: localStorage.getItem('subredditList')
      ? localStorage.getItem('subredditList').split(',')
      : ['politics'],
    setSubreddit: setSubreddit,
    setSubredditList: setSubredditList,
  };

  const [state, setState] = useState(initState);

  const [, setError] = useState({
    level: 'warning',
    show: false,
    title: 'Warning:',
    message: 'There was a problem',
  }); // eslint-disable-line no-unused-vars
  let apiEndpoint = process.env.REACT_APP_API
    ? process.env.REACT_APP_API
    : window.REACT_APP_API
      ? window.REACT_APP_API
      : 'https://localhost';
  apiEndpoint = 'https://' + apiEndpoint.replace(/\/$/, '');

  const fetchSubreddits = () => {
    setLoading(true);
    fetch(apiEndpoint + '/subreddits')
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to fetch subreddits: ${response.status}`);
        }

        return response.json();
      })
      .then(json => {
        setSubredditList(
          json.data.sort(function (a, b) {
            return a.toLowerCase().localeCompare(b.toLowerCase());
          })
        );
        setTimeout(() => {
          setLoading(false);
        }, 1700);
        setError({ show: false });
      })
      .catch(error => {
        console.error('Failed to refresh subreddit list.', {
          error: error.message,
          endpoint: apiEndpoint + '/subreddits',
        });
        setError({
          level: 'error',
          show: true,
          title: 'Ooops:',
          message: 'There was a problem fetching subreddits. Retrying..',
        });
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchSubreddits();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SubredditContext.Provider value={state}>
      {props.children}
    </SubredditContext.Provider>
  );
};
