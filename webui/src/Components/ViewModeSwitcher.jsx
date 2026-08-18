import React,{useContext} from 'react';
import { Button, Box, Text} from '@chakra-ui/react';
import { BsGridFill, BsListUl } from 'react-icons/bs';
import { ViewModeContext } from '../Contexts/ViewModeContext'
import { SubredditContext } from '../Contexts/SubredditContext';
import { useColorModeValue } from '../Contexts/ColorModeContext';
import { trackViewModeChange } from '../analytics';

export const ViewModeSwitcher = props => {
  const { viewMode, setViewMode } = useContext(ViewModeContext)
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

  const switchViewMode = () => {
    const nextViewMode = viewMode === 'grid' ? 'list' : 'grid';
    setViewMode(nextViewMode)
    trackViewModeChange({
      fromMode: viewMode,
      toMode: nextViewMode,
      subreddit,
      surface: 'desktop',
    });
  }

  return (
    <Button
      onClick={(e)=>{switchViewMode()}}
      size={'sm'}
      aria-label={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
      textStyle='control'
      {...controlButtonProps}
    >
      {viewMode === 'grid'? <BsListUl /> : <BsGridFill/>}
    </Button>
  );
};

export const ViewModeSwitcherMenuItem = ({ onSelect } = {}) => {
  const { viewMode, setViewMode } = useContext(ViewModeContext)
  const { subreddit } = useContext(SubredditContext);
  const switchViewMode = () => {
    const nextViewMode = viewMode === 'grid' ? 'list' : 'grid';
    setViewMode(nextViewMode)
    trackViewModeChange({
      fromMode: viewMode,
      toMode: nextViewMode,
      subreddit,
      surface: 'mobile',
    });
    onSelect?.();
  }
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
      onClick={(e)=>{switchViewMode()}}
    >
      <Box as={viewMode === 'grid'? BsListUl : BsGridFill} ml={0} mr={2}/> 
      <Text as='span' textStyle='control'>{viewMode === 'grid'? 'List view' : 'Grid view'}</Text>
    </Button>
  );
};
