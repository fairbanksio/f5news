import { Box, Button, Center, Dialog, Image, Portal, Stack } from '@chakra-ui/react';
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

export const MediaModal = () => {
  const {modalData, setModalData} = useContext(ModalContext)
  const closeModal = () => setModalData(null);

  const ModalFrame = ({ children, maxH = '80vh' }) => (
    <Dialog.Root open onOpenChange={(details) => { if (!details.open) closeModal(); }}>
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.700" />
        <Dialog.Positioner>
          <Dialog.Content maxW='container.xl' maxH={maxH} bg='transparent' boxShadow="none" w='auto'>
            <Dialog.Body p={0}>
              {children}
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );

  const CloseButton = props => (
    <Button
      position="absolute"
      top={2}
      right={2}
      aria-label="Close"
      onClick={closeModal}
      {...props}
    >
      x
    </Button>
  );

  return (
    <>
    {modalData && modalData.is_gallery ?
      <ModalFrame>
        <Center maxW='container.xl' position='relative' overflow='hidden'>
          <Stack overflowY='scroll' maxH='80vh' >
            {Object.keys(modalData.media_metadata).map((key) =>{
              return (
                <Image key={key} src={modalData.media_metadata[key].s.u.replace(/amp;/g,'')} w='100%' objectFit='cover' maxH='75vh' minW='50%'/>
              )
            })}
          </Stack>
          <CloseButton color='white' mr={4}/>
        </Center>
      </ModalFrame>

      :
      null
    }

    {modalData && modalData.post_hint === 'image'?
        <ModalFrame maxH="100vh">
          <Center maxW='container.xl'>
            <Box position='relative'>
              <Image src={getThumbnailSrc(modalData.thumbnail)} objectFit='contain' maxH='90vh' minW='50%'/>
              <CloseButton />
            </Box>
          </Center>
        </ModalFrame>

      :
      null
    }
  </>
  )


}
