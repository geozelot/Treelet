import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Standalone tile worker (`dist/treelet.worker.js`) for deployments whose
 * Content-Security-Policy forbids `blob:` workers. Serve it from your own
 * origin and pass its URL as the `workerUrl` option.
 */
export default defineConfig({
  base: './',
  build: {
    lib: {
      entry: resolve(__dirname, 'src/workers/tileWorker.ts'),
      formats: ['es'],
      fileName: () => `treelet.worker.js`,
    },
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    minify: 'esbuild',
    target: 'es2022',
  },
});
