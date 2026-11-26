import { renderScreen } from './screen-renderer.js';

const fail = code => Object.assign(new Error(code), { code });
const cancelled = () => new DOMException('Cancelled', 'AbortError');
const maxBytes = 5 * 1024 * 1024;

async function dataUrl(blob, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(cancelled());
    const reader = new FileReader();
    const abort = () => reader.abort();
    signal.addEventListener('abort', abort, { once: true });
    reader.onloadend = () => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(cancelled());
      else if (reader.error || typeof reader.result !== 'string') reject(fail('CAPTURE_FAILED'));
      else resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}

// Use the exact Preview renderer and revision-pinned REST resources. The
// temporary surface is outside the editor and never receives user input.
async function renderPng(request, base, task, theme, signal) {
  const { screenId: screen, revision, width, height } = task;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > 4096 || height > 4096 || width * height > 4 * 1024 * 1024) throw fail('IMAGE_TOO_LARGE');
  async function read(path, params = {}) {
    const result = await request(base + '/' + path + '?' + new URLSearchParams({ revision, ...params }), {}, signal);
    if (result.revision !== revision) throw fail('RENDER_REVISION_MISMATCH');
    return result;
  }
  async function pages(path, params, field) {
    const items = [], overrides = [];
    let total;
    do {
      const page = await read(path, { ...params, offset: items.length, limit: 100 });
      if (!Array.isArray(page[field]) || !Number.isSafeInteger(page.total) || page.offset !== items.length ||
          (!page[field].length && items.length < page.total)) throw fail('CAPTURE_FAILED');
      total = page.total;
      items.push(...page[field]); overrides.push(...(page.overrides ?? []));
    } while (items.length < total);
    return { items, overrides };
  }
  const [info, profile, manifest, tokenList, structure] = await Promise.all([
    read('screens/' + screen, { fields: 'dimensions' }), read('profile'), read('assets'),
    pages('tokens', {}, 'items'),
    pages('nodes', { screenId: screen, fields: 'kind,properties,name,parentId,childCount,canContainChildren' }, 'items')
  ]);
  const dimensions = info.items[0]?.dimensions;
  if (!dimensions || Math.ceil(dimensions.width) !== width || Math.ceil(dimensions.height) !== height)
    throw fail('CAPTURE_FAILED');
  const layout = await pages('screens/' + screen + '/layout',
    { previewWidth: dimensions.width, previewHeight: dimensions.height, theme }, 'boxes');
  const overrides = new Map(layout.overrides.map(item => [item.nodeId, item.properties]));
  const model = {
    screen, theme, overrides,
    nodes: new Map(structure.items.map(node => [node.id, { ...node, properties: { ...node.properties, ...overrides.get(node.id) } }])),
    boxes: new Map(layout.items.map(box => [box.objectId, box])),
    kinds: new Map(profile.kinds.map(kind => [kind.kind, kind])),
    assets: new Map(manifest.assets.map(asset => [asset.id, asset])),
    tokens: new Map(tokenList.items.map(token => [token.id, token]))
  };
  return renderModelPng(model, width, height,
    assetId => request.readPng(base + '/assets/' + assetId + '?revision=' + revision, {}, signal), {}, signal);
}

// Shared renderer for browser-backed MCP capture and server-owned headless Preview.
export async function renderModelPng(model, width, height, loadAsset, values, signal) {
  if (!model.boxes.has(model.screen)) throw fail('CAPTURE_FAILED');
  const drawing = renderScreen(model, { preview: true, report() {}, trigger() {}, setInput() {},
    getInput: (id, fallback) => Object.hasOwn(values, id) ? (values[id] ?? '') : fallback });
  const host = document.createElement('div');
  host.className = 'preview-screen';
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', width: width + 'px',
    height: height + 'px', overflow: 'hidden', pointerEvents: 'none' });
  host.append(drawing.root);
  // Append only the isolated surface so CSS and native form controls resolve
  // just as in Preview. No scroll, focus, zoom or selected screen changes.
  document.body.append(host);
  const urls = [];
  try {
    await Promise.all(drawing.images.map(async ({ assetId, surface }) => {
      const blob = await loadAsset(assetId);
      const url = URL.createObjectURL(blob); urls.push(url);
      surface.src = url; await surface.decode();
      surface.dataset.captureSrc = await dataUrl(blob, signal);
    }));
    await document.fonts.ready;
    if (signal.aborted) throw cancelled();
    const clone = host.cloneNode(true);
    const originals = [host, ...host.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    // Freeze computed CSS (including native controls), not editor chrome.
    // SVG image documents cannot reference external stylesheets or blob assets.
    for (let i = 0; i < originals.length; i++) {
      const source = originals[i], target = copies[i], computed = getComputedStyle(source);
      target.removeAttribute('style');
      for (const name of computed) {
        if (!name.startsWith('--')) target.style.setProperty(name, computed.getPropertyValue(name));
      }
      if (source.matches('input, textarea')) {
        if (source.tagName === 'INPUT') target.setAttribute('value', source.value);
        else target.textContent = source.value;
      }
      if (source.dataset.captureSrc) {
        target.setAttribute('src', source.dataset.captureSrc);
        delete target.dataset.captureSrc;
      }
    }
    Object.assign(clone.style, { position: 'relative', left: '0px', top: '0px', right: 'auto', bottom: 'auto',
      width: width + 'px', height: height + 'px', margin: '0', overflow: 'hidden' });
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
      '"><foreignObject width="100%" height="100%">' + new XMLSerializer().serializeToString(clone) + '</foreignObject></svg>';
    // Chromium taints canvas for Blob SVGs with foreignObject; a self-contained
    // data image is origin-clean. No external resources or script are loaded.
    const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await image.decode();
    if (signal.aborted) throw cancelled();
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    try {
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw fail('CAPTURE_FAILED');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0);
      const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (signal.aborted) throw cancelled();
      if (!png || png.type !== 'image/png') throw fail('CAPTURE_FAILED');
      if (png.size > maxBytes) throw fail('IMAGE_TOO_LARGE');
      return png;
    } finally { canvas.width = canvas.height = 0; }
  } finally {
    host.remove();
    for (const url of urls) URL.revokeObjectURL(url);
  }
}

export function createScreenCapture({ request, getContext }) {
  let current = null;
  const same = operation => {
    const context = getContext();
    return context.documentId === operation.documentId && context.token === operation.token &&
      context.navigationEpoch === operation.navigationEpoch && ['Owner', 'Editor'].includes(context.role);
  };
  const active = operation => current === operation && !operation.controller.signal.aborted && same(operation);
  function stop() {
    const operation = current; current = null;
    if (!operation) return;
    operation.signal.removeEventListener('abort', operation.abort);
    operation.controller.abort();
    operation.pending?.controller.abort();
  }
  async function handle(operation, task) {
    if (!active(operation) || operation.pending || task.documentId !== operation.documentId) return;
    const controller = new AbortController();
    const pending = { id: task.requestId, controller };
    operation.pending = pending;
    const abort = () => controller.abort();
    operation.controller.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 8000);
    const theme = task.theme ?? getContext().theme ?? 'Light';
    let png, code;
    try { png = await renderPng(request, operation.base, task, theme, controller.signal); }
    catch (error) { code = controller.signal.aborted ? 'CAPTURE_TIMEOUT' : error.code ?? 'CAPTURE_FAILED'; }
    finally { clearTimeout(timer); }
    try {
      if (!active(operation) || operation.pending !== pending) return;
      const query = new URLSearchParams({ screenId: task.screenId, revision: task.revision, theme, ...(code ? { code } : {}) });
      await request(operation.base + '/screen-capture/providers/' + operation.providerId + '/results/' + task.requestId + '?' + query,
        { method: 'POST', ...(png ? { body: png, headers: { 'Content-Type': 'image/png' } } : {}) },
        operation.controller.signal, () => active(operation));
    } catch { /* Disconnected or expired requests cannot accept results. */ }
    finally {
      operation.controller.signal.removeEventListener('abort', abort);
      if (operation.pending === pending) operation.pending = null;
    }
  }
  // Capture control frames share the authenticated document event stream.
  // A separate persistent HTTP/1.1 connection per tab would exhaust Chromium's
  // per-origin connection pool before five editors could open.
  function onEvent(event, signal) {
    if (signal.aborted) return;
    if (event.code === 'SCREEN_CAPTURE_READY') {
      stop();
      const context = getContext();
      if (!context.documentId || !['Owner', 'Editor'].includes(context.role)) return;
      const operation = { ...context, base: '/api/v1/documents/' + encodeURIComponent(context.documentId),
        providerId: event.providerId, signal, controller: new AbortController() };
      operation.abort = () => { if (current === operation) stop(); };
      current = operation;
      signal.addEventListener('abort', operation.abort, { once: true });
      return;
    }
    const operation = current;
    if (!operation || operation.signal !== signal || !active(operation)) return;
    if (event.code === 'SCREEN_CAPTURE_CAPTURE') void handle(operation, event.request);
    else if (event.code === 'SCREEN_CAPTURE_CANCEL' && operation.pending?.id === event.request.requestId) {
      operation.pending.controller.abort(); operation.pending = null;
    }
  }
  function onDisconnect(signal) {
    if (current?.signal === signal) stop();
  }
  window.addEventListener('pagehide', stop);
  return { stop, onEvent, onDisconnect };
}
