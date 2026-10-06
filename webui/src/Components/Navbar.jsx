import { useContext, useState } from 'react';
import {
  Box,
  Flex,
  Button,
  Menu,
  Stack,
  Container,
  Text,
  useBreakpointValue,
  IconButton,
  Progress,
  Image,
  Portal,
  createIcon,
} from '@chakra-ui/react';
import Tooltip from './Tooltip';
import { RefreshIntervalContext } from '../Contexts/RefreshIntervalContext'
import { SubredditContext } from '../Contexts/SubredditContext'
import { LoadingContext } from '../Contexts/LoadingContext'
import { ColorModeSwitcher, ColorModeSwitcherMenuItem } from './ColorModeSwitcher';
import { ViewModeSwitcher, ViewModeSwitcherMenuItem } from './ViewModeSwitcher';
import { SupportButton, SupportMenuItem } from './SupportLink';

const ChevronDownIcon = createIcon({
  displayName: "ChevronDownIcon",
  d: "M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"
});
const RepeatIcon = createIcon({ displayName: "RepeatIcon", path: <g fill="currentColor"><path d="M10.319,4.936a7.239,7.239,0,0,1,7.1,2.252,1.25,1.25,0,1,0,1.872-1.657A9.737,9.737,0,0,0,9.743,2.5,10.269,10.269,0,0,0,2.378,9.61a.249.249,0,0,1-.271.178l-1.033-.13A.491.491,0,0,0,.6,9.877a.5.5,0,0,0-.019.526l2.476,4.342a.5.5,0,0,0,.373.248.43.43,0,0,0,.062,0,.5.5,0,0,0,.359-.152l3.477-3.593a.5.5,0,0,0-.3-.844L5.15,10.172a.25.25,0,0,1-.2-.333A7.7,7.7,0,0,1,10.319,4.936Z" /><path d="M23.406,14.1a.5.5,0,0,0,.015-.526l-2.5-4.329A.5.5,0,0,0,20.546,9a.489.489,0,0,0-.421.151l-3.456,3.614a.5.5,0,0,0,.3.842l1.848.221a.249.249,0,0,1,.183.117.253.253,0,0,1,.023.216,7.688,7.688,0,0,1-5.369,4.9,7.243,7.243,0,0,1-7.1-2.253,1.25,1.25,0,1,0-1.872,1.656,9.74,9.74,0,0,0,9.549,3.03,10.261,10.261,0,0,0,7.369-7.12.251.251,0,0,1,.27-.179l1.058.127a.422.422,0,0,0,.06,0A.5.5,0,0,0,23.406,14.1Z" /></g> });
const SettingsIcon = createIcon({
  viewBox: "0 0 14 14",
  d: "M14,7.77 L14,6.17 L12.06,5.53 L11.61,4.44 L12.49,2.6 L11.36,1.47 L9.55,2.38 L8.46,1.93 L7.77,0.01 L6.17,0.01 L5.54,1.95 L4.43,2.4 L2.59,1.52 L1.46,2.65 L2.37,4.46 L1.92,5.55 L0,6.23 L0,7.82 L1.94,8.46 L2.39,9.55 L1.51,11.39 L2.64,12.52 L4.45,11.61 L5.54,12.06 L6.23,13.98 L7.82,13.98 L8.45,12.04 L9.56,11.59 L11.4,12.47 L12.53,11.34 L11.61,9.53 L12.08,8.44 L14,7.75 L14,7.77 Z M7,10 C5.34,10 4,8.66 4,7 C4,5.34 5.34,4 7,4 C8.66,4 10,5.34 10,7 C10,8.66 8.66,10 7,10 Z",
  displayName: "SettingsIcon"
});

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

export const getRefreshIntervalMenuValue = refreshInterval => String(refreshInterval);

export default function Nav() {
  const { refreshInterval, setRefreshInterval } = useContext(RefreshIntervalContext)
  const { subreddit, setSubreddit, subredditList } = useContext(SubredditContext)
  const { loading } = useContext(LoadingContext)
  const [logo, setLogo] = useState(true)
  const mobileMode = useBreakpointValue({base: true, sm: true, md: false})
  const maxMenuWidth = useBreakpointValue({base: '50vw', sm: '50vw', md: '40vw', lg: '30vw'})
  const maxW = useBreakpointValue({base: '1280px', sm: '1280px', md: '1280px', xl: '1280px', '2xl': '1600px'})
  const refreshIntervalMenuValue = getRefreshIntervalMenuValue(refreshInterval);
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
            onKeyDown={(e)=>{if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLogo(!logo); }}}
          >
            <Stack direction={['row']} gap={2}>
              {logo? <PrimaryLogo/> : <SecondaryLogo/>}
              <Text color='textPrimary' textStyle='brand' ml='2'>F5 News</Text>
            </Stack>
          </Box>
          
          <Flex alignItems={'center'} >
            <Stack direction={'row'} gap={2}>

              <Menu.Root positioning={{ placement: "bottom-start", gutter: 8 }}>
                <Menu.Trigger asChild><Button size='sm' maxW={maxMenuWidth}>
                  <Text truncate textStyle='control'>r/{subreddit}</Text><ChevronDownIcon boxSize='1em' ml={2} />
                </Button></Menu.Trigger>
                <Portal><Menu.Positioner><Menu.Content>
                  {subredditList.map((subreddit, key) => {
                    return(
                      <Menu.Item value={subreddit} key={key} onClick={(e)=>{setSubreddit(subreddit); window.scrollTo(0, 0)}} maxW={maxMenuWidth}>
                        <Tooltip label={subreddit}>
                          <Text truncate textStyle='control'>{subreddit}</Text>
                        </Tooltip>
                      </Menu.Item>
                    )
                  })}
                </Menu.Content></Menu.Positioner></Portal>
              </Menu.Root>

              { mobileMode ?
                <Menu.Root positioning={{ placement: "bottom-start", gutter: 8 }}>
                  <Menu.Trigger asChild><IconButton size='sm' px={0} aria-label='Open display settings'><SettingsIcon boxSize='1em' /></IconButton></Menu.Trigger>
                  <Portal><Menu.Positioner><Menu.Content>

                    <Menu.RadioItemGroup value={refreshIntervalMenuValue} onValueChange={({value}) => setRefreshInterval(Number(value))}><Menu.ItemGroupLabel>Interval</Menu.ItemGroupLabel>
                      <Menu.RadioItem gap={0} value='30'><Box as="span" display="inline-flex" alignItems="center" justifyContent="center" flexShrink={0} fontSize="0.8em" w="1em" mr="0.75rem"><Menu.ItemIndicator position="static" transform="none"><svg viewBox="0 0 14 14" width="1em" height="1em"><polygon fill="currentColor" points="5.5 11.9993304 14 3.49933039 12.5 2 5.5 8.99933039 1.5 4.9968652 0 6.49933039" /></svg></Menu.ItemIndicator></Box><Text>30s</Text></Menu.RadioItem>
                      <Menu.RadioItem gap={0} value='60'><Box as="span" display="inline-flex" alignItems="center" justifyContent="center" flexShrink={0} fontSize="0.8em" w="1em" mr="0.75rem"><Menu.ItemIndicator position="static" transform="none"><svg viewBox="0 0 14 14" width="1em" height="1em"><polygon fill="currentColor" points="5.5 11.9993304 14 3.49933039 12.5 2 5.5 8.99933039 1.5 4.9968652 0 6.49933039" /></svg></Menu.ItemIndicator></Box><Text>1m</Text></Menu.RadioItem>
                      <Menu.RadioItem gap={0} value='120'><Box as="span" display="inline-flex" alignItems="center" justifyContent="center" flexShrink={0} fontSize="0.8em" w="1em" mr="0.75rem"><Menu.ItemIndicator position="static" transform="none"><svg viewBox="0 0 14 14" width="1em" height="1em"><polygon fill="currentColor" points="5.5 11.9993304 14 3.49933039 12.5 2 5.5 8.99933039 1.5 4.9968652 0 6.49933039" /></svg></Menu.ItemIndicator></Box><Text>2m</Text></Menu.RadioItem>
                      <Menu.RadioItem gap={0} value='600'><Box as="span" display="inline-flex" alignItems="center" justifyContent="center" flexShrink={0} fontSize="0.8em" w="1em" mr="0.75rem"><Menu.ItemIndicator position="static" transform="none"><svg viewBox="0 0 14 14" width="1em" height="1em"><polygon fill="currentColor" points="5.5 11.9993304 14 3.49933039 12.5 2 5.5 8.99933039 1.5 4.9968652 0 6.49933039" /></svg></Menu.ItemIndicator></Box><Text>5m</Text></Menu.RadioItem>
                    </Menu.RadioItemGroup>

                    <Menu.Separator />


                    <ViewModeSwitcherMenuItem/>

                    <Menu.Separator />
                    
                    <ColorModeSwitcherMenuItem/>

                    <Menu.Separator />

                    <SupportMenuItem/>

                    
                      
                  </Menu.Content></Menu.Positioner></Portal>
                </Menu.Root>
              :
                <>
                  <Menu.Root positioning={{ placement: "bottom-start", gutter: 8 }}>

                    <Menu.Trigger asChild><Button size='sm'>
                      <Text as='span' textStyle='control'>{refreshInterval}s</Text><RepeatIcon boxSize='1em' ml={2} />
                    </Button></Menu.Trigger>

                    <Portal><Menu.Positioner><Menu.Content>
                      <Menu.Item value='30' onClick={() => setRefreshInterval(30)}>30s</Menu.Item>
                      <Menu.Item value='60' onClick={() => setRefreshInterval(60)}>1m</Menu.Item>
                      <Menu.Item value='120' onClick={() => setRefreshInterval(120)}>2m</Menu.Item>
                      <Menu.Item value='600' onClick={() => setRefreshInterval(600)}>5m</Menu.Item>
                    </Menu.Content></Menu.Positioner></Portal>
                    
                  </Menu.Root>

                  <ViewModeSwitcher />
                    
                  <ColorModeSwitcher />

                  <SupportButton />
                  
                </>
              }
              
            </Stack>
            
          </Flex>
          

        </Flex>
        <Progress.Root value={loading ? null : 0} h='4px'><Progress.Track h='4px' borderRadius={0}><Progress.Range /></Progress.Track></Progress.Root>
      </Container>
    </Box>

  );
}
