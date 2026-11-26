import { authHeaders, credentialsMode } from './auth-client.js';
export function createDocumentCollaboration({
  request, workspace, isEditorVisible, readRevision, onConnectionStatus, onAccessLost, onUnauthorized, onCaptureEvent, onCaptureDisconnect
}) {
  let liveController = null;
  function stop() {
    liveController?.abort();
    liveController = null;
    onConnectionStatus('');
  }

  function start() {
    const id = workspace.documentId;
    if (liveController || !workspace.token || !id || !isEditorVisible() || !Number.isSafeInteger(workspace.revision)) return;
    const controller = new AbortController();
    liveController = controller;
    followDocument(id, controller);
  }

  async function followDocument(id, controller) {
    const signal = controller.signal, base = `/api/v1/documents/${encodeURIComponent(id)}`;
    const active = () => !signal.aborted && liveController === controller && workspace.documentId === id;
    let delay = 1000;
    async function frame(raw) {
      const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data || !active()) return;
      const event = JSON.parse(data);
      if (event.code.startsWith('SCREEN_CAPTURE_')) { onCaptureEvent?.(event, signal); return; }
      if (event.code === 'FORBIDDEN') { const error = new Error('Доступ потерян'); error.status = 403; throw error; }
      if (event.code === 'RECONNECT_REQUIRED') throw new Error('Требуется восстановление');
      if (event.code !== 'CHANGE') return;
      if (!Number.isSafeInteger(event.revision) || event.change?.documentId?.toLowerCase() !== id.toLowerCase()) throw new Error('Некорректное событие');
      if (event.revision <= workspace.revision) return;
      if (event.revision !== workspace.revision + 1) throw new Error('Пропуск ревизии');
      await readRevision(signal, event.revision);
      if (active()) onConnectionStatus('Подключено · изменения участников получаются автоматически.');
    }
    while (active()) {
      let reader;
      try {
        onConnectionStatus('Восстановление соединения…');
        const recovery = await request(`${base}/reconnect?lastSeenRevision=${workspace.revision}`, {}, signal);
        if (!active()) return;
        if (!['EVENTS', 'SNAPSHOT'].includes(recovery.code) || !Number.isSafeInteger(recovery.revision)) throw new Error('Некорректный ответ восстановления');
        if (recovery.revision < workspace.revision) throw new Error('Устаревший ответ восстановления');
        // Render the recovered revision through the same bounded, revision-pinned queries as initial loading.
        if (recovery.revision > workspace.revision) await readRevision(signal, recovery.revision);
        if (!active()) return;
        const response = await fetch(`${base}/events?lastSeenRevision=${workspace.revision}`, {
          signal, cache: 'no-store', credentials: credentialsMode(), redirect: 'error', headers: { ...authHeaders(workspace.token), ...(onCaptureEvent ? { 'X-FigVam-Screen-Capture': '1' } : {}) }
        });
        if (!active()) return;
        if (response.status === 401) { onUnauthorized(); return; }
        if (!response.ok) { const error = new Error('Соединение прервано'); error.status = response.status; throw error; }
        if (!response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('Некорректный поток');
        reader = response.body.getReader();
        const decoder = new TextDecoder(); let buffer = '';
        onConnectionStatus('Подключено · изменения участников получаются автоматически.');
        delay = 1000;
        while (active()) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          buffer = buffer.replace(/\r\n/g, '\n');
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const raw = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); await frame(raw);
          }
          if (buffer.length > 1048576) throw new Error('Слишком большое событие');
        }
      } catch (error) {
        if (!active() || error.name === 'AbortError') return;
        if ([403, 404].includes(error.status)) { onAccessLost(error.status); return; }
        if (error.status === 429) delay = 30000;
      } finally {
        onCaptureDisconnect?.(signal);
        if (reader) await reader.cancel().catch(() => {});
      }
      if (!active()) return;
      onConnectionStatus('Связь прервана · повторное подключение автоматически. Показана последняя полученная ревизия.');
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, delay); signal.addEventListener('abort', done, { once: true });
      });
      delay = Math.min(delay * 2, 30000);
    }
  }

  return { start, stop };
}
