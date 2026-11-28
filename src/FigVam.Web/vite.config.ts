import { defineConfig, type Plugin } from 'vite';
import { icons } from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Materialize the installed Lucide catalog at build time. The canvas does not
// depend on React or dynamically load remote icon data.
function lucideCatalog(): Plugin {
  const id = 'virtual:figvam-lucide';
  return {
    name: 'figvam-lucide-catalog',
    resolveId(source) { return source === id ? '\0' + id : undefined; },
    load(source) {
      if (source !== '\0' + id) return;
      const catalog: Record<string, string> = {};
      for (const Icon of Object.values(icons)) {
        const svg = renderToStaticMarkup(createElement(Icon, { width: '100%', height: '100%' }));
        const name = /\bclass="lucide lucide-([a-z0-9-]+)"/.exec(svg)?.[1];
        if (name) catalog[name] = svg;
      }
      return 'export default ' + JSON.stringify(catalog);
    }
  };
}

// Only the browser application and independent headless capture are entry points.
// All shared implementation modules are bundled through normal imports.
export default defineConfig({
  plugins: [lucideCatalog()],
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
