import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '../test-utils';
import ListView from './ListView';
import { trackPostSelection } from '../analytics';

vi.mock('../analytics', () => ({
  trackPostSelection: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

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

test('tracks list article and Reddit content selections', () => {
  render(<ListView posts={posts} />);

  fireEvent.click(screen.getByRole('link', { name: 'Most popular story' }));
  fireEvent.click(screen.getByRole('link', { name: /open reddit comments/i }));

  expect(trackPostSelection).toHaveBeenCalledWith({
    contentType: 'article',
    post: posts[0],
    position: 1,
    subreddit: 'politics',
    viewMode: 'list',
  });
  expect(trackPostSelection).toHaveBeenCalledWith({
    contentType: 'reddit_comments',
    post: posts[0],
    position: 1,
    subreddit: 'politics',
    viewMode: 'list',
  });
});
