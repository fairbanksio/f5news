import React,{useContext} from 'react';
import { Button, Menu, Box, Text} from '@chakra-ui/react';
import { BsGridFill, BsListUl } from 'react-icons/bs';
import { ViewModeContext } from '../Contexts/ViewModeContext'
import { SubredditContext } from '../Contexts/SubredditContext';
import { trackViewModeChange } from '../analytics';

export const ViewModeSwitcher = () => {
  const { viewMode, setViewMode } = useContext(ViewModeContext)
  const { subreddit } = useContext(SubredditContext);

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
      onClick={switchViewMode}
      size={'sm'}
      aria-label={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
      textStyle='control'
    >
      {viewMode === 'grid'? <BsListUl /> : <BsGridFill/>}
    </Button>
  );
};

export const ViewModeSwitcherMenuItem = () => {
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
  }
  return (
    <Menu.Item value="ViewModeSwitcher" onClick={switchViewMode} >
      <Box as={viewMode === 'grid'? BsListUl : BsGridFill} ml={0} mr={2}/> 
      <Text as='span' textStyle='control'>{viewMode === 'grid'? 'List view' : 'Grid view'}</Text>
    </Menu.Item>
  );
};
