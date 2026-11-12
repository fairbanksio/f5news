import placeholderSrc from '../assets/placeholder.png?inline';
import axiosLogoSrc from '../assets/axios-logo.png';
import reutersLogoSrc from '../assets/reuters-logo.png';
import {
  Badge,
  Box,
  Button,
  Center,
  Flex,
  Icon,
  Image,
  Link,
  Stack,
  Text,
  useBreakpointValue,
} from '@chakra-ui/react';
import { useColorModeValue } from '../Contexts/ColorModeContext';
import { Tooltip } from './Tooltip';
import { ExternalLinkIcon } from './LegacyIcons';
import { timeAgoShort } from '../Util/FormattedTime'
import { FaVideo, FaLink, FaImage, FaImages, FaComment, FaRedditAlien } from 'react-icons/fa'
import {ModalContext} from '../Contexts/ModalContext'
import {useContext, useState} from 'react'
import { SubredditContext } from '../Contexts/SubredditContext';
import { ViewModeContext } from '../Contexts/ViewModeContext';
import { trackPostSelection } from '../analytics';
import { getVideoUrl } from '../media';

const getThumbnailSrc = (thumbnail) => {
  try {
    const url = new URL(thumbnail);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
};

const apNewsCoverSrc = 'https://dims.apnews.com/dims4/default/d3e73ae/2147483647/strip/false/crop/1281x854+0+0/resize/1200x800!/quality/90/?url=https%3A%2F%2Fassets.apnews.com%2F0c%2F94%2Fcbc970464ba8bfbc6042dd7cdd78%2Fthe-ap-default-image-2026.png';

const getPublisherFallback = post => {
  let hostname;
  try {
    hostname = new URL(post.url).hostname;
  } catch {
    hostname = String(post.domain || '').toLowerCase();
  }
  if (hostname === 'axios.com' || hostname.endsWith('.axios.com')) return { src: axiosLogoSrc, label: 'Axios' };
  if (hostname === 'reuters.com' || hostname.endsWith('.reuters.com')) return { src: reutersLogoSrc, label: 'Reuters' };
  if (hostname === 'apnews.com' || hostname.endsWith('.apnews.com')) {
    return { src: apNewsCoverSrc, label: 'AP News', minArticleWidth: 321, isLogo: false };
  }
  return null;
};

const PostThumbnail = ({ post, height }) => {
  const publisherFallback = getPublisherFallback(post);
  const sources = [...new Set([getThumbnailSrc(post.thumbnail), publisherFallback?.src, placeholderSrc].filter(Boolean))];
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[sourceIndex];
  const isPublisherFallback = source === publisherFallback?.src;
  const isLogo = isPublisherFallback && publisherFallback.isLogo !== false;
  const minArticleWidth = publisherFallback?.minArticleWidth ?? 128;
  const advanceSource = () => setSourceIndex(Math.min(sourceIndex + 1, sources.length - 1));

  return (
    <Image
      src={source}
      alt={isPublisherFallback ? publisherFallback.label : undefined}
      w='100%'
      h={height}
      objectFit={isLogo ? 'contain' : 'cover'}
      bg={isLogo ? '#fff' : undefined}
      p={isLogo ? 6 : 0}
      position='relative'
      onLoad={event => {
        if (!isPublisherFallback && source !== placeholderSrc &&
            (event.currentTarget.naturalWidth < minArticleWidth || event.currentTarget.naturalHeight < 64)) {
          advanceSource();
        }
      }}
      onError={advanceSource}
    />
  );
};

const cleanTitle = title => (title || '').replace(/amp;/g, '');

const getSourceLabel = post => {
  if (post.domain) {
    return post.domain;
  }

  try {
    return new URL(post.url).hostname.replace(/^www\./, '');
  } catch {
    return 'external link';
  }
};

const getPostMedia = post => {
  if (post.is_video || post.rpan_video) {
    return {
      icon: FaVideo,
      label: 'Video',
      canPreview: Boolean(getVideoUrl(post)),
    };
  }

  if (post.is_gallery) {
    return {
      icon: FaImages,
      label: 'Gallery',
      canPreview: true,
    };
  }

  if (post.post_hint === 'image') {
    return {
      icon: FaImage,
      label: 'Image',
      canPreview: true,
    };
  }

  if (post.post_hint === 'rich:video') {
    return {
      icon: FaLink,
      label: 'Article',
      canPreview: false,
    };
  }

  if (post.is_self) {
    return {
      icon: FaComment,
      label: 'Discussion',
      canPreview: false,
    };
  }

  return {
    icon: FaLink,
    label: 'Article',
    canPreview: false,
  };
};

const heatPalette = [
  {
    minUpvotes: 10000,
    description: 'Front Page',
    intensity: 5,
    heatColor: 'f5oclockPeak',
    cardBg: {
      light: 'f5oclockPeak',
      dark: 'f5oclockPeak',
    },
    borderColor: {
      light: 'f5oclockPeak',
      dark: 'f5oclockPeak',
    },
  },
  {
    minUpvotes: 2500,
    description: 'Surging',
    intensity: 4,
    heatColor: 'f5oclockStrong',
    cardBg: {
      light: 'f5oclockStrong',
      dark: 'f5oclockStrong',
    },
    borderColor: {
      light: 'f5oclockStrong',
      dark: 'f5oclockStrong',
    },
  },
  {
    minUpvotes: 500,
    description: 'F5 O Clock',
    intensity: 3,
    heatColor: 'f5oclock',
    cardBg: {
      light: 'f5oclock',
      dark: 'f5oclock',
    },
    borderColor: {
      light: 'f5oclock',
      dark: 'f5oclock',
    },
  },
  {
    minUpvotes: 250,
    description: 'Hot',
    intensity: 2,
    heatColor: 'hot',
    cardBg: {
      light: 'hot',
      dark: 'hot',
    },
    borderColor: {
      light: 'hot',
      dark: 'hot',
    },
  },
  {
    minUpvotes: 100,
    description: 'Rising',
    intensity: 1,
    heatColor: 'trending',
    cardBg: {
      light: 'trending',
      dark: 'trending',
    },
    borderColor: {
      light: 'trending',
      dark: 'trending',
    },
  },
];

export const getHeatTone = upvoteCount => {
  const tone = heatPalette.find(({ minUpvotes }) => upvoteCount >= minUpvotes);

  if (tone) {
    return {
      description: tone.description,
      intensity: tone.intensity,
      heatColor: tone.heatColor,
      cardBg: {
        light: tone.cardBg.light,
        dark: tone.cardBg.dark,
      },
      borderColor: {
        light: tone.borderColor.light,
        dark: tone.borderColor.dark,
      },
    };
  }

  return null;
};

export const neutralCardTone = {
  light: {
    bg: 'white',
    borderColor: 'gray.200',
    hoverBorderColor: 'blue.700',
    mediaBg: 'gray.100',
    sourceColor: 'gray.800',
    metaColor: 'gray.600',
    titleColor: 'gray.800',
    titleHoverColor: 'blue.700',
  },
  dark: {
    bg: 'gray.900',
    borderColor: 'gray.700',
    hoverBorderColor: 'blue.900',
    mediaBg: 'gray.800',
    sourceColor: 'gray.400',
    metaColor: 'gray.500',
    titleColor: 'gray.400',
    titleHoverColor: '#adbbcd',
  },
};

export const PostCard = ({post, elId}) => {
  const {setModalData} = useContext(ModalContext)
  const { subreddit } = useContext(SubredditContext);
  const { viewMode } = useContext(ViewModeContext);
  const title = cleanTitle(post.title);
  const sourceLabel = getSourceLabel(post);
  const media = getPostMedia(post);
  const heatTone = getHeatTone(post.upvoteCount);
  const imageHeight = useBreakpointValue({base: '168px', md: '210px'});
  const cardBg = useColorModeValue(heatTone?.cardBg.light || neutralCardTone.light.bg, heatTone?.cardBg.dark || neutralCardTone.dark.bg);
  const cardBorder = useColorModeValue(heatTone?.borderColor.light || neutralCardTone.light.borderColor, heatTone?.borderColor.dark || neutralCardTone.dark.borderColor);
  const cardHoverBorder = useColorModeValue(heatTone?.borderColor.light || neutralCardTone.light.hoverBorderColor, heatTone?.borderColor.dark || neutralCardTone.dark.hoverBorderColor);
  const mediaBg = useColorModeValue(neutralCardTone.light.mediaBg, neutralCardTone.dark.mediaBg);
  const sourceBg = useColorModeValue('whiteAlpha.900', 'blackAlpha.700');
  const sourceColor = useColorModeValue(neutralCardTone.light.sourceColor, neutralCardTone.dark.sourceColor);
  const titleColor = useColorModeValue(neutralCardTone.light.titleColor, neutralCardTone.dark.titleColor);
  const metaColor = useColorModeValue(neutralCardTone.light.metaColor, neutralCardTone.dark.metaColor);
  const titleHoverColor = useColorModeValue(neutralCardTone.light.titleHoverColor, neutralCardTone.dark.titleHoverColor);
  const redditUrl = 'https://reddit.com' + post.commentLink;
  const position = elId + 1;

  const trackSelection = contentType => {
    trackPostSelection({
      contentType,
      post,
      position,
      subreddit,
      viewMode,
    });
  };

  const previewMedia = () => {
    if (media.canPreview) {
      setModalData(post);
    }
  };

  return (
    <Box
      as='article'
      data-testid='post-card'
      data-heat-intensity={heatTone?.intensity || 0}
      borderWidth='1px'
      borderRadius='lg'
      borderColor={cardBorder}
      overflow='hidden'
      bg={cardBg}
      boxShadow='sm'
      display='flex'
      flexDirection='column'
      transition='border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease'
      _hover={{
        borderColor: cardHoverBorder,
        boxShadow: 'md',
        transform: 'translateY(-1px)',
      }}
    >
      <Box
        as={Link}
        href={redditUrl}
        target="_blank" rel="noopener noreferrer"
        position='relative'
        bg={mediaBg}
        display='block'
        aria-label={`Open Reddit comments for ${title}`}
        _hover={{ textDecoration: 'none' }}
        onClick={() => trackSelection('reddit_comments')}
      >
        <PostThumbnail
          key={JSON.stringify([post.url, post.domain, post.thumbnail])}
          post={post}
          height={imageHeight}
        />

        <Tooltip placement='left' label={media.label}>
          <Box
            position='absolute'
            top='0'
            right='0'
            color='white'
            p={2}
            bg='blackAlpha.700'
            borderRadius='full'
            m={2}
          >
            <Center h='100%'><Icon fontSize='lg' as={media.icon} /></Center>
          </Box>
        </Tooltip>

        <Badge
          position='absolute'
          bottom='0'
          left='0'
          m={2}
          maxW='calc(100% - 16px)'
          bg={sourceBg}
          color={sourceColor}
          borderRadius='md'
          px={2}
          py={1}
          textTransform='uppercase'
          textStyle='control'
          fontSize='xs'
          fontWeight='bold'
          lineHeight='base'
        >
          <Text as='span' truncate display='block'>{sourceLabel}</Text>
        </Badge>
      </Box>

      <Stack p={4} gap={3} flex='1'>
        <Flex align='center' justify='space-between' gap={3}>
          <Link
            href={redditUrl}
            color={metaColor}
            target="_blank" rel="noopener noreferrer"
            id={"reddit-url-"+elId}
            aria-label={`Open Reddit comments for ${title}`}
            textStyle='meta'
            lineClamp={1}
            onClick={() => trackSelection('reddit_comments')}
          >
            {post.upvoteCount} upvotes &bull; {post.commentCount} comments &bull; {timeAgoShort(post.created_utc)}
          </Link>
        </Flex>

        <Box data-testid='post-card-title-zone' minH='4.5rem'>
          <Tooltip placement='bottom-start' label={title} openDelay={500}>
            <Link
              href={post.url}
              target="_blank" rel="noopener noreferrer"
              id={"external-url-"+elId}
              color={titleColor}
              textStyle='cardTitle'
              lineClamp={3}
              _hover={{color: titleHoverColor, textDecoration: 'none'}}
              onClick={() => trackSelection('article')}
            >
              {title}
            </Link>
          </Tooltip>
        </Box>

        <Flex data-testid='post-card-actions' align='center' gap={2} pt={1} mt='auto' style={{ marginTop: 'auto' }} wrap='wrap'>
          <Button
            as={Link}
            href={post.url}
            target="_blank" rel="noopener noreferrer"
            size='sm'
            gap={2}
            aria-label={`Open article: ${title}`}
            id={"external-action-url-"+elId}
            _hover={{textDecoration: 'none'}}
            onClick={() => trackSelection('article')}
          >
            Article
            <ExternalLinkIcon />
          </Button>

          {media.canPreview ? (
            <Button
              size='sm'
              gap={2}
              aria-label={`Preview ${media.label.toLowerCase()}: ${title}`}
              onClick={previewMedia}
              variant='ghost'
            >
              <Icon as={media.icon} />
              Preview
            </Button>
          ) : null}

          <Button
            as={Link}
            href={redditUrl}
            target="_blank" rel="noopener noreferrer"
            size='sm'
            gap={2}
            aria-label={`Open Reddit comments for ${title}`}
            id={"reddit-action-url-"+elId}
            variant='ghost'
            _hover={{textDecoration: 'none'}}
            onClick={() => trackSelection('reddit_comments')}
          >
            <FaRedditAlien />
            Comments
          </Button>
        </Flex>
      </Stack>
    </Box>
  )
}
