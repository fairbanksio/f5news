import React, {useEffect} from 'react';
import {
  ChakraProvider,
  Box,
  Flex
} from '@chakra-ui/react';
import { BrowserRouter as Router, Routes, Navigate, Route, useLocation } from 'react-router-dom';
import MainContent from './Components/MainContent';
import { RefreshIntervalProvider} from './Contexts/RefreshIntervalContext'
import { SubredditProvider} from './Contexts/SubredditContext'
import CustomTheme from './Themes/CustomTheme'
import Footer from './Components/Footer';
import Navbar from './Components/Navbar';
import { ThemeProvider } from './Contexts/ThemeContext'
import { ViewModeProvider } from './Contexts/ViewModeContext'
import { LoadingProvider } from './Contexts/LoadingContext'
import { ModalProvider } from './Contexts/ModalContext'
import { MediaModal } from './Components/MediaModal'
import { initializeAnalytics, trackPageView } from './analytics';



const ThemedApp = () => {
  let location = useLocation();

  useEffect(() => {
    initializeAnalytics();
  }, []);

  useEffect(() => {
    trackPageView(location);
  }, [location]);

  return (
    <ChakraProvider theme={CustomTheme}>
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
