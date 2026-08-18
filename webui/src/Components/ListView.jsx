import React from 'react';
import {
  Table,
  Flex,
  Link,
  Text,
  Container,
  IconButton,
  useBreakpointValue,
} from '@chakra-ui/react';
import { useColorModeValue } from '../Contexts/ColorModeContext';
import { FaArrowUp, FaComment, FaLink, FaRegClock } from 'react-icons/fa'
import { timeAgoShort } from '../Util/FormattedTime'
import { getHeatTone } from './PostCard';
import { useContext } from 'react';
import { SubredditContext } from '../Contexts/SubredditContext';
import { trackPostSelection } from '../analytics';

const getHeatBorderColor = (upvoteCount, colorMode) => {
  return getHeatTone(upvoteCount)?.borderColor[colorMode] || 'transparent';
};

const getHeatRowBg = (upvoteCount, colorMode) => {
  return getHeatTone(upvoteCount)?.cardBg[colorMode] || 'transparent';
};

const ListView = ({posts}) => {
  const { subreddit } = useContext(SubredditContext);
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
        <Table.Root
          size='sm'
          textAlign='left'
        >

          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader w={1} aria-label='Comments' color="textSubtle" textStyle="meta">
                <Flex as='span' align='center' gap={2}>
                  <FaComment />
                  {showHeaderLabels ? <Text as='span'>Comments</Text> : null}
                </Flex>
              </Table.ColumnHeader>
              <Table.ColumnHeader w={1} aria-label='Upvotes sorted descending' aria-sort='descending' color="textSubtle" textStyle="meta">
                <Flex as='span' align='center' gap={2}>
                  <FaArrowUp />
                  {showHeaderLabels ? <Text as='span'>Upvotes</Text> : null}
                </Flex>
              </Table.ColumnHeader>
              {mobileMode?null:<Table.ColumnHeader w={1} aria-label='Posted' color="textSubtle" textStyle="meta">
                <Flex as='span' align='center' gap={2}>
                  <FaRegClock />
                  {showHeaderLabels ? <Text as='span'>Posted</Text> : null}
                </Flex>
              </Table.ColumnHeader>}
              <Table.ColumnHeader color="textSubtle" textStyle="meta">Title</Table.ColumnHeader>
              {mobileMode?null:<Table.ColumnHeader color="textSubtle" textStyle="meta">Source</Table.ColumnHeader>}
              <Table.ColumnHeader color="textSubtle" textStyle="meta">Action</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {
            posts.map((post, i) => {
              const title = post.title.replace(/amp;/g,'');
              const position = i + 1;
              const trackSelection = contentType => {
                trackPostSelection({
                  contentType,
                  post,
                  position,
                  subreddit,
                  viewMode: 'list',
                });
              };
              return [
                  <Table.Row
                    key={i}
                    bg={getHeatRowBg(post.upvoteCount, heatColorMode)}
                    borderLeftWidth='4px'
                    borderLeftColor={getHeatBorderColor(post.upvoteCount, heatColorMode)}
                    _hover={{bg: rowHoverBg}}
                  >
                    <Table.Cell color="textMuted" textStyle="body">{post.commentCount}</Table.Cell>
                    <Table.Cell color="textMuted" textStyle="body">{post.upvoteCount}</Table.Cell>
                    {mobileMode?null:<Table.Cell color="textMuted" textStyle="body">{timeAgoShort(post.created_utc)}</Table.Cell>}
                    <Table.Cell color="textMuted" textStyle="body">
                      <Link href={post.url} target="_blank" rel="noopener noreferrer" color='link' id={"external-url-"+i} onClick={() => trackSelection('article')} title={title}>
                        <Text lineClamp={noOfLines} textStyle='listTitle'>{title}</Text>
                      </Link>
                    </Table.Cell>
                    {mobileMode?null:<Table.Cell color="textMuted" textStyle="body">
                      <Text lineClamp={1} textStyle='body'>{post.domain}</Text>
                    </Table.Cell>}
                    <Table.Cell color="textMuted" textStyle="body">
                        <IconButton
                          as={Link}
                          href={'https://reddit.com' + post.commentLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          color='link'
                          id={"reddit-url-"+i}
                          aria-label={`Open Reddit comments for ${title}`}
                          size='sm'
                          variant='ghost'
                          onClick={() => trackSelection('reddit_comments')}
                          title="Reddit comments"
                        >
                          <FaComment/>
                        </IconButton>
                        <IconButton
                          as={Link}
                          href={post.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          color='link'
                          id={"external-action-url-"+i}
                          aria-label={`Open article: ${title}`}
                          size='sm'
                          variant='ghost'
                          onClick={() => trackSelection('article')}
                          title="Open article"
                        >
                          <FaLink/>
                        </IconButton>
                    </Table.Cell>
                  </Table.Row>
                ];
            })
            }
          </Table.Body>

        </Table.Root>
      :null}

    </Container>
  );
}

export default ListView;
