import React, { useState } from 'react'

export const ModalContext = React.createContext({
  modalData: null,
  setModalData: () => {}
})

export const ModalProvider = (props) => {

  const setModalData = (modalData) => {
    setState({...state, modalData: modalData})
  }

  const initState = {
    modalData: null,
    setModalData: setModalData
  } 

  const [state, setState] = useState(initState)

  return (
    <ModalContext.Provider value={state}>
      {props.children}
    </ModalContext.Provider>
  )
}