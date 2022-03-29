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

test('renders learn react link', () => {
  render(<StrictMode>
    <ColorModeScript />
    <App />
  </StrictMode>);
  const linkElement = screen.getByText(/F5 News/i);
  expect(linkElement).toBeInTheDocument();
});
