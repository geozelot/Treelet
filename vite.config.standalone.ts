import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Standalone build: bundles Three.js and all dependencies into a single
 * self-contained file. The tile worker is inlined (blob: URL), so the file
 * works from any CDN or <script> tag without serving extra assets.
 *
 * Run AFTER the main build (which emits types + slim bundles):
 *   vite build && vite build --config vite.config.standalone.ts
 */
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@treelet': resolve(__dirname, 'src'),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'Treelet',
      formats: ['iife'],
      fileName: () => `treelet.cdn.standalone.js`,
    },
    // Don't externalize anything — bundle Three.js + Comlink
    rollupOptions: {
      output: {
        exports: 'named',
        inlineDynamicImports: true,
      },
    },
    outDir: 'dist',
    emptyOutDir: false, // Preserve slim build output
    sourcemap: true,
    minify: 'esbuild',
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
});
