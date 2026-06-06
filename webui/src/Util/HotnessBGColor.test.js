import { hotnessBGColor } from './HotnessBGColor';

test.each([
  [99, false],
  [100, 'trending'],
  [249, 'trending'],
  [250, 'hot'],
  [499, 'hot'],
  [500, 'f5oclock'],
])('maps %i upvotes to %s', (upvoteCount, expectedColor) => {
  expect(hotnessBGColor(upvoteCount)).toBe(expectedColor);
});
