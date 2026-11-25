import { authHeaders, credentialsMode } from './auth-client.js';

const maxBytes = 5 * 1024 * 1024;
const maxDimension = 4096;
const maxPixels = 4 * 1024 * 1024;
const supported = () => typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
  typeof globalThis.RestrictionTarget?.fromElement === 'function' &&
  typeof HTMLVideoElement.prototype.requestVideoFrameCallback === 'function';
const failure = code => Object.assign(new Error(code), { code });
const cancelled = () => new DOMException('Capture cancelled', 'AbortError');

function abortable(signal, subscribe) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(cancelled()); return; }
    let cleanup = () => {};
    const finish = (fn, value) => {
      signal.removeEventListener('abort', abort);
      cleanup();
      fn(value);
    };
    const abort = () => finish(reject, cancelled());
    signal.addEventListener('abort', abort, { once: true });
    cleanup = subscribe(value => finish(resolve, value), error => finish(reject, error)) ?? cleanup;
  });
}
const delay = (ms, signal) => abortable(signal, resolve => {
  const id = setTimeout(resolve, ms); return () => clearTimeout(id);
});
const paint = signal => abortable(signal, resolve => {
  const id = requestAnimationFrame(resolve); return () => cancelAnimationFrame(id);
});
const frame = (video, signal) => abortable(signal, resolve => {
  const id = video.requestVideoFrameCallback((_, metadata) => resolve(metadata));
  return () => video.cancelVideoFrameCallback(id);
});
const deadline = (parent, ms) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent.addEventListener('abort', abort, { once: true });
  if (parent.aborted) abort();
  const timer = setTimeout(abort, ms);
  return { signal: controller.signal, abort, dispose() {
    clearTimeout(timer); parent.removeEventListener('abort', abort);
  } };
};

export function createScreenCapture({ request, getContext, onChange }) {
  let current = null, state = supported() ? 'Disabled' : 'Unsupported', message = '';
  function change(next, detail = '') { state = next; message = detail; onChange(); }
  function sameDocument(operation) {
    const context = getContext();
    return context.documentId === operation.documentId && context.token === operation.token &&
      context.navigationEpoch === operation.navigationEpoch;
  }
  function active(operation) {
    return current === operation && !operation.controller.signal.aborted && sameDocument(operation);
  }
  function stop(next = supported() ? 'Disabled' : 'Unsupported', detail = '') {
    const operation = current;
    current = null;
    if (operation) {
      operation.controller.abort();
      operation.pending?.abort();
      operation.uploadController?.abort();
      operation.stream?.getTracks().forEach(track => track.stop());
      if (operation.video) {
        operation.video.pause(); operation.video.srcObject = null;
      }
      if (operation.providerId && sameDocument(operation))
        request(operation.base + '/providers/' + operation.providerId, { method: 'DELETE' }).catch(() => {});
    }
    change(next, detail);
  }

  function viewFor(operation) {
    if (!active(operation)) throw cancelled();
    const view = getContext().captureView;
    if (!view || view.screenId !== operation.screenId || view.element !== operation.element)
      throw failure('SCREEN_NOT_DISPLAYED');
    if (operation.track.readyState !== 'live' || operation.track.muted)
      throw failure('CAPTURE_FAILED');
    return view;
  }

  async function png(operation, revision, signal) {
    let stamp, view;
    // The revision comes from the actual committed Preview DOM, not the editor's
    // last received revision. Wait for collaboration and the existing renderer.
    while (!signal.aborted) {
      view = viewFor(operation);
      if (view.revision > revision) throw failure('RENDER_REVISION_MISMATCH');
      if (view.stamp?.revision === revision && view.revision === revision) {
        stamp = view.stamp;
        const images = [...view.element.querySelectorAll('img[data-asset-id]')];
        if (images.every(img => img.dataset.loadedAsset === img.dataset.assetId && img.complete && img.naturalWidth > 0)) break;
      }
      await delay(50, signal);
    }
    if (signal.aborted) throw cancelled();
    const check = () => {
      const latest = viewFor(operation);
      if (latest.stamp !== stamp || latest.revision !== revision)
        throw failure('RENDER_REVISION_MISMATCH');
      if (signal.aborted) throw cancelled();
    };
    await abortable(signal, (resolve, reject) => {
      Promise.all([document.fonts.ready, ...[...view.element.querySelectorAll('img')].map(img => img.decode())])
        .then(resolve, reject);
    });
    check();
    await paint(signal);
    await paint(signal);
    check();
    // Do not draw the last buffered frame. Wait for newly presented frames after
    // the DOM/resource/paint barrier. Hidden/throttled tabs may time out.
    const first = await frame(operation.video, signal);
    let next;
    do { next = await frame(operation.video, signal); } while (next.presentedFrames <= first.presentedFrames);
    check();
    const video = operation.video;
    const width = video.videoWidth, height = video.videoHeight;
    if (!width || !height) throw failure('CAPTURE_FAILED');
    if (width > maxDimension || height > maxDimension || width * height > maxPixels) throw failure('IMAGE_TOO_LARGE');
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    try {
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw failure('CAPTURE_FAILED');
      context.drawImage(video, 0, 0);
      const blob = await abortable(signal, resolve => { canvas.toBlob(resolve, 'image/png'); });
      check();
      if (!blob || blob.type !== 'image/png') throw failure('CAPTURE_FAILED');
      if (blob.size > maxBytes) throw failure('IMAGE_TOO_LARGE');
      return blob;
    } finally { canvas.width = canvas.height = 0; }
  }

  async function handleCapture(operation, task) {
    if (operation.pending) return;
    const upload = new AbortController();
    operation.uploadController = upload;
    const abortUpload = () => upload.abort();
    operation.controller.signal.addEventListener('abort', abortUpload, { once: true });
    const pending = deadline(upload.signal, 8500);
    operation.pending = pending;
    operation.requestId = task.requestId;
    change('Capturing');
    let blob, code;
    try {
      if (task.documentId !== operation.documentId || task.screenId !== operation.screenId)
        throw failure('SCREEN_NOT_DISPLAYED');
      blob = await png(operation, task.revision, pending.signal);
    } catch (error) {
      code = error.code && typeof error.code === 'string' ? error.code :
        pending.signal.aborted ? 'CAPTURE_TIMEOUT' : 'CAPTURE_FAILED';
    } finally {
      pending.dispose();
    }
    try {
      if (!active(operation) || operation.requestId !== task.requestId) return;
      const query = new URLSearchParams({ screenId: task.screenId, revision: String(task.revision), ...(code ? { code } : {}) });
      await request(operation.base + '/providers/' + operation.providerId + '/results/' + task.requestId + '?' + query,
        { method: 'POST', ...(blob ? { body: blob, headers: { 'Content-Type': 'image/png' } } : {}) },
        upload.signal, () => active(operation) && operation.requestId === task.requestId);
    } catch (error) {
      // A cancelled/timed-out server request no longer accepts a result.
      if (active(operation) && error.status !== 404 && error.name !== 'AbortError')
        stop('Error', 'Не удалось передать изображение.');
    } finally {
      operation.controller.signal.removeEventListener('abort', abortUpload);
      if (operation.uploadController === upload) operation.uploadController = null;
      if (current === operation && operation.pending === pending) {
        operation.pending = null; operation.requestId = null;
        change('Ready');
      }
    }
  }

  async function connect(operation) {
    const signal = operation.controller.signal;
    let reader;
    const handshake = setTimeout(() => {
      if (active(operation) && !operation.providerId) stop('Error', 'Сервер не подтвердил подключение захвата.');
    }, 10000);
    try {
      const response = await fetch(operation.base + '/providers/' + operation.screenId, {
        method: 'POST', signal, cache: 'no-store', credentials: credentialsMode(), redirect: 'error',
        headers: authHeaders(operation.token, 'POST')
      });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream'))
        throw failure('RENDERER_UNAVAILABLE');
      reader = response.body.getReader();
      const decoder = new TextDecoder(); let buffer = '';
      while (active(operation)) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data || !active(operation)) continue;
          const event = JSON.parse(data);
          if (event.code === 'READY') {
            operation.providerId = event.providerId;
            clearTimeout(handshake);
            change('Ready');
          } else if (event.code === 'CAPTURE') {
            void handleCapture(operation, event.request);
          } else if (event.code === 'CANCEL' && operation.requestId === event.request.requestId) {
            operation.requestId = null;
            operation.pending?.abort();
            operation.uploadController?.abort();
          }
          sync();
        }
        if (buffer.length > 65536) throw failure('CAPTURE_FAILED');
      }
      if (active(operation)) stop('Disabled', 'Подключение захвата завершено.');
    } catch (error) {
      if (active(operation)) stop('Error', 'Не удалось подключить захват к серверу.');
    } finally {
      clearTimeout(handshake);
      if (reader) await reader.cancel().catch(() => {});
    }
  }

  async function enable() {
    if (current) return;
    if (!supported()) { change('Unsupported'); return; }
    const context = getContext(), view = context.captureView;
    if (!view?.stamp || !view.screenId) { change('Error', 'Откройте экран в Preview и дождитесь его загрузки.'); return; }
    const operation = { ...context, element: view.element, screenId: view.screenId,
      base: '/api/v1/documents/' + encodeURIComponent(context.documentId) + '/screen-capture',
      controller: new AbortController() };
    current = operation;
    change('Awaiting permission');
    try {
      // This call must run in the original click handler, before any await.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude'
      });
      if (!active(operation)) { stream.getTracks().forEach(track => track.stop()); return; }
      operation.stream = stream;
      const track = operation.track = stream.getVideoTracks()[0];
      if (!track || track.getSettings().displaySurface !== 'browser' || typeof track.restrictTo !== 'function')
        throw failure('CAPTURE_FAILED');
      track.addEventListener('ended', () => { if (current === operation) stop(); }, { once: true });
      const startup = deadline(operation.controller.signal, 8000);
      try {
        const target = await abortable(startup.signal, (resolve, reject) => {
          RestrictionTarget.fromElement(operation.element).then(resolve, reject);
        });
        if (!active(operation)) return;
        // No video element receives a stream before successful restriction. Never
        // unrestrict it, and never fall back to full-tab/window/desktop capture.
        await abortable(startup.signal, (resolve, reject) => { track.restrictTo(target).then(resolve, reject); });
        if (!active(operation)) return;
        const video = operation.video = document.createElement('video');
        video.muted = true; video.playsInline = true;
        video.srcObject = stream;
        await abortable(startup.signal, (resolve, reject) => { video.play().then(resolve, reject); });
        if (!active(operation)) return;
        await frame(video, startup.signal);
      } finally { startup.dispose(); }
      viewFor(operation);
      if (!active(operation)) return;
      void connect(operation);
    } catch (error) {
      if (current === operation) stop('Error', 'Не удалось включить захват. Выберите текущую вкладку FigVam и оставьте Preview открытым.');
    }
  }

  async function download() {
    const operation = current;
    if (!operation || state !== 'Ready' || operation.pending) return;
    const pending = deadline(operation.controller.signal, 8500);
    operation.pending = pending;
    change('Capturing');
    try {
      const blob = await png(operation, viewFor(operation).revision, pending.signal);
      if (!active(operation)) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = 'figvam-screen.png'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (active(operation)) message = 'Не удалось получить свежий кадр.';
    } finally {
      pending.dispose();
      if (current === operation) { operation.pending = null; change('Ready', message); }
    }
  }
  function sync() {
    if (!current) return;
    const view = getContext().captureView;
    if (!sameDocument(current) || !view || view.screenId !== current.screenId || view.element !== current.element)
      stop();
  }
  window.addEventListener('pagehide', () => stop());
  return { enable, stop, sync, download, get state() { return state; }, get message() { return message; } };
}
