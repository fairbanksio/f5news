import React,{useContext} from 'react';
import { Button, MenuItem, Box} from '@chakra-ui/react';
import { BsGridFill, BsListUl } from 'react-icons/bs';
import { ViewModeContext } from '../Contexts/ViewModeContext'
import ReactGA from 'react-ga4';

export const ViewModeSwitcher = props => {
  const { viewMode, setViewMode } = useContext(ViewModeContext)
// Send a custom event

  const switchViewMode = () => {
    if(viewMode === 'grid'){
      setViewMode('list')
      ReactGA.event({
        category: "visual",
        action: "changeviewmode",
        label: "viewmode", // optional
        value: 0, // optional, must be a number
        nonInteraction: false, // optional, true/false
        transport: "xhr", // optional, beacon/xhr/image
      });
    } else {
      setViewMode('grid')
      ReactGA.event({
        category: "visual",
        action: "changeviewmode",
        label: "viewmode", // optional
        value: 1, // optional, must be a number
        nonInteraction: false, // optional, true/false
        transport: "xhr", // optional, beacon/xhr/image
      });
    }
  }

  return (
    <Button onClick={(e)=>{switchViewMode()}} size={'sm'}>
      {viewMode === 'grid'? <BsListUl /> : <BsGridFill/>}
    </Button>
  );
};

export const ViewModeSwitcherMenuItem = props => {
  const { viewMode, setViewMode } = useContext(ViewModeContext)
  const switchViewMode = () => {
    if(viewMode === 'grid'){
      setViewMode('list')
    } else {
      setViewMode('grid')
    }
  }
  return (
    <MenuItem onClick={(e)=>{switchViewMode()}} >
      <Box as={viewMode === 'grid'? BsListUl : BsGridFill} ml={0} mr={2}/> 
      <span>{viewMode === 'grid'? 'List view' : 'Grid view'}</span>
    </MenuItem>
  );
};