import React from 'react';
import { screen } from '@testing-library/react';
import { Menu, MenuList } from '@chakra-ui/react';
import { render } from '../test-utils';
import {
  SUPPORT_MESSAGE,
  SUPPORT_URL,
  SupportButton,
  SupportMenuItem,
  SupportMessage,
} from './SupportLink';

test('renders the F5 News support button', () => {
  render(<SupportButton />);

  const supportLink = screen.getByRole('link', { name: /support f5 news/i });
  expect(supportLink).toHaveAttribute('href', SUPPORT_URL);
  expect(supportLink).toHaveAttribute('target', '_blank');
});

test('renders the reader-friendly support message as a link', () => {
  render(<SupportMessage />);

  const supportLink = screen.getByRole('link', { name: SUPPORT_MESSAGE });
  expect(supportLink).toHaveAttribute('href', SUPPORT_URL);
  expect(supportLink).toHaveAttribute('target', '_blank');
});

test('renders the mobile settings support item', () => {
  render(
    <Menu isOpen>
      <MenuList>
        <SupportMenuItem />
      </MenuList>
    </Menu>
  );

  const supportLink = screen.getByRole('menuitem', { name: /support f5 news/i });
  expect(supportLink).toHaveAttribute('href', SUPPORT_URL);
});
