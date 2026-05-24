import ClassicTheme from './ClassicTheme';

test('exposes the legacy semantic color tokens used by post hotness states', () => {
  expect(ClassicTheme.semanticTokens.colors.trending.default).toBe('#ffd8b2');
  expect(ClassicTheme.semanticTokens.colors.hot.default).toBe('#ffbf7f');
  expect(ClassicTheme.semanticTokens.colors.f5oclock.default).toBe('#ffa64c');
});

test('keeps classic global body colors mode-aware', () => {
  expect(ClassicTheme.styles.global({ colorMode: 'light' }).body).toEqual(expect.objectContaining({
    bg: 'white',
    color: '#333',
  }));
  expect(ClassicTheme.styles.global({ colorMode: 'dark' }).body).toEqual(expect.objectContaining({
    bg: '#222222',
    color: '#888',
  }));
});
