import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    proxy: {
      // In dev, proxy /api/anilist directly to AniList (no separate server needed)
      '/api/anilist': {
        target: 'https://graphql.anilist.co',
        changeOrigin: true,
        rewrite: () => '/',
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('User-Agent', 'AniWave/2.0 (https://aniwave.fun)');
          });
        },
      },
      // In dev, proxy /api/kiwi to miruro directly
      '/api/kiwi': {
        target: 'https://miruro-nine-navy.vercel.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kiwi\/([^/]+)\/([^/]+)\/(.+)$/, '/watch/kiwi/$1/$2/$3'),
      },
      // All other /api routes go to local Express server
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  css: {
    postcss: './postcss.config.js',
  },
});
