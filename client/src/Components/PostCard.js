import { Box, Stack, Link, Center, Button, Modal, ModalOverlay, ModalBody, ModalCloseButton, ModalFooter, Text, ModalHeader, ModalContent, Image, useDisclosure, Icon } from '@chakra-ui/react';
import { timeAgoShort } from '../Util/FormattedTime'
import { hotnessBGColor } from '../Util/HotnessBGColor';
import { FaVideo, FaLink, FaPhotoVideo, FaImage, FaImages, FaComment } from 'react-icons/fa'

export const PostCard = ({post}) => {
  const { isOpen, onOpen, onClose } = useDisclosure()

  const htmlDecode = (content) => {
    let e = document.createElement('div');
    e.innerHTML = content;
    return e.childNodes.length === 0 ? "" : e.childNodes[0].nodeValue;
  }

  if (post.is_video) return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      
      <Box onClick={onOpen} >

        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' top='0' right='0' color='white' p={2} color='white' background='black' bg='rgb(33,33,33,0.5)' borderRadius='full' m={2}>
            <Center h='100%' ><Icon fontSize='xl' as={FaVideo} /></Center>
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
            <Link href={post.url} isExternal>
              {post.title}
            </Link>
          </Box>
        </Box>

        <Modal onClose={onClose} isOpen={isOpen} isCentered blockScrollOnMount={false}>
          <ModalOverlay />
          <ModalContent maxW='container.xl' maxH='100vh' bg='green' w='auto'>
            <ModalBody p={0}>
              <Center maxW='container.xl'>
                <Box position='relative'>
                  <Box
                    as='video'
                    controls
                    loop="true" autoplay="autoplay"
                    src={post.media.reddit_video.fallback_url}
                    
                    objectFit='contain'
                    type="application/x-mpegURL"
                  />
                  <ModalCloseButton />
                </Box>
              </Center>
            </ModalBody>
          </ModalContent>
        </Modal>
      </Box>
    </Box>
  )
  else if (post.is_gallery) return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      
      <Box onClick={onOpen} >

        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' top='0' right='0' color='white' p={2} color='white' background='black' bg='rgb(33,33,33,0.5)' borderRadius='full' m={2}>
            <Center h='100%' ><Icon fontSize='xl' as={FaImages} /></Center>
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
            <Link href={post.url} isExternal>
              {post.title}
            </Link>
          </Box>
        </Box>
        
        <Modal onClose={onClose} isOpen={isOpen} isCentered >
          <ModalOverlay />
          <ModalContent maxW='container.xl' bg='none' w='auto' >
            <ModalBody p={0}>
              <Center maxW='container.xl' position='relative' overflow='hidden'>
                <Stack overflowY='scroll' maxH='80vh' >
                  {Object.keys(post.media_metadata).map((key) =>{
                    return (
                      <Image key={key} src={post.media_metadata[key].s.u.replace(/amp;/g,'')} w='100%' objectFit='cover' maxH='75vh' minW='50%'/>
                    )
                  })}
                </Stack>
                <ModalCloseButton color='white' mr={4}/>
              </Center>
            </ModalBody>
          </ModalContent>
        </Modal>
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
          <Box position='absolute' top='0' right='0' color='white' p={2} color='white' background='black' bg='rgb(33,33,33,0.5)' borderRadius='full' m={2}>
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
          <Link href={post.url} isExternal>
            {post.title}
          </Link>
        </Box>
      </Box>
    </Box>
    
  )
  else if (post.is_self) return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      <Link href={post.url} isExternal>
        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' top='0' right='0' color='white' p={2} color='white' background='black' bg='rgb(33,33,33,0.5)' borderRadius='full' m={2}>
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
          <Link href={post.url} isExternal>
            {post.title}
          </Link>
        </Box>
      </Box>
    </Box>
    
  )
  else if (post.post_hint === 'link') return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      <Link href={post.url} isExternal>
        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' top='0' right='0' color='white' p={2} color='white' background='black' bg='rgb(33,33,33,0.5)' borderRadius='full' m={2}>
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
          <Link href={post.url} isExternal>
            {post.title}
          </Link>
        </Box>
      </Box>
    </Box>
  )
  else if (post.post_hint === 'image') return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
        <Box position='relative' onClick={onOpen} >
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' top='0' right='0' color='white' p={2} color='white' background='black' bg='rgb(33,33,33,0.5)' borderRadius='full' m={2}>
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
            <Link onClick={onOpen} isExternal>
              {post.title}
            </Link>
          </Box>
        </Box>
        
        <Modal onClose={onClose} isOpen={isOpen} isCentered blockScrollOnMount={false}>
          <ModalOverlay />
          <ModalContent maxW='container.xl' maxH='100vh' bg='none' w='auto'>
            <ModalBody p={0} >
              <Center maxW='container.xl'>
                <Box position='relative'>
                  <Image src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail}  objectFit='contain' maxH='90vh' minW='50%'/>
                  <ModalCloseButton />
                </Box>
              </Center>
            </ModalBody>
          </ModalContent>
        </Modal>
      
    </Box>
    
  )
  else if (post.post_hint === 'rich:video') return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
        <Box position='relative' onClick={onOpen} >
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' top='0' right='0' color='white' p={2} color='white' background='black' bg='rgb(33,33,33,0.5)' borderRadius='full' m={2}>
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
            <Link onClick={onOpen} isExternal>
              {post.title}
            </Link>
          </Box>
        </Box>
        
        <Modal onClose={onClose} isOpen={isOpen} isCentered blockScrollOnMount={false}>
          <ModalOverlay />
          <ModalContent maxW='container.xl' maxH='100vh' bg='none' w='auto'>
            <ModalBody p={0} >
              <Center maxW='container.xl'>
                <Box position='relative'>
                  <Box dangerouslySetInnerHTML={{__html: htmlDecode(post.media.oembed.html)}} w='100%'/>
                  <ModalCloseButton />
                </Box>
              </Center>
            </ModalBody>
          </ModalContent>
        </Modal>
      
    </Box>
    
  )
  else if (post.rpan_video) return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      
      <Box onClick={onOpen} >

        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' bottom='0' h='100%' color='white' width='100%' p={2} >
            <Center h='100%' ><Text isTruncated fontSize='xs' bg='rgb(33,33,33,0.3)' background='black' p={5}>Live Video</Text></Center>
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
            <Link href={post.url} isExternal>
              {post.title}
            </Link>
          </Box>
        </Box>

        <Modal onClose={onClose} isOpen={isOpen} isCentered >
          <ModalOverlay />
          <ModalContent maxW='container.xl' maxH='100vh'>
            <ModalCloseButton />
            <ModalBody p={0}>
              <Center>
                <Image src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} w='100%' objectFit='contain' maxH='75vh' minW='50%'/>
              </Center>
            </ModalBody>
          </ModalContent>
        </Modal>
      </Box>
    </Box>
  )
  else return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      <Link href={post.url} isExternal>
        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' top='0' right='0' color='white' p={2} color='white' background='black' bg='rgb(33,33,33,0.5)' borderRadius='full' m={2}>
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
          <Link href={post.url} isExternal>
            {post.title}
          </Link>
        </Box>
      </Box>
    </Box>
    
  )
}
