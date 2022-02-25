import { Box, Stack, Link, Center, Button, Modal, ModalOverlay, ModalBody, ModalCloseButton, ModalFooter, Text, ModalHeader, ModalContent, Image, useDisclosure } from '@chakra-ui/react';
import { timeAgoShort } from '../Util/FormattedTime'
import { hotnessBGColor } from '../Util/HotnessBGColor';

export const PostCard = ({post}) => {
  const { isOpen, onOpen, onClose } = useDisclosure()
  if (post.is_video) return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      
      <Box onClick={onOpen} >

        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' bottom='0' h='100%' color='white' width='100%' p={2} >
            <Center h='100%' ><Text isTruncated fontSize='xs' bg='rgb(33,33,33,0.3)' background='black' p={5}>Video</Text></Center>
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
              <Text href={'https://reddit.com/' + post.commentLink} color='link'>
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
            <Text href={post.url} >
              {post.title}
            </Text>
          </Box>
        </Box>

        <Modal onClose={onClose} isOpen={isOpen} isCentered >
          <ModalOverlay />
          <ModalContent maxW='container.xl' maxH='100vh' bg='none'>
            
            <ModalBody p={0}>
              <Center maxW='container.xl'>
                <Box position='relative'>
                  <Box
                    as='video'
                    controls
                    loop="true" autoplay="autoplay"
                    src={post.media.reddit_video.fallback_url}
                    poster={post.thumbnail}
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
          <Box position='absolute' bottom='0' color='white' background='black' width='100%' p={2} bg='rgb(33,33,33,0.3)'>
            <Text isTruncated fontSize='xs'>Gallery</Text>
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
              <Text href={'https://reddit.com/' + post.commentLink} color='link'>
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
            <Text href={post.url} >
              {post.title}
            </Text>
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
              
              <Box p={4} bg={hotnessBGColor(post.upvoteCount)}>
                <Box display='flex' alignItems='baseline'>
                  <Box
                    color='gray.500'
                    fontWeight='semibold'
                    letterSpacing='wide'
                    fontSize='xs'
                    textTransform='uppercase'
                  >
                    <Text href={'https://reddit.com/' + post.commentLink}  color='link'>
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
                  <Text href={post.url}>
                    {post.title}
                  </Text>
                </Box>
              </Box>

            </ModalBody>
            <ModalFooter >

              <Stack direction={['row']} spacing={5}>
                <Link href={'https://reddit.com/' + post.commentLink} isExternal color='link'>
                  <Button>Comments</Button>
                </Link>
                
                <Link href={post.url} isExternal>
                  <Button>Visit</Button> 
                </Link>
              </Stack>

            </ModalFooter>
          </ModalContent>
        </Modal>
      </Box>
    </Box>
    
  )
  else if (post.is_self && post.thumbnail === 'self') return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      
      <Box onClick={onOpen} >

        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' top='0' h='100%' color='white' background='black' width='100%' p={4} bg='rgb(33,33,33,0.8)'>
            <Text fontSize='sm' noOfLines={9} > {post.selftext}  </Text>
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
              <Text href={'https://reddit.com/' + post.commentLink} color='link'>
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
            <Text href={post.url} >
              {post.title}
            </Text>
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
              
              <Box p={4} bg={hotnessBGColor(post.upvoteCount)}>
                <Box display='flex' alignItems='baseline'>
                  <Box
                    color='gray.500'
                    fontWeight='semibold'
                    letterSpacing='wide'
                    fontSize='xs'
                    textTransform='uppercase'
                  >
                    <Text href={'https://reddit.com/' + post.commentLink}  color='link'>
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
                  <Text href={post.url}>
                    {post.title}
                  </Text>
                </Box>
              </Box>

            </ModalBody>
            <ModalFooter >

              <Stack direction={['row']} spacing={5}>
                <Link href={'https://reddit.com/' + post.commentLink} isExternal color='link'>
                  <Button>Comments</Button>
                </Link>
                
                <Link href={post.url} isExternal>
                  <Button>Visit</Button> 
                </Link>
              </Stack>

            </ModalFooter>
          </ModalContent>
        </Modal>
      </Box>
    </Box>
    
  )
  else if (post.is_self) return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      
      <Box onClick={onOpen} >

        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' bottom='0' color='white' background='black' width='100%' p={2} bg='rgb(33,33,33,0.3)'>
            <Text isTruncated fontSize='xs'> Text with Image </Text>
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
              <Text href={'https://reddit.com/' + post.commentLink} color='link'>
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
            <Text href={post.url} >
              {post.title}
            </Text>
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
              
              <Box p={4} bg={hotnessBGColor(post.upvoteCount)}>
                <Box display='flex' alignItems='baseline'>
                  <Box
                    color='gray.500'
                    fontWeight='semibold'
                    letterSpacing='wide'
                    fontSize='xs'
                    textTransform='uppercase'
                  >
                    <Text href={'https://reddit.com/' + post.commentLink}  color='link'>
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
                  <Text href={post.url}>
                    {post.title}
                  </Text>
                </Box>
              </Box>

            </ModalBody>
            <ModalFooter >

              <Stack direction={['row']} spacing={5}>
                <Link href={'https://reddit.com/' + post.commentLink} isExternal color='link'>
                  <Button>Comments</Button>
                </Link>
                
                <Link href={post.url} isExternal>
                  <Button>Visit</Button> 
                </Link>
              </Stack>

            </ModalFooter>
          </ModalContent>
        </Modal>
      </Box>
    </Box>
    
  )
  else if (post.post_hint === 'link') return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      <Link href={post.url} isExternal>
        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' bottom='0' color='white' background='black' width='100%' p={2} bg='rgb(33,33,33,0.3)'>
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
            <Link href={'https://reddit.com/' + post.commentLink} color='link' isExternal>
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
              <Link href={'https://reddit.com/' + post.commentLink} color='link' external>
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
            <Link onClick={onOpen} external>
              {post.title}
            </Link>
          </Box>
        </Box>
        
        <Modal onClose={onClose} isOpen={isOpen} isCentered >
          <ModalOverlay />
          <ModalContent maxW='container.xl' maxH='100vh' bg='none'>
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
  else if (post.rpan_video) return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      
      <Box onClick={onOpen} >

        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' bottom='0' h='100%' color='white' width='100%' p={2} >
            <Center h='100%' ><Text isTruncated fontSize='xs' bg='rgb(33,33,33,0.3)' background='black' p={5}>LIVE FEED</Text></Center>
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
              <Text href={'https://reddit.com/' + post.commentLink} color='link'>
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
            <Text href={post.url} >
              {post.title}
            </Text>
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
              
              <Box p={4} bg={hotnessBGColor(post.upvoteCount)}>
                <Box display='flex' alignItems='baseline'>
                  <Box
                    color='gray.500'
                    fontWeight='semibold'
                    letterSpacing='wide'
                    fontSize='xs'
                    textTransform='uppercase'
                  >
                    <Text href={'https://reddit.com/' + post.commentLink}  color='link'>
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
                  <Text href={post.url}>
                    {post.title}
                  </Text>
                </Box>
              </Box>

            </ModalBody>
            <ModalFooter >

              <Stack direction={['row']} spacing={5}>
                <Link href={'https://reddit.com/' + post.commentLink} isExternal color='link'>
                  <Button>Comments</Button>
                </Link>
                
                <Link href={post.url} isExternal>
                  <Button>Visit</Button> 
                </Link>
              </Stack>

            </ModalFooter>
          </ModalContent>
        </Modal>
      </Box>
    </Box>
  )
  else return (
    <Box borderWidth='1px' borderRadius='lg' overflow='hidden' bg={hotnessBGColor(post.upvoteCount)}>
      
      <Box onClick={onOpen} >

        <Box position='relative'>
          <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
          <Box position='absolute' bottom='0' color='white' background='black' width='100%' p={2} bg='rgb(33,33,33,0.3)'>
            <Text isTruncated fontSize='xs'> Live video </Text>
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
              <Text href={'https://reddit.com/' + post.commentLink} color='link'>
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
            <Text href={post.url} >
              {post.title}
            </Text>
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
              
              <Box p={4} bg={hotnessBGColor(post.upvoteCount)}>
                <Box display='flex' alignItems='baseline'>
                  <Box
                    color='gray.500'
                    fontWeight='semibold'
                    letterSpacing='wide'
                    fontSize='xs'
                    textTransform='uppercase'
                  >
                    <Text href={'https://reddit.com/' + post.commentLink}  color='link'>
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
                  <Text href={post.url}>
                    {post.title}
                  </Text>
                </Box>
              </Box>

            </ModalBody>
            <ModalFooter >

              <Stack direction={['row']} spacing={5}>
                <Link href={'https://reddit.com/' + post.commentLink} isExternal color='link'>
                  <Button>Comments</Button>
                </Link>
                
                <Link href={post.url} isExternal>
                  <Button>Visit</Button> 
                </Link>
              </Stack>

            </ModalFooter>
          </ModalContent>
        </Modal>
      </Box>
    </Box>
    
  )
}
