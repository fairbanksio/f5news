import React from 'react';
import { useColorMode, useColorModeValue, Button, Box, MenuItem} from '@chakra-ui/react';
import { FaMoon, FaSun } from 'react-icons/fa';

export const ColorModeSwitcher = props => {
  const { toggleColorMode } = useColorMode();
  const SwitchIcon = useColorModeValue(FaMoon, FaSun);

  return (
    <Button onClick={toggleColorMode}  size={'sm'}>
      <SwitchIcon />
    </Button>
  );
};

export const ColorModeSwitcherMenuItem = props => {
  const { toggleColorMode } = useColorMode();
  const SwitchIcon = useColorModeValue(FaMoon, FaSun);
  const SwitchText = useColorModeValue('Dark mode', 'Light mode');
  return (
    <MenuItem onClick={toggleColorMode} >
      <Box as={SwitchIcon} ml={0} mr={2}/> 
      <span>{SwitchText}</span>
    </MenuItem>
  );
};
