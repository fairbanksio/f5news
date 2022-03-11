import React, {useContext, useEffect} from 'react';
import {
  ChakraProvider,
  Box,
  Flex
} from '@chakra-ui/react';
import { BrowserRouter as Router, Routes, Navigate, Route, useLocation } from 'react-router-dom';
import ReactGA from 'react-ga';
import MainContent from './Components/MainContent';
import { RefreshIntervalProvider} from './Contexts/RefreshIntervalContext'
import { SubredditProvider} from './Contexts/SubredditContext'
import CustomTheme from './Themes/CustomTheme'
import ClassicTheme from './Themes/ClassicTheme'
import Footer from './Components/Footer';
import Navbar from './Components/Navbar';
import { ThemeProvider, ThemeContext } from './Contexts/ThemeContext'
import { ViewModeProvider } from './Contexts/ViewModeContext'
import { LoadingProvider } from './Contexts/LoadingContext'
import { ModalProvider } from './Contexts/ModalContext'
import { MediaModal } from './Components/MediaModal'

ReactGA.initialize('G-S20H9JRLT9');

const ThemedApp = () => {
  const { theme } = useContext(ThemeContext)
  let location = useLocation();

  useEffect(() => {
    ReactGA.pageview(window.location.pathname + window.location.search);
  }, [location]);

  return (
    <ChakraProvider theme={theme === 'classic' ? ClassicTheme : CustomTheme}>
      <RefreshIntervalProvider>
        <SubredditProvider>
          <ViewModeProvider>
            <LoadingProvider>
              <ModalProvider>
                <Flex minHeight='100vh' direction='column' p={0}>
                  <Box>
                    <Navbar/>
                  </Box>
                  <Box flex='1'>
                    
                    <MediaModal/>
                    <MainContent/>
                  </Box>
                  <Box >
                    <Footer/>
                  </Box>
                </Flex>
              </ModalProvider>
            </LoadingProvider>
          </ViewModeProvider>
        </SubredditProvider>
      </RefreshIntervalProvider>
    </ChakraProvider>
  )
}

const App = () => {
  const defaultDest = localStorage.getItem('subreddit') ? localStorage.getItem('subreddit') : 'politics'
  return (
    <ThemeProvider>
      <Router>
        <Routes>
          <Route path="/r/:subredditPath" element={<ThemedApp/>} />
          <Route path="*" element={<Navigate to={"/r/" + defaultDest} replace />} />
        </Routes>
        
      </Router>
    </ThemeProvider>
  );
}

export default App;
