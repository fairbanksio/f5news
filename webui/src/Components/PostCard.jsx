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
  Tooltip,
  useBreakpointValue,
  useColorModeValue,
} from '@chakra-ui/react';
import { ExternalLinkIcon } from '@chakra-ui/icons';
import { timeAgoShort } from '../Util/FormattedTime'
import { FaVideo, FaLink, FaImage, FaImages, FaComment, FaRedditAlien } from 'react-icons/fa'
import {ModalContext} from '../Contexts/ModalContext'
import {useContext} from 'react'

const getThumbnailSrc = (thumbnail) => {
  if (
    typeof thumbnail !== 'string' ||
    thumbnail.trim() === '' ||
    ['default', 'self', 'spoiler'].includes(thumbnail)
  ) {
    return '/placeholder.png';
  }

  return thumbnail;
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
      canPreview: true,
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
      <Box position='relative' bg={mediaBg}>
        <Image
          src={getThumbnailSrc(post.thumbnail)}
          w='100%'
          h={imageHeight}
          objectFit='cover'
          position='relative'
          fallbackSrc='/placeholder.png'
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
          textStyle='control'
        >
          <Text as='span' isTruncated display='block'>{sourceLabel}</Text>
        </Badge>
      </Box>

      <Stack p={4} spacing={3} flex='1'>
        <Flex align='center' justify='space-between' gap={3}>
          <Link
            href={redditUrl}
            color={metaColor}
            isExternal
            id={"reddit-url-"+elId}
            aria-label={`Open Reddit comments for ${title}`}
            textStyle='meta'
            noOfLines={1}
          >
            {post.upvoteCount} upvotes &bull; {post.commentCount} comments &bull; {timeAgoShort(post.created_utc)}
          </Link>
        </Flex>

        <Box data-testid='post-card-title-zone' minH='4.5rem'>
          <Tooltip placement='bottom-start' label={title} openDelay={500}>
            <Link
              href={post.url}
              isExternal
              id={"external-url-"+elId}
              color={titleColor}
              textStyle='cardTitle'
              noOfLines={3}
              _hover={{color: titleHoverColor, textDecoration: 'none'}}
            >
              {title}
            </Link>
          </Tooltip>
        </Box>

        <Flex data-testid='post-card-actions' align='center' gap={2} pt={1} mt='auto' style={{ marginTop: 'auto' }} wrap='wrap'>
          <Button
            as={Link}
            href={post.url}
            isExternal
            size='sm'
            rightIcon={<ExternalLinkIcon />}
            aria-label={`Open article: ${title}`}
            id={"external-action-url-"+elId}
            _hover={{textDecoration: 'none'}}
          >
            Article
          </Button>

          {media.canPreview ? (
            <Button
              size='sm'
              leftIcon={<Icon as={media.icon} />}
              aria-label={`Preview ${media.label.toLowerCase()}: ${title}`}
              onClick={previewMedia}
              variant='ghost'
            >
              Preview
            </Button>
          ) : null}

          <Button
            as={Link}
            href={redditUrl}
            isExternal
            size='sm'
            leftIcon={<FaRedditAlien />}
            aria-label={`Open Reddit comments for ${title}`}
            id={"reddit-action-url-"+elId}
            variant='ghost'
            _hover={{textDecoration: 'none'}}
          >
            Comments
          </Button>
        </Flex>
      </Stack>
    </Box>
  )
}
