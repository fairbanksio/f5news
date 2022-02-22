import { ReactNode, useContext } from 'react';
import {
  Box,
  Flex,
  Avatar,
  Link,
  Button,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  MenuDivider,
  useDisclosure,
  useColorModeValue,
  Stack,
  useColorMode,
  Center,
  Container,
  Text
} from '@chakra-ui/react';
import { MoonIcon, SunIcon, ChevronDownIcon, RepeatIcon } from '@chakra-ui/icons';
import { RefreshIntervalContext } from '../Contexts/RefreshIntervalContext'
import { SubredditContext } from '../Contexts/SubredditContext'
import { ColorModeSwitcher } from './ColorModeSwitcher';
const NavLink = ({ children }) => (
  <Link
    px={2}
    py={1}
    rounded={'md'}
    _hover={{
      textDecoration: 'none',
      bg: useColorModeValue('gray.200', 'gray.700'),
    }}
    href={'#'}>
    {children}
  </Link>
);

export default function Nav() {
  const { colorMode, toggleColorMode } = useColorMode();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const { refreshInterval, setRefreshInterval } = useContext(RefreshIntervalContext)
  const { subreddit, setSubreddit } = useContext(SubredditContext)
  return (

    <Box>
      <Container maxW='container.xl'>
      <Flex h={12} alignItems={'center'} justifyContent={'space-between'}>
        <Box><Text fontSize={'xl'}>&#128293; F5oclock</Text></Box>

        <Flex alignItems={'center'} >
          <Stack direction={'row'} spacing={2}>

            <Menu>
              <MenuButton as={Button} size={'sm'} rightIcon={<ChevronDownIcon />}>r/{subreddit}</MenuButton>
              <MenuList>
                <MenuItem onClick={(e)=>{setSubreddit('superstonk')}}>r/superstonk</MenuItem>
                <MenuItem onClick={(e)=>{setSubreddit('politics')}}>r/politics</MenuItem>
                <MenuItem onClick={(e)=>{setSubreddit('all')}}>r/all</MenuItem>
              </MenuList>
            </Menu>

            <Menu>
              <MenuButton as={Button} size={'sm'} rightIcon={<RepeatIcon />}>{refreshInterval}s</MenuButton>
              <MenuList>
                <MenuItem onClick={(e)=>{setRefreshInterval(30)}}>30s</MenuItem>
                <MenuItem onClick={(e)=>{setRefreshInterval(60)}}>1m</MenuItem>
                <MenuItem onClick={(e)=>{setRefreshInterval(120)}}>2m</MenuItem>
                <MenuItem onClick={(e)=>{setRefreshInterval(600)}}>5m</MenuItem>
              </MenuList>
            </Menu>

            <ColorModeSwitcher />

          </Stack>
        </Flex>
      </Flex>
      </Container>
    </Box>

  );
}