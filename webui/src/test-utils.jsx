import React from 'react';
import { render } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import CustomTheme from './Themes/CustomTheme';

const AllProviders = ({ children }) => (
  <ChakraProvider theme={CustomTheme}>{children}</ChakraProvider>
);

const customRender = (ui, options) =>
  render(ui, { wrapper: AllProviders, ...options });

export { customRender as render };
