import React, { useState, useEffect, useContext } from 'react'
import { LoadingContext } from '../Contexts/LoadingContext'

export const SubredditContext = React.createContext({
  subreddit: 'politics',
  subredditList: [],
  setSubreddit: () => {}
})

export const SubredditProvider = (props) => {
  const { setLoading } = useContext(LoadingContext)
  const setSubreddit = (subreddit) => {
    localStorage.setItem('subreddit', subreddit)
    setState({...state, subreddit: subreddit})
  }
  const setSubredditList = (subreddits) => {
    localStorage.setItem('subredditList', subreddits)
    setState({...state, subredditList: subreddits})
  }

  const initState = {
    subreddit: localStorage.getItem('subreddit') ? localStorage.getItem('subreddit') : 'politics',
    subredditList: localStorage.getItem('subredditList') ? localStorage.getItem('subredditList').split(',') : ['politics'],
    setSubreddit: setSubreddit,
    setSubredditList: setSubredditList
  } 

  const [state, setState] = useState(initState)



  const [error, setError] = useState({level: 'warning', show: false, title: 'Warning:', message: "There was a problem"})
  const listsubsEndpoint = process.env.REACT_APP_LIST_SUBS ? process.env.REACT_APP_LIST_SUBS : window.REACT_APP_LIST_SUBS

  const fetchPosts = () => {
    setLoading(true)
    fetch(listsubsEndpoint)
    .then((response) => response.json())
    .then((json) => {
      setSubredditList(json.subs)
      setTimeout(() => {setLoading(false)}, 1700);
      setError({show:false})
    })
    .catch((error) => {
      setError({level:"error", show: true, title: "Ooops:", message: "There was a problem fetching new posts. Retrying.."})
      setLoading(false)
    });;
  }

  useEffect(() => {
    fetchPosts()
  }, []);



  return (
    <SubredditContext.Provider value={state}>
      {props.children}
    </SubredditContext.Provider>
  )
}