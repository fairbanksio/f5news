import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  preview: {
    port: 3000,
  },
  build: {
    outDir: 'build',
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    globals: true,
    setupFiles: './src/setupTests.js',
    coverage: {
      reporter: ['text'],
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/index.jsx', 'src/serviceWorker.js', 'src/reportWebVitals.js'],
    },
  },
});
