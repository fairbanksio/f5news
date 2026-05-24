import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '../test-utils';
import { ThemeContext } from '../Contexts/ThemeContext';
import { ColorModeSwitcher } from './ColorModeSwitcher';
import { trackColorModeChange } from '../analytics';

vi.mock('../analytics', () => ({
  trackColorModeChange: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test('switches color mode without swapping the site typography theme', () => {
  const setTheme = vi.fn();

  render(
    <ThemeContext.Provider value={{ theme: 'custom', setTheme }}>
      <ColorModeSwitcher />
    </ThemeContext.Provider>
  );

  fireEvent.click(screen.getByRole('button', { name: /switch to light mode|switch to dark mode/i }));

  expect(setTheme).not.toHaveBeenCalled();
  expect(trackColorModeChange).toHaveBeenCalledWith({
    fromMode: expect.any(String),
    toMode: expect.any(String),
    subreddit: 'politics',
    surface: 'desktop',
  });
});
