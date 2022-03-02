
import {
  Container,
  Grid,

} from '@chakra-ui/react';
import {PostCard} from './PostCard';


export default function GridView({posts}) {

  return (
      <Container
        maxW='container.xl'
        mt={2}
        pb={4}
        p={0}
        >
        <Grid templateColumns={['repeat(1, 1fr)','repeat(1, 1fr)','repeat(2, 1fr)','repeat(3, 1fr)']} gap={4}>

          {posts?
            posts.map((post, i) => {

              return [
                <PostCard key={i} elId={i} post={post}/>
              ];

            })
        :null}
        </Grid>
        
      </Container>
  );
}
