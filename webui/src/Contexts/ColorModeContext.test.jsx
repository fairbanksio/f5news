import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '../test-utils';
import { useColorMode } from './ColorModeContext';

const ModeControl = () => {
  const { colorMode, toggleColorMode } = useColorMode();
  return <button onClick={toggleColorMode}>{colorMode}</button>;
};

beforeEach(() => localStorage.clear());

test('defaults to dark and restores an existing light preference', () => {
  const first = render(<ModeControl />);
  expect(screen.getByRole('button', { name: 'dark' })).toBeInTheDocument();
  expect(document.documentElement).toHaveClass('dark');
  first.unmount();

  localStorage.setItem('chakra-ui-color-mode', 'light');
  render(<ModeControl />);
  expect(screen.getByRole('button', { name: 'light' })).toBeInTheDocument();
  expect(document.documentElement).toHaveClass('light');
  expect(document.documentElement).not.toHaveClass('dark');
});

test('persists a toggle across remounts using the existing Chakra storage key', () => {
  const first = render(<ModeControl />);
  fireEvent.click(screen.getByRole('button', { name: 'dark' }));
  expect(localStorage.getItem('chakra-ui-color-mode')).toBe('light');
  first.unmount();
  render(<ModeControl />);
  expect(screen.getByRole('button', { name: 'light' })).toBeInTheDocument();
});
