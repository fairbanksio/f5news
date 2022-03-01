import { Box, Link, Center, Text, Image, Icon, Tooltip } from '@chakra-ui/react';
import { timeAgoShort } from '../Util/FormattedTime'
import { hotnessBGColor } from '../Util/HotnessBGColor';
import { FaVideo, FaLink, FaPhotoVideo, FaImage, FaImages, FaComment } from 'react-icons/fa'
import {ModalContext} from '../Contexts/ModalContext'
import {useContext} from 'react'

export const PostCard = ({post}) => {
  const {setModalData} = useContext(ModalContext)

  if (post.is_video) return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      <Box onClick={(e)=>{setModalData(post)}} >
        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' top='0' right='0' color='white' p={2} background='black' bg='rgb(33,33,33,0.5)' borderRadius='full' m={2}>
            <Center h='100%' ><Icon fontSize='xl' as={FaVideo} /></Center>
          </Box>
        </Box>
      </Box>
      <Box p={4} flex={1}>
        <Box display='flex' alignItems='baseline' >
          <Box
            color='gray.500'
            fontWeight='semibold'
            letterSpacing='wide'
            fontSize='xs'
            textTransform='uppercase'
          >
            <Link href={'https://reddit.com' + post.commentLink} color='link' isExternal>
              {post.upvoteCount} upvotes &bull; {post.commentCount} comments &bull;  {timeAgoShort(post.created_utc)}
            </Link>
          </Box>
        </Box>

        <Box
          mt='1'
          fontWeight='semibold'
          as='h4'
          lineHeight='tight'
          noOfLines={2}
        >
          <Tooltip placement='bottom-start' label={post.title.replace(/amp;/g,'')} openDelay={500}>
            <Link href={post.url} isExternal>
              {post.title.replace(/amp;/g,'')}
            </Link>
          </Tooltip>
        </Box>
      </Box>
    </Box>
  )
  else if (post.is_gallery) return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      <Box  onClick={(e)=>{setModalData(post)}} >
        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' top='0' right='0' color='white' p={2} background='black' bg='rgb(33,33,33,0.5)' borderRadius='full' m={2}>
            <Center h='100%' ><Icon fontSize='xl' as={FaImages} /></Center>
          </Box>
        </Box>
      </Box>
      <Box p={4} flex={1}>
        <Box display='flex' alignItems='baseline' >
          <Box
            color='gray.500'
            fontWeight='semibold'
            letterSpacing='wide'
            fontSize='xs'
            textTransform='uppercase'
          >
            <Link href={'https://reddit.com' + post.commentLink} color='link' isExternal>
              {post.upvoteCount} upvotes &bull; {post.commentCount} comments &bull;  {timeAgoShort(post.created_utc)}
            </Link>
          </Box>
        </Box>

        <Box
          mt='1'
          fontWeight='semibold'
          as='h4'
          lineHeight='tight'
          noOfLines={2}
        >
          <Tooltip placement='bottom-start' label={post.title.replace(/amp;/g,'')} openDelay={500}>
            <Link href={post.url} isExternal>
              {post.title.replace(/amp;/g,'')}
            </Link>
          </Tooltip>
        </Box>
      </Box>
    </Box>
    
  )
  else if (post.is_self && post.thumbnail === 'self') return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      <Link href={post.url} isExternal>
        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' top='0' h='100%' color='white' background='black' width='100%' p={4} bg='rgb(33,33,33,0.8)'>
            <Text fontSize='sm' noOfLines={8} > {post.selftext}  </Text>
          </Box>
          <Box position='absolute' top='0' right='0' color='white' p={2} background='black' bg='rgb(33,33,33,0.5)' borderRadius='full' m={2}>
            <Center h='100%' ><Icon fontSize='xl' as={FaComment} /></Center>
          </Box>
          <Box position='absolute' bottom='0' color='white' background='black' width='100%' p={2} bg='rgb(33,33,33,0.5)' >
            <Text isTruncated fontSize='xs'>{post.url} </Text>
          </Box>
        </Box>
      </Link>

      <Box p={4} flex={1}>
        <Box display='flex' alignItems='baseline' >
          <Box
            color='gray.500'
            fontWeight='semibold'
            letterSpacing='wide'
            fontSize='xs'
            textTransform='uppercase'
          >
            <Link href={'https://reddit.com' + post.commentLink} color='link' isExternal>
              {post.upvoteCount} upvotes &bull; {post.commentCount} comments &bull;  {timeAgoShort(post.created_utc)}
            </Link>
          </Box>
        </Box>

        <Box
          mt='1'
          fontWeight='semibold'
          as='h4'
          lineHeight='tight'
          noOfLines={2}
        >
          <Tooltip placement='bottom-start' label={post.title.replace(/amp;/g,'')} openDelay={500}>
            <Link href={post.url} isExternal>
              {post.title.replace(/amp;/g,'')}
            </Link>
          </Tooltip>
        </Box>
      </Box>
    </Box>
    
  )
  else if (post.is_self) return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      <Link href={post.url} isExternal>
        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' top='0' right='0' color='white' p={2} background='black' bg='rgb(33,33,33,0.5)' borderRadius='full' m={2}>
            <Center h='100%' ><Icon fontSize='xl' as={FaComment} /></Center>
          </Box>
          <Box position='absolute' bottom='0' color='white' background='black' width='100%' p={2} bg='rgb(33,33,33,0.5)' >
            <Text isTruncated fontSize='xs'>{post.url} </Text>
          </Box>
        </Box>
      </Link>
      <Box p={4} flex={1}>
        <Box display='flex' alignItems='baseline' >
          <Box
            color='gray.500'
            fontWeight='semibold'
            letterSpacing='wide'
            fontSize='xs'
            textTransform='uppercase'
          >
            <Link href={'https://reddit.com' + post.commentLink} color='link' isExternal>
              {post.upvoteCount} upvotes &bull; {post.commentCount} comments &bull;  {timeAgoShort(post.created_utc)}
            </Link>
          </Box>
        </Box>

        <Box
          mt='1'
          fontWeight='semibold'
          as='h4'
          lineHeight='tight'
          noOfLines={2}
        >
          <Tooltip placement='bottom-start' label={post.title.replace(/amp;/g,'')} openDelay={500}>
            <Link href={post.url} isExternal>
              {post.title.replace(/amp;/g,'')}
            </Link>
          </Tooltip>
        </Box>
      </Box>
    </Box>
    
  )
  else if (post.post_hint === 'link') return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      <Link href={post.url} isExternal>
        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' top='0' right='0' color='white' p={2} background='black' bg='rgb(33,33,33,0.5)' borderRadius='full' m={2}>
            <Center h='100%' ><Icon fontSize='xl' as={FaLink} /></Center>
          </Box>
          <Box position='absolute' bottom='0' color='white' background='black' width='100%' p={2} bg='rgb(33,33,33,0.5)' >
            <Text isTruncated fontSize='xs'>{post.url} </Text>
          </Box>
        </Box>
      </Link>

      <Box p={4} flex={1}>
        <Box display='flex' alignItems='baseline' >
          <Box
            color='gray.500'
            fontWeight='semibold'
            letterSpacing='wide'
            fontSize='xs'
            textTransform='uppercase'
          >
            <Link href={'https://reddit.com' + post.commentLink} color='link' isExternal>
              {post.upvoteCount} upvotes &bull; {post.commentCount} comments &bull;  {timeAgoShort(post.created_utc)}
            </Link>
          </Box>
        </Box>

        <Box
          mt='1'
          fontWeight='semibold'
          as='h4'
          lineHeight='tight'
          noOfLines={2}
        >
          <Tooltip placement='bottom-start' label={post.title.replace(/amp;/g,'')} openDelay={500}>
            <Link href={post.url} isExternal>
              {post.title.replace(/amp;/g,'')}
            </Link>
          </Tooltip>
        </Box>
      </Box>
    </Box>
  )
  else if (post.post_hint === 'image') return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
        <Box position='relative'  onClick={(e)=>{setModalData(post)}} >
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' top='0' right='0' color='white' p={2} background='black' bg='rgb(33,33,33,0.5)' borderRadius='full' m={2}>
            <Center h='100%' ><Icon fontSize='xl' as={FaImage} /></Center>
          </Box>
        </Box>

        <Box p={4} flex={1}>
          <Box display='flex' alignItems='baseline' >
            <Box
              color='gray.500'
              fontWeight='semibold'
              letterSpacing='wide'
              fontSize='xs'
              textTransform='uppercase'
            >
              <Link href={'https://reddit.com' + post.commentLink} color='link' isExternal>
                {post.upvoteCount} upvotes &bull; {post.commentCount} comments &bull;  {timeAgoShort(post.created_utc)}
              </Link>
            </Box>
          </Box>

          <Box
            mt='1'
            fontWeight='semibold'
            as='h4'
            lineHeight='tight'
            noOfLines={2}
          >
            <Tooltip placement='bottom-start' label={post.title.replace(/amp;/g,'')} openDelay={500}>
              <Link  onClick={(e)=>{setModalData(post)}} isExternal>
                {post.title.replace(/amp;/g,'')}
              </Link>
            </Tooltip>
          </Box>
        </Box>
      
    </Box>
    
  )
  else if (post.post_hint === 'rich:video') return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
        <Box position='relative'  onClick={(e)=>{setModalData(post)}} >
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' top='0' right='0' color='white' p={2} background='black' bg='rgb(33,33,33,0.5)' borderRadius='full' m={2}>
            <Center h='100%' ><Icon fontSize='xl' as={FaPhotoVideo} /></Center>
          </Box>
        </Box>

        <Box p={4} flex={1}>
          <Box display='flex' alignItems='baseline' >
            <Box
              color='gray.500'
              fontWeight='semibold'
              letterSpacing='wide'
              fontSize='xs'
              textTransform='uppercase'
            >
              <Link href={'https://reddit.com' + post.commentLink} color='link' isExternal>
                {post.upvoteCount} upvotes &bull; {post.commentCount} comments &bull;  {timeAgoShort(post.created_utc)}
              </Link>
            </Box>
          </Box>

          <Box
            mt='1'
            fontWeight='semibold'
            as='h4'
            lineHeight='tight'
            noOfLines={2}
          >
            <Tooltip placement='bottom-start' label={post.title.replace(/amp;/g,'')} openDelay={500}>
              <Link  onClick={(e)=>{setModalData(post)}} isExternal>
                {post.title.replace(/amp;/g,'')}
              </Link>
            </Tooltip>
          </Box>
        </Box>

      
    </Box>
    
  )
  else if (post.rpan_video) return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      <Box  onClick={(e)=>{setModalData(post)}} >
        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' top='0' right='0' color='white' p={2} background='black' bg='rgb(33,33,33,0.5)' borderRadius='full' m={2}>
            <Center h='100%' ><Icon fontSize='xl' as={FaVideo} color='red'/></Center>
          </Box>
        </Box>
      </Box>
      <Box p={4} flex={1}>
        <Box display='flex' alignItems='baseline' >
          <Box
            color='gray.500'
            fontWeight='semibold'
            letterSpacing='wide'
            fontSize='xs'
            textTransform='uppercase'
          >
            <Link href={'https://reddit.com' + post.commentLink} color='link' isExternal>
              {post.upvoteCount} upvotes &bull; {post.commentCount} comments &bull;  {timeAgoShort(post.created_utc)}
            </Link>
          </Box>
        </Box>

        <Box
          mt='1'
          fontWeight='semibold'
          as='h4'
          lineHeight='tight'
          noOfLines={2}
        >
          <Tooltip placement='bottom-start' label={post.title.replace(/amp;/g,'')} openDelay={500}>
            <Link href={post.url} isExternal>
              {post.title.replace(/amp;/g,'')}
            </Link>
          </Tooltip>
        </Box>
      </Box>

    </Box>
  )
  else return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      <Link href={post.url} isExternal>
        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler' || post.thumbnail === '' ? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' top='0' right='0' color='white' p={2} background='black' bg='rgb(33,33,33,0.5)' borderRadius='full' m={2}>
            <Center h='100%' ><Icon fontSize='xl' as={FaLink} /></Center>
          </Box>
          <Box position='absolute' bottom='0' color='white' background='black' width='100%' p={2} bg='rgb(33,33,33,0.5)' >
            <Text isTruncated fontSize='xs'>{post.url} </Text>
          </Box>
        </Box>
      </Link>

      <Box p={4} flex={1}>
        <Box display='flex' alignItems='baseline' >
          <Box
            color='gray.500'
            fontWeight='semibold'
            letterSpacing='wide'
            fontSize='xs'
            textTransform='uppercase'
          >
            <Link href={'https://reddit.com' + post.commentLink} color='link' isExternal>
              {post.upvoteCount} upvotes &bull; {post.commentCount} comments &bull;  {timeAgoShort(post.created_utc)}
            </Link>
          </Box>
        </Box>

        <Box
          mt='1'
          fontWeight='semibold'
          as='h4'
          lineHeight='tight'
          noOfLines={2}
        >
          <Tooltip placement='bottom-start' label={post.title.replace(/amp;/g,'')} openDelay={500}>
            <Link href={post.url} isExternal>
              {post.title.replace(/amp;/g,'')}
            </Link>
          </Tooltip>
        </Box>
      </Box>
    </Box>
    
  )
}
