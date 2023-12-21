import React, { useState } from 'react'

export const ThemeContext = React.createContext({
  theme: 'classic',
  setTheme: () => {}
})

export const ThemeProvider = (props) => {

  const setTheme = (theme) => {
    localStorage.setItem('theme', theme)
    setState({...state, theme: theme})
  }

  const initState = {
    theme: localStorage.getItem('theme') ? localStorage.getItem('theme') : 'classic',
    setTheme: setTheme
  } 

  const [state, setState] = useState(initState)

  return (
    <ThemeContext.Provider value={state}>
      {props.children}
    </ThemeContext.Provider>
  )
}