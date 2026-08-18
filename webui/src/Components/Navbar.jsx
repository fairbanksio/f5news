import { useContext, useEffect, useRef, useState } from 'react';
import {
  Box,
  Flex,
  Button,
  Stack,
  Container,
  Text,
  useBreakpointValue,
  IconButton,
  Progress,
  Image,
} from '@chakra-ui/react';
import { FaChevronDown, FaCog, FaRedoAlt } from 'react-icons/fa';
import { RefreshIntervalContext } from '../Contexts/RefreshIntervalContext'
import { SubredditContext } from '../Contexts/SubredditContext'
import { LoadingContext } from '../Contexts/LoadingContext'
import { useColorModeValue } from '../Contexts/ColorModeContext';
import { ColorModeSwitcher, ColorModeSwitcherMenuItem } from './ColorModeSwitcher';
import { ViewModeSwitcher, ViewModeSwitcherMenuItem } from './ViewModeSwitcher';
import { SupportButton, SupportMenuItem } from './SupportLink';

const PrimaryLogo = () => {
  return (
    <>
      <Text textStyle='brand' aria-hidden='true'>&#128293;</Text>
    </>
  )
}

const SecondaryLogo = () => {
  return (
    <Image src='/usa.svg' objectFit='scale-down' h='30px' w='30px'/>
  )
}

const LoadingProgress = ({ loading }) => (
  <Progress.Root value={loading ? null : 0} size="xs" style={{ height: '4px' }}>
    <Progress.Track style={{ height: '4px' }}>
      <Progress.Range />
    </Progress.Track>
  </Progress.Root>
);

const MenuSurface = ({ children, align = 'left', maxW }) => (
  <Box
    role="menu"
    position="absolute"
    top="calc(100% + 6px)"
    left={align === 'left' ? 0 : 'auto'}
    right={align === 'right' ? 0 : 'auto'}
    bg="navbar"
    color="textPrimary"
    borderWidth="1px"
    borderColor={{ _light: 'gray.200', _dark: 'gray.700' }}
    borderRadius="md"
    boxShadow="lg"
    minW="100%"
    w="max-content"
    maxW={maxW}
    maxH="70vh"
    overflowY="auto"
    opacity={1}
    zIndex={20}
    py={1}
  >
    {children}
  </Box>
);

const MenuItemButton = ({ children, onClick, maxW }) => (
  <Box
    as="button"
    type="button"
    role="menuitem"
    display="flex"
    alignItems="center"
    justifyContent="flex-start"
    w="100%"
    maxW={maxW}
    px={3}
    py={0}
    borderRadius={0}
    color="textPrimary"
    bg="transparent"
    textAlign="left"
    style={{
      height: '27px',
      minHeight: '27px',
      paddingBottom: 0,
      paddingTop: 0,
    }}
    _hover={{ bg: { _light: 'gray.100', _dark: 'whiteAlpha.200' } }}
    onClick={onClick}
  >
    {children}
  </Box>
);

const MenuSeparator = () => (
  <Box borderTopWidth="1px" borderColor={{ _light: 'gray.200', _dark: 'gray.700' }} my={1} />
);

const MenuLabel = ({ children }) => (
  <Text px={3} py={1} textStyle="meta" color="textMuted">
    {children}
  </Text>
);

export const getRefreshIntervalMenuValue = refreshInterval => String(refreshInterval);

export default function Nav() {
  const { refreshInterval, setRefreshInterval } = useContext(RefreshIntervalContext)
  const { subreddit, setSubreddit, subredditList } = useContext(SubredditContext)
  const { loading } = useContext(LoadingContext)
  const [logo, setLogo] = useState(true)
  const [openMenu, setOpenMenu] = useState(null)
  const controlsRef = useRef(null)
  const mobileMode = useBreakpointValue({base: true, sm: true, md: false}, { ssr: false })
  const maxMenuWidth = useBreakpointValue({base: '50vw', sm: '50vw', md: '40vw', lg: '30vw'}, { ssr: false })
  const maxW = useBreakpointValue({base: 'container.xl', sm: 'container.xl', md: 'container.xl', xl: 'container.xl', '2xl': '1600px'}, { ssr: false })
  const controlBg = useColorModeValue('#EDF2F7', 'rgba(255, 255, 255, 0.08)');
  const controlColor = useColorModeValue('#333', '#A0AEC0');
  const controlBorderColor = useColorModeValue('#E2E8F0', 'rgba(255, 255, 255, 0.16)');
  const controlButtonProps = {
    h: '32px',
    minH: '32px',
    minW: '32px',
    px: 3,
    borderRadius: 'md',
    borderWidth: '1px',
    style: {
      backgroundColor: controlBg,
      borderColor: controlBorderColor,
      borderRadius: '6px',
      color: controlColor,
      height: '32px',
      minHeight: '32px',
      padding: '0 12px',
    },
    _hover: {
      bg: useColorModeValue('gray.200', 'whiteAlpha.300'),
    },
  };
  const refreshIntervalMenuValue = getRefreshIntervalMenuValue(refreshInterval);
  const toggleMenu = menu => setOpenMenu(current => (current === menu ? null : menu));
  const closeMenu = () => setOpenMenu(null);

  useEffect(() => {
    const closeOnOutsideClick = event => {
      if (!controlsRef.current?.contains(event.target)) {
        closeMenu();
      }
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  return (

    <Box position='fixed' width={'100%'} bg='navbar' style={{zIndex:'1'}}>
      
      <Container maxW={maxW} pr={mobileMode?0:4} pl={mobileMode?0:4} >
      
        <Flex h={12} alignItems={'center'} justifyContent={'space-between'} pr={mobileMode?2:0} pl={mobileMode?2:0} >

          <Box
            maxH='40px'
            onClick={(e)=>{setLogo(!logo)}}
            role='button'
            tabIndex={0}
            aria-label='Toggle F5 News logo'
            onKeyDown={(e)=>{if (e.key === 'Enter' || e.key === ' ') { setLogo(!logo); }}}
          >
            <Stack direction={['row']}>
              {logo? <PrimaryLogo/> : <SecondaryLogo/>}
              <Text color='textPrimary' textStyle='brand' ml='2'>F5 News</Text>
            </Stack>
          </Box>
          
          <Flex alignItems={'center'} ref={controlsRef}>
            <Stack direction={'row'} spacing={2}>

              <Box position="relative">
                <Button
                  size={'sm'}
                  maxW={maxMenuWidth}
                  aria-haspopup="menu"
                  aria-expanded={openMenu === 'subreddit'}
                  onClick={() => toggleMenu('subreddit')}
                  {...controlButtonProps}
                >
                  <Text truncate textStyle='control'>r/{subreddit}</Text>
                  <FaChevronDown />
                </Button>
                {openMenu === 'subreddit' && (
                  <MenuSurface maxW={maxMenuWidth}>
                  {subredditList.map((subreddit, key) => {
                    return(
                      <MenuItemButton key={key} onClick={(e)=>{setSubreddit(subreddit); window.scrollTo(0, 0); closeMenu();}} maxW={maxMenuWidth}>
                        <Text truncate textStyle='control' title={subreddit}>{subreddit}</Text>
                      </MenuItemButton>
                    )
                  })}
                  </MenuSurface>
                )}
              </Box>

              { mobileMode ?
                <Box position="relative">
                  <IconButton
                    size={'sm'}
                    aria-label='Open display settings'
                    aria-haspopup="menu"
                    aria-expanded={openMenu === 'settings'}
                    onClick={() => toggleMenu('settings')}
                    {...controlButtonProps}
                  >
                    <FaCog />
                  </IconButton>
                  {openMenu === 'settings' && (
                    <MenuSurface align="right">
                      <MenuLabel>Interval</MenuLabel>
                      <MenuItemButton onClick={(e)=>{setRefreshInterval(30); closeMenu();}}>
                        <Text textStyle="control">{refreshIntervalMenuValue === '30' ? '✓ ' : ''}30s</Text>
                      </MenuItemButton>
                      <MenuItemButton onClick={(e)=>{setRefreshInterval(60); closeMenu();}}>
                        <Text textStyle="control">{refreshIntervalMenuValue === '60' ? '✓ ' : ''}1m</Text>
                      </MenuItemButton>
                      <MenuItemButton onClick={(e)=>{setRefreshInterval(120); closeMenu();}}>
                        <Text textStyle="control">{refreshIntervalMenuValue === '120' ? '✓ ' : ''}2m</Text>
                      </MenuItemButton>
                      <MenuItemButton onClick={(e)=>{setRefreshInterval(600); closeMenu();}}>
                        <Text textStyle="control">{refreshIntervalMenuValue === '600' ? '✓ ' : ''}5m</Text>
                      </MenuItemButton>
                      <MenuSeparator />
                      <ViewModeSwitcherMenuItem onSelect={closeMenu}/>
                      <MenuSeparator />
                      <ColorModeSwitcherMenuItem onSelect={closeMenu}/>
                      <MenuSeparator />
                      <SupportMenuItem onSelect={closeMenu}/>
                    </MenuSurface>
                  )}
                </Box>
              :
                <>
                  <Box position="relative">
                    <Button
                      size={'sm'}
                      aria-haspopup="menu"
                      aria-expanded={openMenu === 'refresh'}
                      onClick={() => toggleMenu('refresh')}
                      {...controlButtonProps}
                    >
                      <Text as='span' textStyle='control'>{refreshInterval}s</Text>
                      <FaRedoAlt />
                    </Button>
                    {openMenu === 'refresh' && (
                      <MenuSurface align="right">
                        <MenuItemButton onClick={(e)=>{setRefreshInterval(30); closeMenu();}}>30s</MenuItemButton>
                        <MenuItemButton onClick={(e)=>{setRefreshInterval(60); closeMenu();}}>1m</MenuItemButton>
                        <MenuItemButton onClick={(e)=>{setRefreshInterval(120); closeMenu();}}>2m</MenuItemButton>
                        <MenuItemButton onClick={(e)=>{setRefreshInterval(600); closeMenu();}}>5m</MenuItemButton>
                      </MenuSurface>
                    )}
                  </Box>

                  <ViewModeSwitcher />
                    
                  <ColorModeSwitcher />

                  <SupportButton />
                  
                </>
              }
              
            </Stack>
            
          </Flex>
          

        </Flex>
        <LoadingProgress loading={loading} />
      </Container>
    </Box>

  );
}
