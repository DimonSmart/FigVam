// Tests for implementation modules must not require separately published production
// entry points. Bundle the real TypeScript source into isolated test-only modules.
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const frontend = resolve(__dirname, '../../src/FigVam.Web');
const entries = {
  'token-groups': 'src/core/tokens/token-groups.ts',
  'token-exchange': 'src/core/tokens/token-exchange.ts',
  'token-resolution': 'src/core/tokens/token-resolution.ts',
  'node-property-controls': 'src/ui/node-property-controls.ts',
  'padding-editor': 'src/ui/padding-editor.ts',
};
const cache = new Map();
function bundle(name) {
  if (!Object.hasOwn(entries, name)) throw new Error('Unknown frontend test module: ' + name);
  if (!cache.has(name)) cache.set(name, (async () => {
    const { build } = await import(pathToFileURL(require.resolve('vite', { paths: [frontend] })).href);
    const result = await build({
      root: frontend, configFile: false, logLevel: 'error',
      build: { write: false, minify: false,
        lib: { entry: resolve(frontend, entries[name]), formats: ['es'], fileName: name },
        rollupOptions: { output: { inlineDynamicImports: true } } }
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(x => x.output);
    const chunks = outputs.filter(x => x.type === 'chunk');
    if (chunks.length !== 1 || chunks[0].imports.length)
      throw new Error('Expected a self-contained test module: ' + name);
    return chunks[0].code;
  })());
  return cache.get(name);
}
async function importFrontendModule(name) {
  return import('data:text/javascript;base64,' + Buffer.from(await bundle(name)).toString('base64'));
}
async function exposeFrontendModules(page, ...names) {
  for (const name of names) {
    const body = await bundle(name);
    await page.route('**/__figvam-test/' + name + '.js', route =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body }));
  }
}
module.exports = { importFrontendModule, exposeFrontendModules };
