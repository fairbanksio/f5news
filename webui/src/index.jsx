import { ColorModeScript } from '@chakra-ui/react';
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import CustomTheme from './Themes/CustomTheme';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ColorModeScript initialColorMode={CustomTheme.config.initialColorMode} />
    <App />
  </StrictMode>,
  document.getElementById('root')
);
