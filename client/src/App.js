import React, {useContext} from 'react';
import {
  ChakraProvider,
  Box,
  Flex
} from '@chakra-ui/react';
import PostView from './Components/PostView';
import { RefreshIntervalProvider} from './Contexts/RefreshIntervalContext'
import { SubredditProvider} from './Contexts/SubredditContext'
import CustomTheme from './Themes/CustomTheme'
import ClassicTheme from './Themes/ClassicTheme'
import Footer from './Components/Footer';
import Navbar from './Components/Navbar';
import { ThemeProvider, ThemeContext } from './Contexts/ThemeContext'

const ThemedApp = () => {
  const { theme } = useContext(ThemeContext)

  return (
      <ChakraProvider theme={theme == 'classic' ? ClassicTheme : CustomTheme}>
        <RefreshIntervalProvider>
          <SubredditProvider>
            <Flex minHeight='100vh' direction='column' p={0}>
              <Box>
                <Navbar/>
              </Box>
              <Box flex='1'>
                <PostView/>
              </Box>
              <Box >
                <Footer/>
              </Box>
            </Flex>
          </SubredditProvider>
        </RefreshIntervalProvider>
      </ChakraProvider>
  )
}

const App = () => {
  return (
    <ThemeProvider>
      <ThemedApp/>
    </ThemeProvider>
  );
}

export default App;
