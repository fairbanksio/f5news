import React from 'react';
import { screen } from '@testing-library/react';
import { render } from '../test-utils';
import { ModalContext } from '../Contexts/ModalContext';
import GridView from './GridView';

const posts = [
  {
    title: 'First grid story',
    url: 'https://example.com/first',
    thumbnail: 'self',
    commentCount: 12,
    upvoteCount: 42,
    created_utc: Math.floor(Date.now() / 1000),
    domain: 'example.com',
    commentLink: '/r/news/comments/first/example',
  },
  {
    title: 'Second grid story',
    url: 'https://example.com/second',
    thumbnail: 'self',
    commentCount: 6,
    upvoteCount: 24,
    created_utc: Math.floor(Date.now() / 1000),
    domain: 'example.com',
    commentLink: '/r/news/comments/second/example',
  },
];

test('renders one post card for each post', () => {
  render(
    <ModalContext.Provider value={{ setModalData: vi.fn() }}>
      <GridView posts={posts} />
    </ModalContext.Provider>
  );

  expect(screen.getAllByTestId('post-card')).toHaveLength(2);
  expect(screen.getByRole('link', { name: 'First grid story' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Second grid story' })).toBeInTheDocument();
});

test('renders an empty grid when posts are missing', () => {
  render(<GridView />);

  expect(screen.queryByTestId('post-card')).not.toBeInTheDocument();
});
