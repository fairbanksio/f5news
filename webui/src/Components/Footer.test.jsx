import React from 'react';
import { screen } from '@testing-library/react';
import { render } from '../test-utils';
import Footer from './Footer';
import { SUPPORT_MESSAGE, SUPPORT_URL } from './SupportLink';

test('renders maintainer credits and clickable desktop support text', () => {
  render(<Footer />);

  expect(screen.getByText(/Maintained with/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'bsord' })).toHaveAttribute(
    'href',
    'https://github.com/bsord'
  );
  expect(screen.getByRole('link', { name: 'bsord' })).toHaveStyle({
    color: 'var(--chakra-colors-footerlink)',
  });
  expect(screen.getByRole('link', { name: 'jonfairbanks' })).toHaveAttribute(
    'href',
    'https://fairbanks.io'
  );
  expect(screen.getByRole('link', { name: 'jonfairbanks' })).toHaveStyle({
    color: 'var(--chakra-colors-footerlink)',
  });
  expect(screen.getByRole('link', { name: SUPPORT_MESSAGE })).toHaveAttribute(
    'href',
    SUPPORT_URL
  );
  expect(screen.queryByRole('link', { name: 'Support F5 News' })).not.toBeInTheDocument();
});
