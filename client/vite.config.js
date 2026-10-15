import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app'],
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:5000', ws: true, changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:5000', changeOrigin: true }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    restoreMocks: true,
    testTimeout: 30000,
    hookTimeout: 30000
  }
});
