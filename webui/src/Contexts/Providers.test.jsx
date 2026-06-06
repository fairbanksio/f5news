import React, { useContext } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '../test-utils';
import {
  RefreshIntervalContext,
  RefreshIntervalProvider,
} from './RefreshIntervalContext';
import { ViewModeContext, ViewModeProvider } from './ViewModeContext';
import { ThemeContext, ThemeProvider } from './ThemeContext';
import { LoadingContext, LoadingProvider } from './LoadingContext';
import { ModalContext, ModalProvider } from './ModalContext';

afterEach(() => {
  localStorage.clear();
});

test('refresh interval provider reads and persists localStorage values', () => {
  localStorage.setItem('refreshInterval', '120');

  const Probe = () => {
    const { refreshInterval, setRefreshInterval } = useContext(RefreshIntervalContext);
    return (
      <button onClick={() => setRefreshInterval(60)}>
        refresh {refreshInterval}
      </button>
    );
  };

  render(
    <RefreshIntervalProvider>
      <Probe />
    </RefreshIntervalProvider>
  );

  fireEvent.click(screen.getByRole('button', { name: /refresh 120/i }));

  expect(screen.getByRole('button', { name: /refresh 60/i })).toBeInTheDocument();
  expect(localStorage.getItem('refreshInterval')).toBe('60');
});

test('view mode provider reads and persists localStorage values', () => {
  localStorage.setItem('viewMode', 'list');

  const Probe = () => {
    const { viewMode, setViewMode } = useContext(ViewModeContext);
    return <button onClick={() => setViewMode('grid')}>view {viewMode}</button>;
  };

  render(
    <ViewModeProvider>
      <Probe />
    </ViewModeProvider>
  );

  fireEvent.click(screen.getByRole('button', { name: /view list/i }));

  expect(screen.getByRole('button', { name: /view grid/i })).toBeInTheDocument();
  expect(localStorage.getItem('viewMode')).toBe('grid');
});

test('theme provider reads and persists localStorage values', () => {
  localStorage.setItem('theme', 'classic');

  const Probe = () => {
    const { theme, setTheme } = useContext(ThemeContext);
    return <button onClick={() => setTheme('custom')}>theme {theme}</button>;
  };

  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );

  fireEvent.click(screen.getByRole('button', { name: /theme classic/i }));

  expect(screen.getByRole('button', { name: /theme custom/i })).toBeInTheDocument();
  expect(localStorage.getItem('theme')).toBe('custom');
});

test('loading provider exposes mutable loading state', () => {
  const Probe = () => {
    const { loading, setLoading } = useContext(LoadingContext);
    return (
      <button onClick={() => setLoading(true)}>
        loading {loading ? 'yes' : 'no'}
      </button>
    );
  };

  render(
    <LoadingProvider>
      <Probe />
    </LoadingProvider>
  );

  fireEvent.click(screen.getByRole('button', { name: /loading no/i }));

  expect(screen.getByRole('button', { name: /loading yes/i })).toBeInTheDocument();
});

test('modal provider exposes mutable modal data', () => {
  const Probe = () => {
    const { modalData, setModalData } = useContext(ModalContext);
    return (
      <button onClick={() => setModalData({ title: 'Preview item' })}>
        modal {modalData ? modalData.title : 'empty'}
      </button>
    );
  };

  render(
    <ModalProvider>
      <Probe />
    </ModalProvider>
  );

  fireEvent.click(screen.getByRole('button', { name: /modal empty/i }));

  expect(screen.getByRole('button', { name: /modal preview item/i })).toBeInTheDocument();
});
