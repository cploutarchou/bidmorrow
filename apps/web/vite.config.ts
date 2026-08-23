import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    // Consumed by apps/worker as its wrangler static-assets directory (../web/dist).
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Keep third-party runtime in its own chunk. It is the dominant,
        // irreducible part of the entry (React + React DOM + the router), it
        // changes far less often than app code, so isolating it lets browsers
        // reuse it across deploys — and it makes the marketing entry's own
        // first-party size measurable against the budget instead of hidden
        // behind the framework.
        manualChunks: (id) => (id.includes('node_modules') ? 'vendor' : undefined),
      },
    },
  },
  server: {
    proxy: {
      // Local development: forward API calls to `wrangler dev` (apps/worker).
      '/api': 'http://localhost:8787',
    },
  },
});
