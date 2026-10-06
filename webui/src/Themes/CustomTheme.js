
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
  shadows: {
    xs: { value: "0 0 0 1px rgba(0, 0, 0, 0.05)" },
    sm: { value: "0 1px 2px 0 rgba(0, 0, 0, 0.05)" },
    base: { value: "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)" },
    md: { value: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)" },
    lg: { value: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)" },
    xl: { value: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)" },
    "2xl": { value: "0 25px 50px -12px rgba(0, 0, 0, 0.25)" },
    outline: { value: "0 0 0 3px rgba(66, 153, 225, 0.6)" },
    inner: { value: "inset 0 2px 4px 0 rgba(0,0,0,0.06)" },
    none: { value: "none" },
    "dark-lg": { value: "rgba(0, 0, 0, 0.1) 0px 0px 0px 1px, rgba(0, 0, 0, 0.2) 0px 5px 10px, rgba(0, 0, 0, 0.4) 0px 15px 40px" },
      },
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
      lineHeight: 'base',
      transitionProperty: 'background-color',
      transitionDuration: '0.2s',
    },
  },
  theme: {
    tokens: {
      sizes: { container: { xl: { value: '1280px' } } },
      lineHeights: {
        shorter: { value: 1.25 },
        short: { value: 1.375 },
        base: { value: 1.5 },
        4: { value: '1rem' },
        5: { value: '1.25rem' },
        6: { value: '1.5rem' },
        tall: { value: 1.625 },
        taller: { value: 2 },
      },
      letterSpacings: { wide: { value: '0.025em' } },
      fonts: {
        heading: {
          value: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        body: {
          value: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
      },
      colors: {
        red: {
          100: { value: '#FED7D7' },
          200: { value: '#FEB2B2' },
          600: { value: '#C53030' },
        },
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
          200: { value: '#90CDF4' },
          500: { value: '#3182CE' },
          700: { value: '#2B6CB0' },
          800: { value: '#2C5282' },
          900: { value: '#1A365D' },
        },
      },
    },
    semanticTokens: chakraSemanticTokens,
    textStyles: Object.fromEntries(Object.entries(textStyles).map(([name, value]) => [name, { value }])),
    recipes: {
      button: {
        base: {
          fontWeight: 'semibold',
          letterSpacing: 0,
          borderRadius: '0.375rem',
          lineHeight: 1.2,
          borderWidth: 0,
          _disabled: { opacity: 0.4 },
          _focusVisible: { outline: 0, boxShadow: '0 0 0 3px rgba(66, 153, 225, 0.6)' },
        },
        variants: {
          size: {
            xs: { h: 6, minW: 6, px: 2, fontSize: 'xs' },
            sm: { h: 8, minW: 8, px: 3, fontSize: 'sm', lineHeight: 'short', gap: 0, _icon: { width: '1em', height: '1em' } },
            md: { h: 10, minW: 10, px: 4, fontSize: 'md' },
            lg: { h: 12, minW: 12, px: 6, fontSize: 'lg' },
          },
          variant: {
            solid: {
              bg: { _light: 'gray.100', _dark: 'whiteAlpha.200' },
              color: { _light: 'gray.800', _dark: 'whiteAlpha.900' },
              _hover: { bg: { _light: 'gray.200', _dark: 'whiteAlpha.300' } },
              _active: { bg: { _light: 'gray.300', _dark: 'whiteAlpha.400' } },
            },
            ghost: {
              bg: 'transparent',
              color: { _light: 'gray.800', _dark: 'whiteAlpha.900' },
              _hover: { bg: { _light: 'gray.100', _dark: 'whiteAlpha.200' } },
              _active: { bg: { _light: 'gray.200', _dark: 'whiteAlpha.300' } },
            },
          },
        },
        defaultVariants: { size: 'md', variant: 'solid' },
      },
      badge: {
        base: { display: 'inline-block', borderRadius: '0.125rem', textTransform: 'uppercase', fontWeight: 'bold' },
        variants: {
          size: { sm: { px: 1, minH: 0, lineHeight: 'base' } },
          variant: { subtle: { color: { _light: 'gray.800', _dark: 'gray.200' } } },
        },
      },
      heading: { base: { fontWeight: 'bold', letterSpacing: 'normal' } },
      link: { base: { display: 'inline', borderRadius: 0 } },
      separator: { base: { borderColor: { _light: 'gray.200', _dark: 'whiteAlpha.300' }, opacity: 0.6 } },
    },
    slotRecipes: {
      tooltip: {
        base: {
          content: {
            '--tooltip-bg': { _light: 'colors.gray.700', _dark: 'colors.gray.300' },
            color: { _light: 'whiteAlpha.900', _dark: 'gray.900' },
            px: 2, py: 0.5, borderRadius: '0.125rem', fontSize: 'sm',
            fontWeight: 'medium', lineHeight: 'base', boxShadow: 'md',
          },
        },
      },
      alert: {
        base: {
          root: { alignItems: 'center', borderRadius: 0, gap: 0 },
          title: { fontWeight: 'bold', lineHeight: '6', marginEnd: 2 },
          description: { lineHeight: '6' },
          indicator: { w: 5, h: 6, marginEnd: 3, color: { _light: 'red.600', _dark: 'red.200' } },
        },
        variants: {
          size: { md: { root: { px: 4, py: 3, fontSize: 'md', lineHeight: 'base', gap: 0 } } },
          variant: { subtle: { root: { bg: 'var(--alert-bg, var(--chakra-colors-color-palette-subtle))', color: 'inherit' } } },
          status: { error: { root: { '--alert-bg': { _light: 'colors.red.100', _dark: 'rgba(254, 178, 178, 0.16)' } } } },
        },
      },
      progress: {
        variants: { variant: { outline: {
          track: { shadow: 'none', bgColor: { _light: 'gray.100', _dark: 'whiteAlpha.300' } },
          range: { bgColor: { _light: 'blue.500', _dark: 'blue.200' } },
        }, subtle: {
          track: { bgColor: { _light: 'gray.100', _dark: 'whiteAlpha.300' } },
          range: { bgColor: { _light: 'blue.500', _dark: 'blue.200' } },
        } } },
        base: {
          track: { bg: { _light: 'gray.100', _dark: 'whiteAlpha.300' } },
          range: {
            '--track-color': { _light: 'colors.blue.500', _dark: 'colors.blue.200' },
            bg: { _light: 'blue.500', _dark: 'blue.200' },
          },
        },
      },
      table: {
        base: {
          columnHeader: { fontFamily: 'heading', fontWeight: 'semibold', textTransform: 'uppercase', letterSpacing: 'wide', color: 'gray.500' },
        },
        variants: {
          size: { sm: {
            columnHeader: { px: 4, py: 1, fontSize: 'xs', lineHeight: '4' },
            cell: { px: 4, py: 2, fontSize: 'sm', lineHeight: '4' },
          } },
          variant: { line: {
            row: { bg: 'transparent' },
            columnHeader: { borderColor: { _light: 'gray.100', _dark: 'gray.700' } },
            cell: { borderColor: { _light: 'gray.100', _dark: 'gray.700' } },
          } },
        },
      },
      menu: {
        variants: {
          size: {
            md: {
              content: { minW: '14rem', padding: '4px 0', px: 0, py: 1 },
              item: { px: 3, py: 1.5, gap: 2, textStyle: 'body' },
            },
          },
          variant: {
            subtle: { item: { _highlighted: { bg: { _light: 'gray.100', _dark: 'gray.700' } } } },
          },
        },
        base: {
          itemGroupLabel: { px: 0, py: 0, mx: 4, my: 2, fontSize: 'sm', lineHeight: 'base', fontWeight: 'semibold' },
          separator: { my: 2, mx: 0, bg: 'currentColor', opacity: 0.6 },
          content: {
            bg: 'navbar', color: 'textPrimary', borderWidth: '1px',
            borderColor: { _light: 'gray.200', _dark: 'gray.700' },
            borderRadius: '0.375rem', boxShadow: 'lg', minW: '14rem', py: 1,
          },
          item: {
            bg: 'navbar', color: 'textPrimary', px: 3, py: 1.5,
            '&[data-type]': { ps: 3 },
            fontSize: 'sm', fontWeight: 'medium', borderRadius: 0,
            _highlighted: { bg: { _light: 'gray.100', _dark: 'gray.700' }, color: 'textPrimary' },
          },
        },
      },
    },
  },
});

const CustomTheme = {
  config: {
    initialColorMode: 'dark',
    useSystemColorMode: false,
  },
  system: createSystem(defaultConfig, chakraConfig),
};

export default CustomTheme;
