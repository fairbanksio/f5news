
import { extendTheme } from '@chakra-ui/react';
import { mode } from "@chakra-ui/theme-tools";

const ClassicTheme = extendTheme({
  initialColorMode: 'system',
  components: {
    Box: {
      variants: {
        'navbar': {
          bg: '#FFF',
          boxShadow: '0 0 2px 0 #efdfde',
        },
      },
    },
  },
  semanticTokens: {
    colors: {
      trending: {
        default: '#ffd8b2', 
        _dark: '#ffd8b2',
      },
      hot: {
        default: '#ffbf7f', 
        _dark: '#ffbf7f',
      },
      f5oclock: {
        default: '#ffa64c', 
        _dark: '#ffa64c',
      },
      link: {
        default: '#337ab7', 
        _dark: '#337ab7',
      },
      navbar: {
        default: '#FFFFFF', 
        _dark: '#222222',
      }
    },
  },
  colors: {
    brand: {
      100: "#FFF",
      // ...
      900: "#1a202c",
    },
  },
  styles: {
    Modal: { sizes: { 'xl': { Content: { maxWidth: "10px" }, }, }, },
    global: (props) => ({
      body: {
        bg: mode('white','#222222')(props),
        color: mode('#333','#888')(props),
      }
    })
  }
})

export default ClassicTheme;