import React, { StrictMode } from 'react';
import { screen } from '@testing-library/react';
import { render } from './test-utils';
import App from './App';
import { ColorModeScript } from '@chakra-ui/react';
const { matchMedia, setMedia } = require("mock-match-media");

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: matchMedia,
});

test('renders F5 News header', () => {
  render(<StrictMode>
    <ColorModeScript />
    <App />
  </StrictMode>);
  const headerText = screen.getByText(/F5 News/i);
  expect(headerText).toBeInTheDocument();
});
