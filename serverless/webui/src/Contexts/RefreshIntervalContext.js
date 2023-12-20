import React, { useState } from 'react'

export const RefreshIntervalContext = React.createContext({
  refreshInterval: 30,
  setRefreshInterval: () => {}
})

export const RefreshIntervalProvider = (props) => {

  const setRefreshInterval = (refreshInterval) => {
    localStorage.setItem('refreshInterval', refreshInterval)
    setState({...state, refreshInterval: refreshInterval})
  }

  const initState = {
    refreshInterval: localStorage.getItem('refreshInterval') ? localStorage.getItem('refreshInterval') : 30,
    setRefreshInterval: setRefreshInterval
  } 

  const [state, setState] = useState(initState)

  return (
    <RefreshIntervalContext.Provider value={state}>
      {props.children}
    </RefreshIntervalContext.Provider>
  )
}