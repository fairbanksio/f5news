
import {
  Container,
  Grid,
  Box,
  Text
} from '@chakra-ui/react';
import { timeAgoShort } from '../Util/FormattedTime'
import { hotnessBGColor } from '../Util/HotnessBGColor';
import {PostModal} from './PostModal';

export default function GridView(props) {
  const {posts} = props
  return (
      <Container
        maxW='container.xl'
        mt={2}
        pb={4}
        p={0}
        >
        <Grid templateColumns={['repeat(1, 1fr)','repeat(1, 1fr)','repeat(2, 1fr)','repeat(3, 1fr)']} gap={4}>

          {posts?
            posts.map((item, i) => {
              return [
                <PostCard key={i} post={item}/>
              ];
            })
        :null}
        </Grid>
        
      </Container>
  );
}

function PostCard(props) {
  const {post} = props
  return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      <PostModal post={post}>
      <Box p={4}>
        <Box display='flex' alignItems='baseline'>
          <Box
            color='gray.500'
            fontWeight='semibold'
            letterSpacing='wide'
            fontSize='xs'
            textTransform='uppercase'
          >
            <Text href={'https://reddit.com/' + post.commentLink} isExternal color='link'>
              {post.upvoteCount} upvotes &bull; {post.commentCount} comments &bull;  {timeAgoShort(post.created_utc)}
            </Text>
          </Box>
        </Box>

        <Box
          mt='1'
          fontWeight='semibold'
          as='h4'
          lineHeight='tight'
          noOfLines={2}
        >
          <Text href={post.url} isExternal>
            {post.title}
          </Text>
        </Box>
      </Box>
      </PostModal>
    </Box>
  )
}