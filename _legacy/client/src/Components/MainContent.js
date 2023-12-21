import React, {useState, useEffect, useContext } from 'react';
import {
  Container,
  useBreakpointValue,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Box,
} from '@chakra-ui/react';
import { RefreshIntervalContext } from '../Contexts/RefreshIntervalContext'
import { SubredditContext } from '../Contexts/SubredditContext'
import { ViewModeContext } from '../Contexts/ViewModeContext'
import { LoadingContext } from '../Contexts/LoadingContext'
import GridView from './GridView'
import ListView from './ListView'
import { usePageVisibility } from 'react-page-visibility';


let apiEndpoint = process.env.REACT_APP_API ? process.env.REACT_APP_API : window.REACT_APP_API? window.REACT_APP_API: "https://localhost"
apiEndpoint = apiEndpoint.replace(/\/$/, '')

const gtThan5MinsAgo = (date) => {
  const FIVE_MINS = 1000 * 60 * 2;
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
  const isVisible = usePageVisibility()
  const { refreshInterval } = useContext(RefreshIntervalContext)
  const { subreddit } = useContext(SubredditContext)
  const { viewMode } = useContext(ViewModeContext)
  const { setLoading } = useContext(LoadingContext)
  

  const [posts, setPosts] = useState([]);
  const [error, setError] = useState({level: 'warning', show: false, title: 'Warning:', message: "There was a problem"})
  const padding = useBreakpointValue({base: 2, sm: 2, md: 4})
  const maxW = useBreakpointValue({base: 'container.xl', sm: 'container.xl', md: 'container.xl', xl: 'container.xl', '2xl': '1600px'})

  const fetchPosts = () => {
    
      setLoading(true)
      fetch(apiEndpoint + '/posts/' + subreddit.replace(/\+/g, '%2b'))
      .then((response) => response.json())
      .then((json) => {
        setPosts(json.data)
        setTimeout(() => {setLoading(false)}, 1700);
        setError({show:false})

        if(gtThan5MinsAgo(findLatestFetch(json.data))){
          console.log('delayed')
          setError({level:"warning", show: true, title: "Delayed Posts:", message: "Content may be out of date.. This may be due to Reddit's API experiencing issues."})
        }

      })
      .catch((error) => {
        setError({level:"error", show: true, title: "Ooops:", message: "There was a problem fetching new posts. Retrying.."})
        setLoading(false)
      });;
    
  }
  
  useEffect(() => {
    if (refreshInterval && refreshInterval > 0) {
      if(isVisible){
        fetchPosts()
        const interval = setInterval(fetchPosts, refreshInterval*1000);
        return () => clearInterval(interval);
      }
    }
  }, [refreshInterval, subreddit, isVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Container maxW={maxW} mt={16} pl={padding} pr={padding}>

      {error.show?
      <Box>
        <Alert status={error.level}>
          <AlertIcon />
          <AlertTitle mr={2}>{error.title}</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </Box>
      :null}
      
      {viewMode === 'list' ? 
        <ListView posts={posts}/>
      : 
        <GridView posts={posts}/>
      }
      
    </Container>
  );
}

export default PostView;
