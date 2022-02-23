import React from 'react';
import { useColorMode, useColorModeValue, Button} from '@chakra-ui/react';
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
