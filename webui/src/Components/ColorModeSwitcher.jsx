import React from 'react';
import { useColorMode, useColorModeValue, Button, Box, MenuItem, Text} from '@chakra-ui/react';
import { FaMoon, FaSun } from 'react-icons/fa';
import ReactGA from 'react-ga4';

export const ColorModeSwitcher = props => {
  const { toggleColorMode } = useColorMode();
  const changeMode = () => {
    ReactGA.event({
      category: "visual",
      action: "changecolormode",
      label: "colormode", // optional
      value: 1, // optional, must be a number
      nonInteraction: false, // optional, true/false
      transport: "xhr", // optional, beacon/xhr/image
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
  const { toggleColorMode } = useColorMode();
  const changeMode = () => {
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
