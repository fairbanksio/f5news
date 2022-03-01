import { Box, Center, Modal, ModalOverlay, ModalBody, ModalCloseButton,  ModalContent, Image, Stack } from '@chakra-ui/react';
import ReactPlayer from 'react-player'
import {ModalContext} from '../Contexts/ModalContext'
import {useContext} from 'react'

export const MediaModal = () => {
  const {modalData, setModalData} = useContext(ModalContext)

  const htmlDecode = (content) => {
    let e = document.createElement('div');
    e.innerHTML = content;
    return e.childNodes.length === 0 ? "" : e.childNodes[0].nodeValue;
  }
  return (
    <>
      {modalData && modalData.is_video?
        <Modal onClose={(e)=>{setModalData(null)}} isOpen={true} isCentered blockScrollOnMount={false}>
          <ModalOverlay />
          <ModalContent maxW='container.xl' maxH='80vh' bg='none' w='auto'>
            <ModalBody p={0}>
              <Center >
                <Box position='relative' width='100%' height='80vh' bg='#222'>
                  <ReactPlayer url={modalData.media.reddit_video.dash_url} width='100%' height='100%' controls stopOnUnmount={false} playing/>
                  
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
                {Object.keys(modalData.media_metadata).map((key) =>{
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
                  <Image src={modalData.thumbnail === 'default' || modalData.thumbnail === 'self' || modalData.thumbnail === 'spoiler'? './placeholder.png' : modalData.thumbnail}  objectFit='contain' maxH='90vh' minW='50%'/>
                  <ModalCloseButton />
                </Box>
              </Center>
            </ModalBody>
          </ModalContent>
        </Modal>

      :
      null
    }

    {modalData && modalData.post_hint === 'rich:video' ?
        <Modal onClose={(e)=>{setModalData(null)}} isOpen={true} isCentered blockScrollOnMount={false}>
          <ModalOverlay />
          <ModalContent maxW='container.xl' maxH='100vh' bg='none' w='auto'>
            <ModalBody p={0} >
              <Center maxW='container.xl'>
                <Box position='relative'>
                  <Box dangerouslySetInnerHTML={{__html: htmlDecode(modalData.media.oembed.html)}} w='100%'/>
                  <ModalCloseButton />
                </Box>
              </Center>
            </ModalBody>
          </ModalContent>
        </Modal>

      :
      null
    }

    {modalData &&  modalData.rpan_video?
      <Modal onClose={(e)=>{setModalData(null)}} isOpen={true} isCentered blockScrollOnMount={false}>
        <ModalOverlay />
        <ModalContent maxW='container.xl' maxH='80vh' bg='none' w='auto'>
        <ModalBody p={0}>
            <Center >
              <Box position='relative' width='100%' height='80vh' bg='#222'>
                <ReactPlayer url={modalData.rpan_video.hls_url} width='100%' height='100%' controls stopOnUnmount={false} playing/>
                
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
