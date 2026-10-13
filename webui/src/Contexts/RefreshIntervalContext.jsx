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

  const storedInterval = localStorage.getItem('refreshInterval')
  // Earlier five-minute selections were saved as ten minutes.
  if (storedInterval === '600') localStorage.setItem('refreshInterval', '300')

  const initState = {
    refreshInterval: storedInterval === '600' ? '300' : storedInterval || 30,
    setRefreshInterval: setRefreshInterval
  } 

  const [state, setState] = useState(initState)

  return (
    <RefreshIntervalContext.Provider value={state}>
      {props.children}
    </RefreshIntervalContext.Provider>
  )
}