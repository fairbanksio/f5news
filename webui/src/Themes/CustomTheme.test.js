import CustomTheme from './CustomTheme';

const { system } = CustomTheme;

test('keeps the dark default and original light and dark post colors', () => {
  expect(CustomTheme.config.initialColorMode).toBe('dark');
  expect(system.token('colors.gray.900')).toBe('#171923');
  expect(system.token('colors.gray.400')).toBe('#A0AEC0');
  expect(system.token('colors.blue.900')).toBe('#1A365D');
  expect(system.tokens.getByName('colors.trending').extensions.conditions).toEqual({ _light: '#ffd8b2', _dark: '#161938' });
  expect(system.tokens.getByName('colors.link').extensions.conditions).toEqual({ _light: '#337ab7', _dark: '#adbbcd' });
});

test('applies compact typography through the Chakra3 text style resolver', () => {
  expect(system.token('fonts.body')).toContain('Inter');
  expect(system.token('lineHeights.short')).toBe(1.375);
  expect(system.token('lineHeights.base')).toBe(1.5);
  expect(system.css({ textStyle: 'cardTitle' })).toMatchObject({
    fontSize: 'var(--chakra-font-sizes-md)',
    fontWeight: 'var(--chakra-font-weights-semibold)',
    lineHeight: 'var(--chakra-line-heights-short)',
    '@media screen and (min-width: 48rem)': { fontSize: 'var(--chakra-font-sizes-lg)' },
  });
});

test('keeps compact controls, menu surfaces and table rows at their original dimensions', () => {
  const button = system.getRecipe('button');
  expect(button.variants.size.sm).toMatchObject({ h: 8, minW: 8, px: 3, fontSize: 'sm', gap: 0 });
  expect(button.variants.variant.solid).toMatchObject({
    bg: { _light: 'gray.100', _dark: 'whiteAlpha.200' },
    color: { _light: 'gray.800', _dark: 'whiteAlpha.900' },
  });
  const menu = system.getSlotRecipe('menu');
  expect(menu.variants.size.md.content).toMatchObject({ minW: '14rem', py: 1, px: 0 });
  expect(menu.base.content).toMatchObject({ bg: 'navbar', color: 'textPrimary' });
  expect(system.getSlotRecipe('table').variants.size.sm.cell).toMatchObject({ px: 4, py: 2, lineHeight: '4' });
  expect(system.token('sizes.container.xl')).toBe('1280px');
});

test('keeps the original shadows in both themes', () => {
  expect(system.tokens.getByName('shadows.sm').originalValue).toBe('0 1px 2px 0 rgba(0, 0, 0, 0.05)');
  expect(system.tokens.getByName('shadows.lg').originalValue).toBe('0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)');
});
