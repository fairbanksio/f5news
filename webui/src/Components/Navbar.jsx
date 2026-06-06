import { useContext, useState } from 'react';
import {
  Box,
  Flex,
  Button,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Stack,
  Container,
  Text,
  useBreakpointValue,
  IconButton,
  MenuOptionGroup,
  MenuItemOption,
  MenuDivider,
  Progress,
  Image,
  Tooltip
} from '@chakra-ui/react';
import { ChevronDownIcon, RepeatIcon, SettingsIcon } from '@chakra-ui/icons';
import { RefreshIntervalContext } from '../Contexts/RefreshIntervalContext'
import { SubredditContext } from '../Contexts/SubredditContext'
import { LoadingContext } from '../Contexts/LoadingContext'
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

export const getRefreshIntervalMenuValue = refreshInterval => String(refreshInterval);

export default function Nav() {
  const { refreshInterval, setRefreshInterval } = useContext(RefreshIntervalContext)
  const { subreddit, setSubreddit, subredditList } = useContext(SubredditContext)
  const { loading } = useContext(LoadingContext)
  const [logo, setLogo] = useState(true)
  const mobileMode = useBreakpointValue({base: true, sm: true, md: false})
  const maxMenuWidth = useBreakpointValue({base: '50vw', sm: '50vw', md: '40vw', lg: '30vw'})
  const maxW = useBreakpointValue({base: 'container.xl', sm: 'container.xl', md: 'container.xl', xl: 'container.xl', '2xl': '1600px'})
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
            onKeyDown={(e)=>{if (e.key === 'Enter' || e.key === ' ') { setLogo(!logo); }}}
          >
            <Stack direction={['row']}>
              {logo? <PrimaryLogo/> : <SecondaryLogo/>}
              <Text color='textPrimary' textStyle='brand' ml='2'>F5 News</Text>
            </Stack>
          </Box>
          
          <Flex alignItems={'center'} >
            <Stack direction={'row'} spacing={2}>

              <Menu>
                <MenuButton as={Button} size={'sm'} rightIcon={<ChevronDownIcon />} maxW={maxMenuWidth}>
                  <Text isTruncated textStyle='control'>r/{subreddit}</Text>
                </MenuButton>
                <MenuList>
                  {subredditList.map((subreddit, key) => {
                    return(
                      <MenuItem key={key} onClick={(e)=>{setSubreddit(subreddit); window.scrollTo(0, 0)}} maxW={maxMenuWidth}>
                        <Tooltip label={subreddit}>
                          <Text isTruncated textStyle='control'>{subreddit}</Text>
                        </Tooltip>
                      </MenuItem>
                    )
                  })}
                </MenuList>
              </Menu>

              { mobileMode ?
                <Menu>
                  <MenuButton as={IconButton} size={'sm'} icon={<SettingsIcon />} aria-label='Open display settings'/>
                  <MenuList>

                    <MenuOptionGroup defaultValue={refreshIntervalMenuValue} value={refreshIntervalMenuValue} title='Interval' type='radio'>
                      <MenuItemOption value='30' onClick={(e)=>{setRefreshInterval(30)}}>30s</MenuItemOption>
                      <MenuItemOption value='60' onClick={(e)=>{setRefreshInterval(60)}}>1m</MenuItemOption>
                      <MenuItemOption value='120' onClick={(e)=>{setRefreshInterval(120)}}>2m</MenuItemOption>
                      <MenuItemOption value='600' onClick={(e)=>{setRefreshInterval(600)}}>5m</MenuItemOption>
                    </MenuOptionGroup>

                    <MenuDivider />


                    <ViewModeSwitcherMenuItem/>

                    <MenuDivider />
                    
                    <ColorModeSwitcherMenuItem/>

                    <MenuDivider />

                    <SupportMenuItem/>

                    
                      
                  </MenuList>
                </Menu>
              :
                <>
                  <Menu>

                    <MenuButton as={Button} size={'sm'} rightIcon={<RepeatIcon />}>
                      <Text as='span' textStyle='control'>{refreshInterval}s</Text>
                    </MenuButton>

                    <MenuList>
                      <MenuItem onClick={(e)=>{setRefreshInterval(30)}}>30s</MenuItem>
                      <MenuItem onClick={(e)=>{setRefreshInterval(60)}}>1m</MenuItem>
                      <MenuItem onClick={(e)=>{setRefreshInterval(120)}}>2m</MenuItem>
                      <MenuItem onClick={(e)=>{setRefreshInterval(600)}}>5m</MenuItem>
                    </MenuList>
                    
                  </Menu>

                  <ViewModeSwitcher />
                    
                  <ColorModeSwitcher />

                  <SupportButton />
                  
                </>
              }
              
            </Stack>
            
          </Flex>
          

        </Flex>
        {loading?
            <Progress size='xs' isIndeterminate />:<Progress value={0} size='xs' />}
      </Container>
    </Box>

  );
}
