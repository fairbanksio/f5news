import React from 'react';
import {
  Table,
  Thead,
  Tbody,
  Tr,
  Td,
  Tfoot,
  Th,
  Link,
  Text,
  Tooltip,
  Container
} from '@chakra-ui/react';
import { LinkIcon, ChatIcon, ArrowUpIcon, TimeIcon } from '@chakra-ui/icons'
import { timeAgoShort } from '../Util/FormattedTime'
import { hotnessBGColor } from '../Util/HotnessBGColor';

const ListView = (props) => {
  const {posts} = props
  return (
    <Container
        maxW='container.xl'
        mt={2}
        pb={4}
        p={0}
        >

      {posts && posts.length > 0 ?
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
            posts.map((post, i) => {
              return [
                  <Tr key={i} bg={hotnessBGColor(post.upvoteCount)}>
                    <Td>{post.commentCount}</Td>
                    <Td>{post.upvoteCount}</Td>
                    <Td>{timeAgoShort(post.created_utc)}</Td>
                    <Td>
                      <Tooltip label={post.title} fontSize='md'>
                        <Link href={post.url} isExternal color='link'>
                          <Text noOfLines={3}>{post.title}</Text>
                        </Link>
                      </Tooltip>
                    </Td>
                    <Td>{post.domain}</Td>
                    <Td>
                      <Link href={'https://reddit.com/' + post.commentLink} isExternal color='link'>
                        <ChatIcon/>
                      </Link>
                      &nbsp;
                      <Link href={post.url} color='link'>
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

export default ListView;
