import React from 'react';
import { screen } from '@testing-library/react';
import { render } from '../test-utils';
import ListView from './ListView';

const posts = [
  {
    title: 'Most popular story',
    url: 'https://example.com/story',
    commentCount: 12,
    upvoteCount: 542,
    created_utc: Math.floor(Date.now() / 1000),
    domain: 'example.com',
    commentLink: '/r/news/comments/abc123/example',
  },
];

test('communicates that the list is sorted by upvotes descending', () => {
  render(<ListView posts={posts} />);

  expect(
    screen.getByRole('columnheader', { name: /upvotes.*descending/i })
  ).toBeInTheDocument();
});
