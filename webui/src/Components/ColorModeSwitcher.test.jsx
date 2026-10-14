import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '../test-utils';
import { ColorModeSwitcher } from './ColorModeSwitcher';
import { trackColorModeChange } from '../analytics';

vi.mock('../analytics', () => ({
  trackColorModeChange: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test('switches color mode and tracks the change', () => {
  render(<ColorModeSwitcher />);
  const button = screen.getByRole('button', { name: /switch to light mode|switch to dark mode/i });
  const nextLabel = button.getAttribute('aria-label') === 'Switch to light mode'
    ? 'Switch to dark mode' : 'Switch to light mode';
  fireEvent.click(button);
  expect(screen.getByRole('button', { name: nextLabel })).toBeInTheDocument();

  expect(trackColorModeChange).toHaveBeenCalledWith({
    fromMode: expect.any(String),
    toMode: expect.any(String),
    subreddit: 'politics',
    surface: 'desktop',
  });
});
