import React, {useEffect, useContext, lazy, Suspense} from 'react';
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
import { ModalProvider, ModalContext } from './Contexts/ModalContext'
import { initializeAnalytics, trackPageView } from './analytics';
import { ColorModeProvider } from './Contexts/ColorModeContext';

const LazyMediaModal = lazy(() => import('./Components/MediaModal').then(module => ({ default: module.MediaModal })));

const ActiveMediaModal = () => {
  const { modalData } = useContext(ModalContext);
  return modalData ? <Suspense fallback={null}><LazyMediaModal /></Suspense> : null;
};



const ThemedApp = () => {
  let location = useLocation();

  useEffect(() => {
    initializeAnalytics();
  }, []);

  useEffect(() => {
    trackPageView(location);
  }, [location]);

  return (
    <ChakraProvider value={CustomTheme.system}>
      <ColorModeProvider initialColorMode={CustomTheme.config.initialColorMode}>
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
                    <ActiveMediaModal/>
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
      </ColorModeProvider>
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
