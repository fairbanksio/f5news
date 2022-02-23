import React, {useState, useEffect, useContext } from 'react';
import {
  Container,
  Progress,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
} from '@chakra-ui/react';
import { RefreshIntervalContext } from '../Contexts/RefreshIntervalContext'
import { SubredditContext } from '../Contexts/SubredditContext'
import { ViewModeContext } from '../Contexts/ViewModeContext'
import GridView from './GridView'
import ListView from './ListView'

const apiEndpoint = process.env.REACT_APP_API ? process.env.REACT_APP_API : window.REACT_APP_API

const gtThan5MinsAgo = (date) => {
  const FIVE_MINS = 1000 * 60 * 1;
  const fiveMinsAgo = Date.now() - FIVE_MINS;
  return new Date(date).getTime() < fiveMinsAgo;
}

const findLatestFetch = (posts) => {
  let latestFetch
  for(let i = 0; i < posts.length; i++){
    let currentPostFetchedAt = new Date(posts[i].fetchedAt).getTime()

    if(latestFetch == null){
      latestFetch = currentPostFetchedAt
    } else if (currentPostFetchedAt > latestFetch) {
      latestFetch = currentPostFetchedAt
    }
    
  }
  return latestFetch
}

const PostView = () => {
  const { refreshInterval } = useContext(RefreshIntervalContext)
  const { subreddit } = useContext(SubredditContext)
  const { viewMode } = useContext(ViewModeContext)

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState({level: 'warning', show: false, title: 'Warning:', message: "There was a problem"})

  

  const fetchPosts = () => {
    setLoading(true)
    fetch(apiEndpoint + '/?sub=' + subreddit)
    .then((response) => response.json())
    .then((json) => {
      setData(json.posts)
      setTimeout(() => {setLoading(false)}, 1700);
      setError({show:false})

      if(gtThan5MinsAgo(findLatestFetch(json.posts))){
        setError({level:"warning", show: true, title: "Delayed Data:", message: "Content may be out of date.. This may be due to Reddit's API experiencing issues."})
      }

    })
    .catch((error) => {
      setError({level:"error", show: true, title: "Ooops:", message: "There was a problem fetching new posts. Retrying.."})
      setLoading(false)
    });;
  }
  // call every interval to api
  useEffect(() => {
    if (refreshInterval && refreshInterval > 0) {
      const interval = setInterval(fetchPosts, refreshInterval*1000);
      return () => clearInterval(interval);
    }
  }, [refreshInterval, subreddit]);

  // call only on load/refresh
  useEffect(() => {
    fetchPosts()
  }, [subreddit]);
  console.log(viewMode)
  return (
    <Container maxW='container.xl' >
      {loading?
        <Progress size='xs' isIndeterminate />:<Progress value={0} size='xs' />}

      {error.show? 
        <Alert status={error.level}>
          <AlertIcon />
          <AlertTitle mr={2}>{error.title}</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      : null}

      {viewMode === 'list' ? 
        <ListView posts={data}/>
      : 
        <GridView posts={data}/>
      }
      

      

    </Container>
  );
}

export default PostView;
