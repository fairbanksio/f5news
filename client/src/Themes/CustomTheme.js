
import { extendTheme } from '@chakra-ui/react';
import { mode } from "@chakra-ui/theme-tools";

const CustomTheme = extendTheme({
  initialColorMode: 'system',
  semanticTokens: {
    colors: {
      trending: {
        default: '#adbbcd', 
        _dark: '#161938',
      },
      hot: {
        default: '#566c8b', 
        _dark: '#16284f',
      },
      f5oclock: {
        default: 'blue.800', 
        _dark: 'blue.900',
      },
      link: {
        default: 'blue.800', 
        _dark: 'blue.500',
      },
      navbar: {
        default: 'gray.300', 
        _dark: 'gray.900',
      },
    },
  },
  styles: {
    global: (props) => ({
      body: {
        bg: mode('gray.300','gray.900')(props),
        color: mode('gray.700','gray.400')(props),
      }
    })
  }
})

export default CustomTheme;