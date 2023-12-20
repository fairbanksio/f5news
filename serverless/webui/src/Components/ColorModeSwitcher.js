import React, {useContext} from 'react';
import { useColorMode, useColorModeValue, Button, Box, MenuItem} from '@chakra-ui/react';
import { FaMoon, FaSun } from 'react-icons/fa';
import {  ThemeContext } from '../Contexts/ThemeContext'
import ReactGA from 'react-ga4';

export const ColorModeSwitcher = props => {
  const { theme, setTheme } = useContext(ThemeContext)
  const { toggleColorMode } = useColorMode();
  const changeMode = () => {
    ReactGA.event({
      category: "visual",
      action: "changecolormode",
      label: "colormode", // optional
      value:  theme === 'classic' ? 0 : 1, // optional, must be a number
      nonInteraction: false, // optional, true/false
      transport: "xhr", // optional, beacon/xhr/image
    });
    toggleColorMode()
    theme === 'classic' ? setTheme('custom') : setTheme('classic')
  }
  
  const SwitchIcon = useColorModeValue(FaMoon, FaSun);
  return (
    <Button onClick={changeMode}  size={'sm'}>
      <SwitchIcon />
    </Button>
  );
};

export const ColorModeSwitcherMenuItem = props => {
  const { theme, setTheme } = useContext(ThemeContext)
  const { toggleColorMode } = useColorMode();
  const changeMode = () => {
    toggleColorMode()
    theme === 'classic' ? setTheme('custom') : setTheme('classic')
  }
  
  const SwitchIcon = useColorModeValue(FaMoon, FaSun);
  const SwitchText = useColorModeValue('Dark mode', 'Light mode');
  return (
    <MenuItem onClick={changeMode} >
      <Box as={SwitchIcon} ml={0} mr={2}/> 
      <span>{SwitchText}</span>
    </MenuItem>
  );
};
