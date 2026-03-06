import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Standalone build: bundles Three.js and all dependencies into a single
 * self-contained file (+ worker asset). For direct browser use via CDN
 * or <script> tag — no separate Three.js installation needed.
 *
 * Run AFTER the main build (which emits types + slim bundles):
 *   vite build && vite build --config vite.config.standalone.ts
 */
export default defineConfig({
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
        // Ensure OrbitControls addon is resolved correctly when bundled
        inlineDynamicImports: false,
      },
    },
    outDir: 'dist',
    emptyOutDir: false, // Preserve slim build output
    sourcemap: true,
    minify: 'esbuild',
    target: 'esnext',
  },
  worker: {
    format: 'es',
  },
});
