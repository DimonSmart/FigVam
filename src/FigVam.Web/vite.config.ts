import { defineConfig } from 'vite';

// Stable entry names preserve the existing ASP.NET static-resource routes while
// the remaining application modules are migrated.
export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: {
      entry: {
        'auth-client': 'src/api/auth-client.ts',
        'api-client': 'src/api/api-client.ts',
        session: 'src/core/session.ts',
        'home-ui': 'src/features/home/index.ts',
        'token-groups': 'src/core/tokens/token-groups.ts',
        'token-exchange': 'src/core/tokens/token-exchange.ts',
        'canvas-viewport': 'src/canvas/canvas-viewport.ts',
      },
      formats: ['es'],
      fileName: (_format, name) => name + '.js',
    },
    rollupOptions: {
      output: { chunkFileNames: '[name]-[hash].js' },
    },
  },
});
