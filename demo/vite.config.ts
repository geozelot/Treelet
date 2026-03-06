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
    port: 3000,
    open: true,
  },
  build: {
    outDir: resolve(__dirname, '../dist-demo'),
    emptyOutDir: true,
  },
});
