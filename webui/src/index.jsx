import { ColorModeScript } from '@chakra-ui/react';
import React, { StrictMode } from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import CustomTheme from './Themes/CustomTheme';

ReactDOM.render(
  <StrictMode>
    <ColorModeScript initialColorMode={CustomTheme.config.initialColorMode} />
    <App />
  </StrictMode>,
  document.getElementById('root')
);
