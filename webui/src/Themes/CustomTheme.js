
import { extendTheme } from '@chakra-ui/react';
import { mode } from "@chakra-ui/theme-tools";

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

const CustomTheme = extendTheme({
  config: {
    initialColorMode: 'dark',
    useSystemColorMode: false,
  },
  fonts: {
    heading: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    body: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  textStyles: {
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
  },
  semanticTokens: {
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
  },
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
  }
})

export default CustomTheme;
