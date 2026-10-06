import { Box, Center, IconButton, Dialog, Image, Portal, Stack } from '@chakra-ui/react';
import ReactPlayer from 'react-player'
import { CloseIcon } from './LegacyIcons';
import { useColorModeValue } from '../Contexts/ColorModeContext';
import { getVideoUrl } from '../media';
import {ModalContext} from '../Contexts/ModalContext'
import {useContext} from 'react'

const getThumbnailSrc = (thumbnail) => {
  if (
    typeof thumbnail !== 'string' ||
    thumbnail.trim() === '' ||
    ['default', 'self', 'spoiler', 'nsfw'].includes(thumbnail)
  ) {
    return '/placeholder.png';
  }

  return thumbnail;
};

const ModalFrame = ({ children, onClose, maxH = '80vh', preventScroll = false }) => (
    <Dialog.Root open placement='center' preventScroll={preventScroll} onOpenChange={({ open }) => { if (!open) onClose(); }}>
      <Portal>
        <Dialog.Backdrop bg='blackAlpha.600' />
        <Dialog.Positioner>
          <Dialog.Content maxW='container.xl' maxH={maxH} bg='transparent' w='auto' borderRadius='md' color='inherit' boxShadow={{ _light: 'lg', _dark: 'dark-lg' }} aria-label='Media Preview'>
            <Dialog.Body p={0}>{children}</Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );

const ModalCloseButton = ({ onClose, ...props }) => {
  const closeHoverBg = useColorModeValue('blackAlpha.100', 'whiteAlpha.100');
  const closeActiveBg = useColorModeValue('blackAlpha.200', 'whiteAlpha.200');
  return (
    <IconButton position='absolute' top={2} right={3} h={8} w={8} minW={8} p={0} fontSize='xs' color='inherit' variant='ghost' _hover={{ bg: closeHoverBg }} _active={{ bg: closeActiveBg }} aria-label='Close' onClick={onClose} {...props}><CloseIcon boxSize='1em' /></IconButton>
  );
};

export const MediaModal = () => {
  const {modalData, setModalData} = useContext(ModalContext)
  const videoUrl = getVideoUrl(modalData);
  const closeModal = () => setModalData(null);


  return (
    <>
      {modalData && modalData.is_video && videoUrl?
        <ModalFrame onClose={closeModal}>
              <Center >
                <Box position='relative' width='100%' height='80vh' bg='#222'>
                <ReactPlayer src={videoUrl} width='100%' height='100%' controls playing/>
                  
                  <ModalCloseButton onClose={closeModal} />
                </Box>
              </Center>
            </ModalFrame>

      :
      null
    }

    {modalData && modalData.is_gallery ?
      <ModalFrame onClose={closeModal} preventScroll>
            <Center maxW='container.xl' position='relative' overflow='hidden'>
              <Stack overflowY='scroll' maxH='80vh' gap={2} >
                {Object.keys(modalData.media_metadata || {}).filter(key => typeof modalData.media_metadata[key]?.s?.u === 'string').map((key) =>{
                  return (
                    <Image key={key} src={modalData.media_metadata[key].s.u.replace(/amp;/g,'')} w='100%' objectFit='cover' maxH='75vh' minW='50%'/>
                  )
                })}
              </Stack>
              <ModalCloseButton onClose={closeModal} color='white' mr={4}/>
            </Center>
          </ModalFrame>

      :
      null
    }

    {modalData && modalData.post_hint === 'image'?
        <ModalFrame onClose={closeModal} maxH='100vh'>
              <Center maxW='container.xl'>
                <Box position='relative'>
                  <Image src={getThumbnailSrc(modalData.thumbnail)} objectFit='contain' maxH='90vh' minW='50%'/>
                  <ModalCloseButton onClose={closeModal} />
                </Box>
              </Center>
            </ModalFrame>

      :
      null
    }

    {modalData && !modalData.is_video && modalData.rpan_video && videoUrl?
      <ModalFrame onClose={closeModal}>
            <Center >
              <Box position='relative' width='100%' height='80vh' bg='#222'>
                <ReactPlayer src={videoUrl} width='100%' height='100%' controls playing/>
                
                <ModalCloseButton onClose={closeModal} />
              </Box>
            </Center>
          </ModalFrame>

    :
    null
  }
  </>
  )


}
