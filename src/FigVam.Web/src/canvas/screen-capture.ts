import { renderScreen, type RenderModel } from './screen-renderer.js';
import { readRenderModel, readTheme, number } from './render-model';
import { requiredRecord, record, text, array } from '../api/decode';
import type { ApiClient } from '../api/api-client';
import type { Theme } from '../core/tokens/token-model';
interface Task {documentId:string;requestId:string;screenId:string;revision:number;width:number;height:number;theme?:Theme}
interface Context {documentId:string|null;token:string|null;navigationEpoch:number;role:string|null;theme?:Theme}
interface Operation extends Context {base:string;providerId:string;signal:AbortSignal;controller:AbortController;abort:()=>void;pending:{id:string;controller:AbortController}|null}
function readTask(value:unknown):Task {
  const t=requiredRecord(value);
  return {documentId:text(t.documentId),requestId:text(t.requestId),screenId:text(t.screenId),revision:number(t.revision),width:number(t.width),height:number(t.height),theme:t.theme==null?undefined:readTheme(t.theme)};
}
type Query = Record<string,string|number>;
function queryParams(params:Query):URLSearchParams {return new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)]));}


const fail = (code:string) => Object.assign(new Error(code), { code });
const cancelled = () => new DOMException('Cancelled', 'AbortError');
const maxBytes = 5 * 1024 * 1024;

async function dataUrl(blob:Blob, signal:AbortSignal):Promise<string> {
  return new Promise<string>((resolve, reject) => {
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
async function renderPng(request:ApiClient, base:string, task:Task, theme:Theme, signal:AbortSignal):Promise<Blob> {
  const { screenId: screen, revision, width, height } = task;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > 4096 || height > 4096 || width * height > 4 * 1024 * 1024) throw fail('IMAGE_TOO_LARGE');
  async function read(path:string, params:Query = {}) {
    const result = requiredRecord(await request(base + '/' + path + '?' + queryParams({ revision, ...params }), {}, signal));
    if (result.revision !== revision) throw fail('RENDER_REVISION_MISMATCH');
    return result;
  }
  async function pages(path:string, params:Query, field:string) {
    const items:unknown[] = [], overrides:unknown[] = [];
    let total:number;
    do {
      const page = await read(path, { ...params, offset: items.length, limit: 100 });
      const values=page[field];
      if (!Array.isArray(values) || typeof page.total!=='number' || !Number.isSafeInteger(page.total) || page.offset !== items.length ||
          (!values.length && items.length < page.total) || items.length+values.length>page.total) throw fail('CAPTURE_FAILED');
      total = page.total;
      items.push(...values); if(page.overrides!=null)overrides.push(...array(page.overrides,v=>v));
    } while (items.length < total);
    return { items, overrides };
  }
  const [info, profile, manifest, tokenList, structure] = await Promise.all([
    read('screens/' + screen, { fields: 'dimensions' }), read('profile'), read('assets'),
    pages('tokens', {}, 'items'),
    pages('nodes', { screenId: screen, fields: 'kind,properties,name,parentId,childCount,canContainChildren' }, 'items')
  ]);
  const items=array(info.items,requiredRecord);
  const dimensions=requiredRecord(items[0]?.dimensions);
  if (Math.ceil(number(dimensions.width)) !== width || Math.ceil(number(dimensions.height)) !== height)
    throw fail('CAPTURE_FAILED');
  const layout = await pages('screens/' + screen + '/layout',
    { previewWidth: number(dimensions.width), previewHeight: number(dimensions.height), theme }, 'boxes');
  const model=readRenderModel({screen,theme,overrides:layout.overrides,nodes:structure.items,boxes:layout.items,kinds:profile.kinds,assets:manifest.assets,tokens:tokenList.items});
  return renderModelPng(model, width, height,
    assetId => request.readPng(base + '/assets/' + assetId + '?revision=' + revision, {}, signal), {}, signal);
}

// Shared renderer for browser-backed MCP capture and server-owned headless Preview.
export async function renderModelPng(model:RenderModel, width:number, height:number, loadAsset:(id:string)=>Promise<Blob>, values:Readonly<Record<string,string|null|undefined>>, signal:AbortSignal):Promise<Blob> {
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
  const urls: string[] = [];
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
    if(!(clone instanceof HTMLElement))throw fail('CAPTURE_FAILED');
    const originals = [host, ...host.querySelectorAll<HTMLElement>('*')];
    const copies = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
    // Freeze computed CSS (including native controls), not editor chrome.
    // SVG image documents cannot reference external stylesheets or blob assets.
    for (let i = 0; i < originals.length; i++) {
      const source = originals[i], target = copies[i];
      if(!source||!target)throw fail('CAPTURE_FAILED');
      const computed = getComputedStyle(source);
      target.removeAttribute('style');
      for (const name of computed) {
        if (!name.startsWith('--')) target.style.setProperty(name, computed.getPropertyValue(name));
      }
      if (source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement) {
        // SVG image documents do not reliably paint native form values and
        // placeholder pseudo-elements. Freeze the text as ordinary XHTML.
        const field = document.createElement('div');
        for (const name of target.style) field.style.setProperty(name, target.style.getPropertyValue(name), target.style.getPropertyPriority(name));
        const password = source instanceof HTMLInputElement && source.type === 'password';
        const multiline = source instanceof HTMLTextAreaElement;
        const displayed = source.value ? (password ? '•'.repeat(source.value.length) : source.value) : source.placeholder;
        const text = document.createElement('span');
        text.textContent = displayed;
        if (!source.value) {
          const placeholder = getComputedStyle(source, '::placeholder');
          text.style.color = placeholder.color;
          text.style.opacity = placeholder.opacity;
        }
        // The text is already masked when necessary. Native input styles copied
        // above must not mask the placeholder or override the span's text color.
        field.style.setProperty('-webkit-text-security', 'none');
        text.style.setProperty('-webkit-text-fill-color', 'currentColor');
        Object.assign(field.style, { appearance: 'none', overflow: 'hidden', display: multiline ? 'block' : 'flex',
          alignItems: 'center', boxSizing: 'border-box' });
        Object.assign(text.style, { display: 'block', minWidth: '0', width: '100%', overflow: 'hidden',
          whiteSpace: multiline ? 'pre-wrap' : 'pre', overflowWrap: multiline ? 'break-word' : 'normal' });
        field.append(text);
        target.replaceWith(field);
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
      const png = await new Promise<Blob|null>(resolve => canvas.toBlob(resolve, 'image/png'));
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

export function createScreenCapture({ request, getContext }:{request:ApiClient;getContext():Context}) {
  let current:Operation|null = null;
  const same = (operation:Operation) => {
    const context = getContext();
    return context.documentId === operation.documentId && context.token === operation.token &&
      context.navigationEpoch === operation.navigationEpoch && ['Owner', 'Editor'].includes(context.role??'');
  };
  const active = (operation:Operation) => current === operation && !operation.controller.signal.aborted && same(operation);
  function stop() {
    const operation = current; current = null;
    if (!operation) return;
    operation.signal.removeEventListener('abort', operation.abort);
    operation.controller.abort();
    operation.pending?.controller.abort();
  }
  async function handle(operation:Operation, task:Task) {
    if (!active(operation) || operation.pending || task.documentId !== operation.documentId) return;
    const controller = new AbortController();
    const pending = { id: task.requestId, controller };
    operation.pending = pending;
    const abort = () => controller.abort();
    operation.controller.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 8000);
    const theme = task.theme ?? getContext().theme ?? 'Light';
    let png:Blob|undefined, code:string|undefined;
    try { png = await renderPng(request, operation.base, task, theme, controller.signal); }
    catch (error) { code = controller.signal.aborted ? 'CAPTURE_TIMEOUT' : (record(error)&&typeof error.code==='string'?error.code:'CAPTURE_FAILED'); }
    finally { clearTimeout(timer); }
    try {
      if (!active(operation) || operation.pending !== pending) return;
      const query = queryParams({ screenId: task.screenId, revision: task.revision, theme, ...(code ? { code } : {}) });
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
  function onEvent(event:unknown, signal:AbortSignal) {
    if (signal.aborted || !record(event)) return;
    if (event.code === 'SCREEN_CAPTURE_READY') {
      stop();
      const context = getContext();
      if (!context.documentId || !['Owner', 'Editor'].includes(context.role??'')) return;
      if(typeof event.providerId!=='string')return;
      const operation:Operation = { ...context, pending:null,abort:()=>{}, base: '/api/v1/documents/' + encodeURIComponent(context.documentId),
        providerId: event.providerId, signal, controller: new AbortController() };
      operation.abort = () => { if (current === operation) stop(); };
      current = operation;
      signal.addEventListener('abort', operation.abort, { once: true });
      return;
    }
    const operation = current;
    if (!operation || operation.signal !== signal || !active(operation)) return;
    if (event.code === 'SCREEN_CAPTURE_CAPTURE') {
      try{void handle(operation,readTask(event.request));}catch{/* Malformed capture frames cannot initiate a request. */}
    } else if (event.code === 'SCREEN_CAPTURE_CANCEL' && record(event.request) && operation.pending && operation.pending.id === event.request.requestId) {
      operation.pending.controller.abort(); operation.pending = null;
    }
  }
  function onDisconnect(signal:AbortSignal) {
    if (current?.signal === signal) stop();
  }
  window.addEventListener('pagehide', stop);
  return { stop, onEvent, onDisconnect };
}
