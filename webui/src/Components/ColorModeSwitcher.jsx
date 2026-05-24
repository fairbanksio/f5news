import React, { useContext } from 'react';
import { useColorMode, useColorModeValue, Button, Box, MenuItem, Text} from '@chakra-ui/react';
import { FaMoon, FaSun } from 'react-icons/fa';
import { SubredditContext } from '../Contexts/SubredditContext';
import { trackColorModeChange } from '../analytics';

export const ColorModeSwitcher = props => {
  const { colorMode, toggleColorMode } = useColorMode();
  const { subreddit } = useContext(SubredditContext);
  const changeMode = () => {
    trackColorModeChange({
      fromMode: colorMode,
      toMode: colorMode === 'light' ? 'dark' : 'light',
      subreddit,
      surface: 'desktop',
    });
    toggleColorMode()
  }
  
  const SwitchIcon = useColorModeValue(FaMoon, FaSun);
  const switchLabel = useColorModeValue('Switch to dark mode', 'Switch to light mode');
  return (
    <Button onClick={changeMode} size={'sm'} aria-label={switchLabel} textStyle='control'>
      <SwitchIcon />
    </Button>
  );
};

export const ColorModeSwitcherMenuItem = props => {
  const { colorMode, toggleColorMode } = useColorMode();
  const { subreddit } = useContext(SubredditContext);
  const changeMode = () => {
    trackColorModeChange({
      fromMode: colorMode,
      toMode: colorMode === 'light' ? 'dark' : 'light',
      subreddit,
      surface: 'mobile',
    });
    toggleColorMode()
  }
  
  const SwitchIcon = useColorModeValue(FaMoon, FaSun);
  const SwitchText = useColorModeValue('Dark mode', 'Light mode');
  return (
    <MenuItem onClick={changeMode} >
      <Box as={SwitchIcon} ml={0} mr={2}/> 
      <Text as='span' textStyle='control'>{SwitchText}</Text>
    </MenuItem>
  );
};
