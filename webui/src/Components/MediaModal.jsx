import { Box, Center, Modal, ModalOverlay, ModalBody, ModalCloseButton,  ModalContent, Image, Stack } from '@chakra-ui/react';
import ReactPlayer from 'react-player'
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

export const MediaModal = () => {
  const {modalData, setModalData} = useContext(ModalContext)
  const videoUrl = getVideoUrl(modalData);

  return (
    <>
      {modalData && modalData.is_video && videoUrl?
        <Modal onClose={(e)=>{setModalData(null)}} isOpen={true} isCentered blockScrollOnMount={false}>
          <ModalOverlay />
          <ModalContent maxW='container.xl' maxH='80vh' bg='none' w='auto'>
            <ModalBody p={0}>
              <Center >
                <Box position='relative' width='100%' height='80vh' bg='#222'>
                <ReactPlayer src={videoUrl} width='100%' height='100%' controls playing/>
                  
                  <ModalCloseButton />
                </Box>
              </Center>
            </ModalBody>
          </ModalContent>
        </Modal>

      :
      null
    }

    {modalData && modalData.is_gallery ?
      <Modal onClose={(e)=>{setModalData(null)}} isOpen={true} isCentered >
        <ModalOverlay />
        <ModalContent maxW='container.xl' bg='none' w='auto' >
          <ModalBody p={0}>
            <Center maxW='container.xl' position='relative' overflow='hidden'>
              <Stack overflowY='scroll' maxH='80vh' >
                {Object.keys(modalData.media_metadata || {}).filter(key => typeof modalData.media_metadata[key]?.s?.u === 'string').map((key) =>{
                  return (
                    <Image key={key} src={modalData.media_metadata[key].s.u.replace(/amp;/g,'')} w='100%' objectFit='cover' maxH='75vh' minW='50%'/>
                  )
                })}
              </Stack>
              <ModalCloseButton color='white' mr={4}/>
            </Center>
          </ModalBody>
        </ModalContent>
      </Modal>

      :
      null
    }

    {modalData && modalData.post_hint === 'image'?
        <Modal onClose={(e)=>{setModalData(null)}} isOpen={true} isCentered blockScrollOnMount={false}>
          <ModalOverlay />
          <ModalContent maxW='container.xl' maxH='100vh' bg='none' w='auto'>
            <ModalBody p={0} >
              <Center maxW='container.xl'>
                <Box position='relative'>
                  <Image src={getThumbnailSrc(modalData.thumbnail)} objectFit='contain' maxH='90vh' minW='50%'/>
                  <ModalCloseButton />
                </Box>
              </Center>
            </ModalBody>
          </ModalContent>
        </Modal>

      :
      null
    }

    {modalData && !modalData.is_video && modalData.rpan_video && videoUrl?
      <Modal onClose={(e)=>{setModalData(null)}} isOpen={true} isCentered blockScrollOnMount={false}>
        <ModalOverlay />
        <ModalContent maxW='container.xl' maxH='80vh' bg='none' w='auto'>
        <ModalBody p={0}>
            <Center >
              <Box position='relative' width='100%' height='80vh' bg='#222'>
                <ReactPlayer src={videoUrl} width='100%' height='100%' controls playing/>
                
                <ModalCloseButton />
              </Box>
            </Center>
          </ModalBody>
        </ModalContent>
      </Modal>

    :
    null
  }
  </>
  )


}
