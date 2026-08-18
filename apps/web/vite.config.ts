import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    // Consumed by apps/worker as its wrangler static-assets directory (../web/dist).
    outDir: 'dist',
  },
  server: {
    proxy: {
      // Local development: forward API calls to `wrangler dev` (apps/worker).
      '/api': 'http://localhost:8787',
    },
  },
});
