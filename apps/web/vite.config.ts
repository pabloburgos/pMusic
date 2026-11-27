import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { createPMusicApiHandler } from '@pmusic/providers';

function pmusicApiDevPlugin(): Plugin {
  const handler = createPMusicApiHandler();
  return {
    name: 'pmusic-api-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handler(req, res, next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void handler(req, res, next);
      });
    },
  };
}

export default defineConfig({
  base: process.env.VERCEL === '1' ? '/' : './',
  plugins: [react(), tailwindcss(), pmusicApiDevPlugin()],
  resolve: {
    alias: {
      '@pmusic/core': resolve(__dirname, '../../packages/core/src/index.ts'),
      '@pmusic/providers': resolve(__dirname, '../../packages/providers/src/index.ts'),
      '@pmusic/audio-engine': resolve(__dirname, '../../packages/audio-engine/src/index.ts'),
      '@pmusic/recommendations': resolve(__dirname, '../../packages/recommendations/src/index.ts'),
      '@pmusic/sync': resolve(__dirname, '../../packages/sync/src/index.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    cssMinify: 'esbuild',
  },
});
