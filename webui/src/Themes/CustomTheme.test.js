import CustomTheme from './CustomTheme';

describe('CustomTheme', () => {
  test('defaults Chakra color mode to dark', () => {
    expect(CustomTheme.config).toMatchObject({
      initialColorMode: 'dark',
      useSystemColorMode: false,
    });
  });

  test('uses classic orange light colors and blue dark colors for post hotness', () => {
    const lightGlobalStyles = CustomTheme.styles.global({ colorMode: 'light' });
    const darkGlobalStyles = CustomTheme.styles.global({ colorMode: 'dark' });

    expect(lightGlobalStyles.body).toMatchObject({
      bg: 'white',
      color: '#333',
    });
    expect(darkGlobalStyles.body).toMatchObject({
      bg: 'gray.900',
      color: 'gray.400',
    });
    expect(CustomTheme.semanticTokens.colors.trending).toMatchObject({
      default: '#ffd8b2',
      _dark: '#161938',
    });
    expect(CustomTheme.semanticTokens.colors.hot).toMatchObject({
      default: '#ffbf7f',
      _dark: '#16284f',
    });
    expect(CustomTheme.semanticTokens.colors.f5oclock).toMatchObject({
      default: '#ffa64c',
      _dark: 'blue.900',
    });
    expect(CustomTheme.semanticTokens.colors.f5oclockStrong).toMatchObject({
      default: '#ff8c1a',
      _dark: 'blue.800',
    });
    expect(CustomTheme.semanticTokens.colors.f5oclockPeak).toMatchObject({
      default: '#e67300',
      _dark: 'blue.700',
    });
    expect(CustomTheme.semanticTokens.colors.navbar.default).toBe('#FFFFFF');
    expect(CustomTheme.semanticTokens.colors.navbar._dark).toBe('gray.900');
    expect(CustomTheme.semanticTokens.colors.link.default).toBe('#337ab7');
    expect(CustomTheme.semanticTokens.colors.link._dark).toBe('#adbbcd');
    expect(CustomTheme.semanticTokens.colors.footerLink).toMatchObject({
      default: 'textPrimary',
      _dark: 'textPrimary',
    });
  });

  test('defines a shared compact type system for news surfaces', () => {
    expect(CustomTheme.fonts).toMatchObject({
      heading: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      body: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });
    expect(CustomTheme.textStyles).toMatchObject({
      brand: {
        fontSize: 'lg',
        fontWeight: 'semibold',
        lineHeight: 'short',
      },
      cardTitle: {
        fontSize: { base: 'md', md: 'lg' },
        fontWeight: 'semibold',
        lineHeight: 'short',
      },
      meta: {
        fontSize: 'xs',
        fontWeight: 'semibold',
        lineHeight: 'shorter',
        letterSpacing: 'wide',
        textTransform: 'uppercase',
      },
      control: {
        fontSize: 'sm',
        fontWeight: 'semibold',
      },
      utility: {
        fontSize: { base: 'sm', md: 'md' },
        fontWeight: 'semibold',
        lineHeight: 'short',
      },
      emptyState: {
        fontSize: { base: 'xl', md: '2xl' },
        fontWeight: 'bold',
        lineHeight: 'short',
      },
    });
    expect(CustomTheme.semanticTokens.colors.textPrimary._dark).toBe('gray.400');
    expect(CustomTheme.semanticTokens.colors.textMuted._dark).toBe('gray.500');
  });

  test('uses color-mode-aware menu surfaces instead of fixed dark styles', () => {
    const lightMenuBaseStyle = CustomTheme.components.Menu.baseStyle({ colorMode: 'light' });
    const darkMenuBaseStyle = CustomTheme.components.Menu.baseStyle({ colorMode: 'dark' });

    expect(lightMenuBaseStyle.list).toMatchObject({
      bg: '#FFFFFF',
      borderColor: 'gray.200',
      color: '#333',
    });
    expect(lightMenuBaseStyle.item).toMatchObject({
      bg: '#FFFFFF',
      color: '#333',
      _focus: {
        bg: 'gray.100',
      },
      _hover: {
        bg: 'gray.100',
      },
    });
    expect(darkMenuBaseStyle.list).toMatchObject({
      bg: 'gray.900',
      borderColor: 'gray.700',
      color: 'gray.400',
    });
    expect(darkMenuBaseStyle.item).toMatchObject({
      bg: 'gray.900',
      color: 'gray.400',
      _focus: {
        bg: 'gray.700',
      },
      _hover: {
        bg: 'gray.700',
      },
    });
  });
});
