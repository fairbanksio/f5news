import React, { useState } from 'react'

export const ViewModeContext = React.createContext({
  viewMode: 'grid',
  setViewMode: () => {}
})

export const ViewModeProvider = (props) => {

  const setViewMode = (viewMode) => {
    localStorage.setItem('viewMode', viewMode)
    setState({...state, viewMode: viewMode})
  }

  const initState = {
    viewMode: localStorage.getItem('viewMode') ? localStorage.getItem('viewMode') : 'grid',
    setViewMode: setViewMode
  } 

  const [state, setState] = useState(initState)

  return (
    <ViewModeContext.Provider value={state}>
      {props.children}
    </ViewModeContext.Provider>
  )
}