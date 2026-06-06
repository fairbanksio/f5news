import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { Menu, MenuList } from '@chakra-ui/react';
import { render } from '../test-utils';
import { ViewModeContext } from '../Contexts/ViewModeContext';
import {
  ViewModeSwitcher,
  ViewModeSwitcherMenuItem,
} from './ViewModeSwitcher';
import { trackViewModeChange } from '../analytics';

vi.mock('../analytics', () => ({
  trackViewModeChange: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test('switches from grid to list and records analytics', () => {
  const setViewMode = vi.fn();

  render(
    <ViewModeContext.Provider value={{ viewMode: 'grid', setViewMode }}>
      <ViewModeSwitcher />
    </ViewModeContext.Provider>
  );

  fireEvent.click(screen.getByRole('button', { name: /switch to list view/i }));

  expect(setViewMode).toHaveBeenCalledWith('list');
  expect(trackViewModeChange).toHaveBeenCalledWith({
    fromMode: 'grid',
    toMode: 'list',
    subreddit: 'politics',
    surface: 'desktop',
  });
});

test('switches from list to grid from the desktop control', () => {
  const setViewMode = vi.fn();

  render(
    <ViewModeContext.Provider value={{ viewMode: 'list', setViewMode }}>
      <ViewModeSwitcher />
    </ViewModeContext.Provider>
  );

  fireEvent.click(screen.getByRole('button', { name: /switch to grid view/i }));

  expect(setViewMode).toHaveBeenCalledWith('grid');
  expect(trackViewModeChange).toHaveBeenCalledWith({
    fromMode: 'list',
    toMode: 'grid',
    subreddit: 'politics',
    surface: 'desktop',
  });
});

test('switches view mode from the mobile settings menu item', () => {
  const setViewMode = vi.fn();

  render(
    <ViewModeContext.Provider value={{ viewMode: 'grid', setViewMode }}>
      <Menu isOpen>
        <MenuList>
          <ViewModeSwitcherMenuItem />
        </MenuList>
      </Menu>
    </ViewModeContext.Provider>
  );

  fireEvent.click(screen.getByRole('menuitem', { name: /list view/i }));

  expect(setViewMode).toHaveBeenCalledWith('list');
});
