import React from 'react';
import {
  Table,
  Thead,
  Tbody,
  Tr,
  Td,
  Th,
  Flex,
  Link,
  Text,
  Tooltip,
  Container,
  IconButton,
  useBreakpointValue,
  useColorModeValue,
} from '@chakra-ui/react';
import { LinkIcon, ChatIcon, ArrowUpIcon, TimeIcon } from '@chakra-ui/icons'
import { timeAgoShort } from '../Util/FormattedTime'
import { getHeatTone } from './PostCard';

const getHeatBorderColor = (upvoteCount, colorMode) => {
  return getHeatTone(upvoteCount)?.borderColor[colorMode] || 'transparent';
};

const getHeatRowBg = (upvoteCount, colorMode) => {
  return getHeatTone(upvoteCount)?.cardBg[colorMode] || 'transparent';
};

const ListView = ({posts}) => {
  const mobileMode = useBreakpointValue({base: true, sm: true, md: false})
  const showHeaderLabels = useBreakpointValue({base: false, md: true})
  const noOfLines = useBreakpointValue({base: 3, sm: 1})
  const rowHoverBg = useColorModeValue('blackAlpha.50', '#202326')
  const heatColorMode = useColorModeValue('light', 'dark')
  return (
    <Container
        maxW='100%'
        mt={2}
        pb={4}
        p={0}
        >

      {posts && posts.length > 0 ?
        <Table
          size='sm'
          textAlign='left'
          sx={{
            th: {
              color: 'textSubtle',
              textStyle: 'meta',
            },
            td: {
              color: 'textMuted',
              textStyle: 'body',
            },
          }}
        >

          <Thead>
            <Tr >
              <Th w={1} aria-label='Comments'>
                <Flex as='span' align='center' gap={2}>
                  <ChatIcon  w={4} h={4}/>
                  {showHeaderLabels ? <Text as='span'>Comments</Text> : null}
                </Flex>
              </Th>
              <Th w={1} aria-label='Upvotes sorted descending' aria-sort='descending'>
                <Flex as='span' align='center' gap={2}>
                  <ArrowUpIcon w={5} h={5}/>
                  {showHeaderLabels ? <Text as='span'>Upvotes</Text> : null}
                </Flex>
              </Th>
              {mobileMode?null:<Th w={1} aria-label='Posted'>
                <Flex as='span' align='center' gap={2}>
                  <TimeIcon w={4} h={4}/>
                  {showHeaderLabels ? <Text as='span'>Posted</Text> : null}
                </Flex>
              </Th>}
              <Th>Title</Th>
              {mobileMode?null:<Th>Source</Th>}
              <Th>Action</Th>
            </Tr>
          </Thead>

          <Tbody>
            {
            posts.map((post, i) => {
              const title = post.title.replace(/amp;/g,'');
              return [
                  <Tr
                    key={i}
                    bg={getHeatRowBg(post.upvoteCount, heatColorMode)}
                    borderLeftWidth='4px'
                    borderLeftColor={getHeatBorderColor(post.upvoteCount, heatColorMode)}
                    _hover={{bg: rowHoverBg}}
                  >
                    <Td >{post.commentCount}</Td>
                    <Td>{post.upvoteCount}</Td>
                    {mobileMode?null:<Td>{timeAgoShort(post.created_utc)}</Td>}
                    <Td>
                      <Tooltip label={title} openDelay={500} placement='bottom-start'>
                        <Link href={post.url} isExternal color='link' id={"external-url-"+i}>
                          <Text noOfLines={noOfLines} textStyle='listTitle'>{title}</Text>
                        </Link>
                      </Tooltip>
                    </Td>
                    {mobileMode?null:<Td>
                      <Text noOfLines={1} textStyle='body'>{post.domain}</Text>
                    </Td>}
                    <Td>
                      <Tooltip label='Reddit comments'>
                        <IconButton
                          as={Link}
                          href={'https://reddit.com' + post.commentLink}
                          isExternal
                          color='link'
                          id={"reddit-url-"+i}
                          aria-label={`Open Reddit comments for ${title}`}
                          icon={<ChatIcon/>}
                          size='sm'
                          variant='ghost'
                        />
                      </Tooltip>
                      <Tooltip label='Open article'>
                        <IconButton
                          as={Link}
                          href={post.url}
                          isExternal
                          color='link'
                          id={"external-action-url-"+i}
                          aria-label={`Open article: ${title}`}
                          icon={<LinkIcon/>}
                          size='sm'
                          variant='ghost'
                        />
                      </Tooltip>
                    </Td>
                  </Tr>
                ];
            })
            }
          </Tbody>

        </Table>
      :null}

    </Container>
  );
}

export default ListView;
