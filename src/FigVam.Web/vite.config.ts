import { defineConfig } from 'vite';

// Only the browser application and independent headless capture are entry points.
// All shared implementation modules are bundled through normal imports.
export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: {
      entry: {
        editor: 'src/app/editor.ts',
        'headless-preview': 'src/canvas/headless-preview.ts',
      },
      formats: ['es'],
      fileName: (_format, name) => name + '.js',
    },
    rollupOptions: {
      output: { chunkFileNames: 'figvam-chunk-[hash].js' },
    },
  },
});
