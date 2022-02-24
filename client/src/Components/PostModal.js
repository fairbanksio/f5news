import React from 'react';
import { Box, Stack, Link, Center, Button, Modal, ModalOverlay, ModalBody, ModalCloseButton, ModalFooter, ModalHeader, ModalContent, Image, useDisclosure } from '@chakra-ui/react';

export const PostModal = (props) => {
  const { isOpen, onOpen, onClose } = useDisclosure()
  const {post} = props

  return (
    <Box onClick={onOpen}>
      <Image  src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} boxSize='100%' h='225px' objectFit='cover'/>
      {props.children}
      <Modal onClose={onClose} isOpen={isOpen} isCentered >
        <ModalOverlay />
        <ModalContent maxW='container.xl' maxH='100vh'>
          <ModalHeader>{post.title}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Center>
            <Image src={post.thumbnail === 'default' || post.thumbnail === 'self' || post.thumbnail === 'spoiler'? './placeholder.png' : post.thumbnail} objectFit='contain' maxH='75vh' minW='50%'/>
            </Center>
            

          </ModalBody>
          <ModalFooter>
          <Stack direction={['column', 'row']} spacing='24px'>
            <Link href={'https://reddit.com/' + post.commentLink} isExternal color='link'>
              <Button>View {post.commentCount} comments</Button>
            </Link>
            
            <Link href={post.url} isExternal>
            <Button>Visit{post.domain}</Button> 
          </Link>
          </Stack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  )
}