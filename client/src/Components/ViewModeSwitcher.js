import React,{useContext} from 'react';
import { Button} from '@chakra-ui/react';
import { BsGridFill, BsListUl } from 'react-icons/bs';
import { ViewModeContext } from '../Contexts/ViewModeContext'

export const ViewModeSwitcher = props => {
  const { viewMode, setViewMode } = useContext(ViewModeContext)

  const switchViewMode = () => {
    if(viewMode === 'grid'){
      setViewMode('list')
    } else {
      setViewMode('grid')
    }
  }

  return (
    <Button onClick={(e)=>{switchViewMode()}} size={'sm'}>
      {viewMode === 'grid'? <BsListUl /> : <BsGridFill/>}
    </Button>
  );
};
