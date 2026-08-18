
import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';

const originalLightColors = {
  bodyBg: 'white',
  bodyText: '#333',
  trending: '#ffd8b2',
  hot: '#ffbf7f',
  f5oclock: '#ffa64c',
  f5oclockStrong: '#ff8c1a',
  f5oclockPeak: '#e67300',
  link: '#337ab7',
  navbar: '#FFFFFF',
};

const mode = (light, dark) => props => (props?.colorMode === 'dark' ? dark : light);

const textStyles = {
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
  listTitle: {
    fontSize: 'sm',
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
  body: {
    fontSize: 'sm',
    fontWeight: 'normal',
    lineHeight: 'base',
  },
  support: {
    fontSize: 'sm',
    fontWeight: 'medium',
    lineHeight: 'short',
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
  control: {
    fontSize: 'sm',
    fontWeight: 'semibold',
  },
};

const semanticTokens = {
  colors: {
    textPrimary: {
      default: originalLightColors.bodyText,
      _dark: 'gray.400',
    },
    textMuted: {
      default: 'gray.500',
      _dark: 'gray.500',
    },
    textSubtle: {
      default: 'gray.500',
      _dark: 'gray.500',
    },
    trending: {
      default: originalLightColors.trending,
      _dark: '#161938',
    },
    hot: {
      default: originalLightColors.hot,
      _dark: '#16284f',
    },
    f5oclock: {
      default: originalLightColors.f5oclock,
      _dark: 'blue.900',
    },
    f5oclockStrong: {
      default: originalLightColors.f5oclockStrong,
      _dark: 'blue.800',
    },
    f5oclockPeak: {
      default: originalLightColors.f5oclockPeak,
      _dark: 'blue.700',
    },
    link: {
      default: originalLightColors.link,
      _dark: '#adbbcd',
    },
    footerLink: {
      default: 'textPrimary',
      _dark: 'textPrimary',
    },
    navbar: {
      default: originalLightColors.navbar,
      _dark: 'gray.900',
    },
  },
};

const tokenValue = value => {
  if (value.startsWith('#')) {
    return value;
  }

  return `{colors.${value}}`;
};

const chakraSemanticTokens = {
  colors: Object.fromEntries(
    Object.entries(semanticTokens.colors).map(([key, value]) => [
      key,
      {
        DEFAULT: {
          value: {
            _light: tokenValue(value.default),
            _dark: tokenValue(value._dark),
          },
        },
      },
    ])
  ),
};

const chakraConfig = defineConfig({
  globalCss: {
    'html, body, #root': {
      minHeight: '100%',
    },
    body: {
      bg: { _light: originalLightColors.bodyBg, _dark: 'gray.900' },
      color: { _light: originalLightColors.bodyText, _dark: 'gray.400' },
    },
  },
  theme: {
    tokens: {
      fonts: {
        heading: {
          value: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        body: {
          value: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
      },
      colors: {
        gray: {
          50: { value: '#F7FAFC' },
          100: { value: '#EDF2F7' },
          200: { value: '#E2E8F0' },
          300: { value: '#CBD5E0' },
          400: { value: '#A0AEC0' },
          500: { value: '#718096' },
          600: { value: '#4A5568' },
          700: { value: '#2D3748' },
          800: { value: '#1A202C' },
          900: { value: '#171923' },
        },
        blue: {
          700: { value: '#2B6CB0' },
          800: { value: '#2C5282' },
          900: { value: '#1A365D' },
        },
      },
    },
    semanticTokens: chakraSemanticTokens,
    textStyles,
  },
});

const CustomTheme = {
  config: {
    initialColorMode: 'dark',
    useSystemColorMode: false,
  },
  fonts: {
    heading: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    body: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  textStyles,
  semanticTokens,
  components: {
    Button: {
      baseStyle: {
        fontWeight: 'semibold',
        letterSpacing: 0,
      },
      sizes: {
        sm: {
          fontSize: 'sm',
          lineHeight: 'short',
        },
      },
    },
    Menu: {
      baseStyle: (props) => ({
        list: {
          bg: mode(originalLightColors.navbar, 'gray.900')(props),
          borderColor: mode('gray.200', 'gray.700')(props),
          color: mode(originalLightColors.bodyText, 'gray.400')(props),
          boxShadow: 'lg',
          py: 1,
        },
        item: {
          bg: mode(originalLightColors.navbar, 'gray.900')(props),
          color: mode(originalLightColors.bodyText, 'gray.400')(props),
          fontSize: 'sm',
          fontWeight: 'medium',
          _active: {
            bg: mode('gray.100', 'gray.700')(props),
          },
          _focus: {
            bg: mode('gray.100', 'gray.700')(props),
          },
          _hover: {
            bg: mode('gray.100', 'gray.700')(props),
          },
        },
      }),
    },
  },
  styles: {
    global: (props) => ({
      body: {
        bg: mode(originalLightColors.bodyBg,'gray.900')(props),
        color: mode(originalLightColors.bodyText,'gray.400')(props),
      }
    })
  },
  system: createSystem(defaultConfig, chakraConfig),
};

export default CustomTheme;
