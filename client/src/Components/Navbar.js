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

const PrimaryLogo = () => {
  return (
    <>
      <Text fontSize={'xl'}>&#128293;</Text>
    </>
  )
}

const SecondaryLogo = () => {
  return (
    <Image src='usa.svg' objectFit='scale-down' h='30px' w='30px'/>
  )
}

export default function Nav() {
  const { refreshInterval, setRefreshInterval } = useContext(RefreshIntervalContext)
  const { subreddit, setSubreddit, subredditList } = useContext(SubredditContext)
  const { loading } = useContext(LoadingContext)
  const [logo, setLogo] = useState(true)
  const mobileMode = useBreakpointValue({base: true, sm: true, md: false})
  
  return (

    <Box position='fixed' width={'100%'} bg='navbar' style={{zIndex:'1'}}>
      
      <Container maxW='container.xl' pr={mobileMode?0:4} pl={mobileMode?0:4} >
      
        <Flex h={12} alignItems={'center'} justifyContent={'space-between'} pr={mobileMode?2:0} pl={mobileMode?2:0} >

          <Box maxH='40px' onClick={(e)=>{setLogo(!logo)}}>
            <Stack direction={['row']}>
              {logo? <PrimaryLogo/> : <SecondaryLogo/>}
              <Text float='left' fontSize={'xl'} ml='2'>F5 News</Text>
            </Stack>
          </Box>
          
          <Flex alignItems={'center'} >
            <Stack direction={'row'} spacing={2}>

              <Menu>
                <MenuButton as={Button} size={'sm'} rightIcon={<ChevronDownIcon />}  maxW='10vw'><Text isTruncated>r/{subreddit}</Text></MenuButton>
                <MenuList>
                  {subredditList.map((subreddit, key) => {
                    return(<MenuItem  key={key} onClick={(e)=>{setSubreddit(subreddit)}}  maxW='10vw'><Tooltip label={subreddit} ><Text isTruncated>{subreddit}</Text></Tooltip></MenuItem>)
                  })}
                </MenuList>
              </Menu>

              { mobileMode ?
                <Menu>
                  <MenuButton as={IconButton} size={'sm'} icon={<SettingsIcon />}/>
                  <MenuList>

                    <MenuOptionGroup defaultValue={refreshInterval} value={refreshInterval} title='Interval' type='radio'>
                      <MenuItemOption value={30} onClick={(e)=>{setRefreshInterval(30)}}>30s</MenuItemOption>
                      <MenuItemOption value={60} onClick={(e)=>{setRefreshInterval(60)}}>1m</MenuItemOption>
                      <MenuItemOption value={120} onClick={(e)=>{setRefreshInterval(120)}}>2m</MenuItemOption>
                      <MenuItemOption value={600} onClick={(e)=>{setRefreshInterval(600)}}>5m</MenuItemOption>
                    </MenuOptionGroup>

                    <MenuDivider />


                    <ViewModeSwitcherMenuItem/>

                    <MenuDivider />
                    
                    <ColorModeSwitcherMenuItem/>

                    
                      
                  </MenuList>
                </Menu>
              :
                <>
                  <Menu>

                    <MenuButton as={Button} size={'sm'} rightIcon={<RepeatIcon />}>{refreshInterval}s</MenuButton>

                    <MenuList>
                      <MenuItem onClick={(e)=>{setRefreshInterval(30)}}>30s</MenuItem>
                      <MenuItem onClick={(e)=>{setRefreshInterval(60)}}>1m</MenuItem>
                      <MenuItem onClick={(e)=>{setRefreshInterval(120)}}>2m</MenuItem>
                      <MenuItem onClick={(e)=>{setRefreshInterval(600)}}>5m</MenuItem>
                    </MenuList>
                    
                  </Menu>

                  <ViewModeSwitcher />
                    
                  <ColorModeSwitcher />
                  
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