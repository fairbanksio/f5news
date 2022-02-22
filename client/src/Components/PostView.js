import React, {useState, useEffect, useContext } from 'react';
import {
  Container,
  Table,
  TableCaption,
  Thead,
  Tbody,
  Tr,
  Td,
  Tfoot,
  Th,
  Link,
  Text,
  Progress,
  Tooltip,Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
} from '@chakra-ui/react';
import { LinkIcon, ChatIcon, ArrowUpIcon, TimeIcon } from '@chakra-ui/icons'
import { RefreshIntervalContext } from '../Contexts/RefreshIntervalContext'
import { SubredditContext } from '../Contexts/SubredditContext'
import { timeAgoShort } from '../Util/FormattedTime'

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

  const hotnessBGColor = (upvoteCount) => {
    if (upvoteCount >= 100 && upvoteCount < 250) {
      return 'trending';
    } else if (upvoteCount >= 250 && upvoteCount < 500) {
      return 'hot';
    } else if (upvoteCount >= 500) {
      return 'f5oclock';
    } else {
      return false;
    }
  }

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

      {data && data.length > 0 ?
        <Table size='sm' textAlign="left">

          <Thead>
            <Tr>
              <Th w={1}><ChatIcon  w={4} h={4}/></Th>
              <Th w={1}><ArrowUpIcon w={5} h={5}/></Th>
              <Th w={1}><TimeIcon w={4} h={4}/></Th>
              <Th>Title</Th>
              <Th>Source</Th>
              <Th>Action</Th>
            </Tr>
          </Thead>

          <Tbody>
            {
            data.map((item, i) => {
              return [
                  <Tr key={i} bg={hotnessBGColor(item.upvoteCount)}>
                    <Td>{item.commentCount}</Td>
                    <Td>{item.upvoteCount}</Td>
                    <Td>{timeAgoShort(item.created_utc)}</Td>
                    <Td>
                      <Tooltip label={item.title} fontSize='md'>
                        <Link href={item.url} isExternal color='link'>
                          <Text noOfLines={3}>{item.title}</Text>
                        </Link>
                      </Tooltip>
                    </Td>
                    <Td>{item.domain}</Td>
                    <Td>
                      <Link href={'https://reddit.com/' + item.commentLink} isExternal color='link'>
                        <ChatIcon/>
                      </Link>
                      &nbsp;
                      <Link href={item.url} color='link'>
                        <LinkIcon/>
                      </Link>
                    </Td>
                  </Tr>
                ];
            })
            }
          </Tbody>

          <Tfoot>
            <Tr>
              <Th w={1}><ChatIcon  w={4} h={4}/></Th>
              <Th w={1}><ArrowUpIcon w={5} h={5}/></Th>
              <Th w={1}><TimeIcon w={4} h={4}/></Th>
              <Th>Title</Th>
              <Th>Source</Th>
              <Th>Action</Th>
            </Tr>
          </Tfoot>

        </Table>
      :null}

    </Container>
  );
}

export default PostView;
