import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname),
  base: process.env.BASE_PATH ?? '/',
  resolve: {
    alias: {
      '@treelet': resolve(__dirname, '../src'),
    },
  },
  server: {
    port: Number(process.env.PORT) || 3000,
    open: !process.env.PORT,
    proxy: {
      '/cog-proxy': {
        target: 'https://copernicus-dem-90m.s3.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cog-proxy/, ''),
      },
    },
  },
  build: {
    outDir: resolve(__dirname, '../dist-demo'),
    emptyOutDir: true,
  },
});
