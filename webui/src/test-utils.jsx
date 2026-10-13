import React from 'react';
import { render } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import { ColorModeProvider } from './Contexts/ColorModeContext';
import CustomTheme from './Themes/CustomTheme';

const AllProviders = ({ children }) => (
  <ChakraProvider value={CustomTheme.system}>
    <ColorModeProvider initialColorMode={CustomTheme.config.initialColorMode}>
      {children}
    </ColorModeProvider>
  </ChakraProvider>
);

const customRender = (ui, options) =>
  render(ui, { wrapper: AllProviders, ...options });

export { customRender as render };
