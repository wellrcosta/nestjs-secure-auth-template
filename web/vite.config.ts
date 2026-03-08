import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev server proxies API routes so the browser sees a single origin.
// This avoids CORS and makes httpOnly cookie flows easy to test.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/auth': {
        target: 'http://api:3000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://api:3000',
        changeOrigin: true,
      },
    },
  },
});
