import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Theme } from '@chakra-ui/react';

const ColorModeContext = createContext({
  colorMode: 'dark',
  toggleColorMode: () => {},
});

const COLOR_MODE_STORAGE_KEY = 'chakra-ui-color-mode';

const normalizeColorMode = value => (value === 'light' ? 'light' : 'dark');

const getStoredColorMode = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(COLOR_MODE_STORAGE_KEY);
  } catch {
    return null;
  }
};

const persistColorMode = colorMode => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, colorMode);
  } catch {
    // Non-persistent storage should not prevent the UI from changing mode.
  }
};

export const ColorModeProvider = ({ children, initialColorMode = 'dark' }) => {
  const [colorMode, setColorMode] = useState(() => (
    normalizeColorMode(getStoredColorMode() || initialColorMode)
  ));

  useEffect(() => {
    document.documentElement.classList.toggle('dark', colorMode === 'dark');
    document.documentElement.classList.toggle('light', colorMode === 'light');
    document.body.classList.toggle('chakra-ui-dark', colorMode === 'dark');
    document.body.classList.toggle('chakra-ui-light', colorMode === 'light');
    persistColorMode(colorMode);
  }, [colorMode]);

  const value = useMemo(
    () => ({
      colorMode,
      toggleColorMode: () => setColorMode(current => (current === 'dark' ? 'light' : 'dark')),
    }),
    [colorMode]
  );

  return (
    <ColorModeContext.Provider value={value}>
      <Theme appearance={colorMode} hasBackground={false} minH="100vh" bg="transparent" color="textPrimary">
        {children}
      </Theme>
    </ColorModeContext.Provider>
  );
};

export const useColorMode = () => useContext(ColorModeContext);

export const useColorModeValue = (light, dark) => {
  const { colorMode } = useColorMode();
  return colorMode === 'dark' ? dark : light;
};
