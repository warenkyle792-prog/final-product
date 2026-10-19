import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite dev server.
 *
 * The backend (Express + Socket.IO) is proxied so the browser only ever talks
 * to one origin — that keeps relative `/api` URLs working everywhere,
 * including the sandbox preview URL.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // The preview runs behind a proxy host, so accept any host header.
    allowedHosts: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:5000', ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
