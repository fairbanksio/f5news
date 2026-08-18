import React, { useContext } from 'react';
import { Button, Box, Text} from '@chakra-ui/react';
import { useColorMode, useColorModeValue } from '../Contexts/ColorModeContext';
import { FaMoon, FaSun } from 'react-icons/fa';
import { SubredditContext } from '../Contexts/SubredditContext';
import { trackColorModeChange } from '../analytics';

export const ColorModeSwitcher = props => {
  const { colorMode, toggleColorMode } = useColorMode();
  const { subreddit } = useContext(SubredditContext);
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
    <Button onClick={changeMode} size={'sm'} aria-label={switchLabel} textStyle='control' {...controlButtonProps}>
      <SwitchIcon />
    </Button>
  );
};

export const ColorModeSwitcherMenuItem = ({ onSelect } = {}) => {
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
    onSelect?.();
  }
  
  const SwitchIcon = useColorModeValue(FaMoon, FaSun);
  const SwitchText = useColorModeValue('Dark mode', 'Light mode');
  return (
    <Button
      type="button"
      role="menuitem"
      variant="ghost"
      size="sm"
      justifyContent="flex-start"
      w="100%"
      borderRadius={0}
      color="textPrimary"
      bg="transparent"
      style={{
        height: '27px',
        minHeight: '27px',
        paddingBottom: 0,
        paddingTop: 0,
      }}
      _hover={{ bg: { _light: 'gray.100', _dark: 'whiteAlpha.200' } }}
      onClick={changeMode}
    >
      <Box as={SwitchIcon} ml={0} mr={2}/> 
      <Text as='span' textStyle='control'>{SwitchText}</Text>
    </Button>
  );
};
