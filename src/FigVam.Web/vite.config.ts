import { defineConfig } from 'vite';

// Stable entry names preserve the existing ASP.NET static-resource routes while
// the remaining application modules are migrated.
export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: {
      entry: {
        'auth-client': 'src/api/auth-client.ts',
        'decode': 'src/api/decode.ts',
        'api-client': 'src/api/api-client.ts',
        session: 'src/core/session.ts',
        'home-ui': 'src/features/home/index.ts',
        'token-resolution': 'src/core/tokens/token-resolution.ts',
        'token-groups': 'src/core/tokens/token-groups.ts',
        'token-exchange': 'src/core/tokens/token-exchange.ts',
        'canvas-viewport': 'src/canvas/canvas-viewport.ts',
        'layer-drag': 'src/canvas/layer-drag.ts',
        'canvas-node-editor': 'src/canvas/canvas-node-editor.ts',
        'screen-renderer': 'src/canvas/screen-renderer.ts',
        'document-collaboration': 'src/features/collaboration/document-collaboration.ts',
        'document-export': 'src/features/documents/document-export.ts',
        'padding-editor': 'src/ui/padding-editor.ts',
        'layer-caption': 'src/core/layer-caption.ts',
        'interaction-catalog': 'src/features/interactions/interaction-catalog.ts',
        'screen-resize': 'src/features/editor/screen-resize.ts',
      },
      formats: ['es'],
      fileName: (_format, name) => name + '.js',
    },
    rollupOptions: {
      output: { chunkFileNames: '[name]-[hash].js' },
    },
  },
});
