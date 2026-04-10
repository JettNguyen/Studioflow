import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  envDir: '../../',
  plugins: [react()],
  server: {
    port: 5173
  },
  build: {
    // Emit source maps for production error tracing
    sourcemap: false,
    rollupOptions: {
      output: {
        /**
         * Manual chunk splitting:
         *  - vendor: React runtime (large, rarely changes — maximises CDN / browser cache hits)
         *  - router: React Router (medium, changes on version bumps)
         *  - app: everything else (your code — changes frequently)
         *
         * The hashed filenames Vite generates make these safe to cache forever,
         * and the service worker's cache-first strategy for /assets/* takes advantage of that.
         */
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
        }
      }
    }
  }
});
