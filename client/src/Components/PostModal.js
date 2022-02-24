import React from 'react';
import { Box, Stack, Link, Center, Button, Modal, ModalOverlay, ModalBody, ModalCloseButton, ModalFooter, Text, ModalHeader, ModalContent, Image, useDisclosure } from '@chakra-ui/react';
import { timeAgoShort } from '../Util/FormattedTime'
import { hotnessBGColor } from '../Util/HotnessBGColor';

export const PostModal = (props) => {
  const { isOpen, onOpen, onClose } = useDisclosure()
  const {post} = props

  return (
    <Box onClick={onOpen} >
      <Box position='relative'>
        <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover' position='relative'/>
        <Box position='absolute' bottom='0' color='white' background='black' width='100%' p={2} bg='rgb(33,33,33,0.3)'>
          <Text isTruncated fontSize='xs'>{post.url} </Text>
        </Box>
      </Box>
      

      {props.children}
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
  )
}