import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { matchMedia, setMedia } from 'mock-match-media';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: matchMedia,
});

setMedia({
  widthPx: 1024,
  heightPx: 768,
  mediaType: 'screen',
});

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: TestResizeObserver,
});

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: TestResizeObserver,
});

const createTestStorage = () => {
  let store = {};

  return {
    getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: key => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: index => Object.keys(store)[index] || null,
    get length() {
      return Object.keys(store).length;
    },
  };
};

const testStorage = createTestStorage();

Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: testStorage,
});

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: testStorage,
});

globalThis.jest = vi;
