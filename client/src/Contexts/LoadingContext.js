import React, { useState } from 'react'

export const LoadingContext = React.createContext({
  loading: false,
  setLoading: () => {}
})

export const LoadingProvider = (props) => {

  const setLoading = (loading) => {
    setState({...state, loading: loading})
  }

  const initState = {
    loading: false,
    setLoading: setLoading
  } 

  const [state, setState] = useState(initState)

  return (
    <LoadingContext.Provider value={state}>
      {props.children}
    </LoadingContext.Provider>
  )
}