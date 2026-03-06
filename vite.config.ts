import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      rollupTypes: true,
      outDir: 'dist/types',
    }),
  ],
  resolve: {
    alias: {
      '@treelet': resolve(__dirname, 'src'),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'Treelet',
      formats: ['es'],
      fileName: () => `treelet.es.js`,
    },
    rollupOptions: {
      external: ['three', /^three\//],
      output: {
        exports: 'named',
      },
    },
    sourcemap: true,
    minify: 'esbuild',
    target: 'esnext',
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'happy-dom',
  },
});
