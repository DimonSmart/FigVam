import { defineConfig } from 'vite';

// Stable entry names preserve the existing ASP.NET static-resource routes while
// the remaining application modules are migrated.
export default defineConfig({
  build: {
    lib: {
      entry: {
        'auth-client': 'src/api/auth-client.ts',
        'api-client': 'src/api/api-client.ts',
        session: 'src/core/session.ts',
      },
      formats: ['es'],
      fileName: (_format, name) => name + '.js',
    },
    rollupOptions: {
      output: { chunkFileNames: '[name]-[hash].js' },
    },
  },
});
