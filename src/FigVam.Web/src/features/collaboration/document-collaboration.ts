import { authHeaders, credentialsMode } from '../../api/auth-client.js';
import { ApiError } from '../../api/api-client.js';
type CaptureEvent = Record<string, unknown> & { code: string };
interface CollaborationOptions {
  request(path: string, options: RequestInit, signal: AbortSignal): Promise<unknown>;
  workspace: { documentId: string | null; revision: number | null; token: string | null };
  isEditorVisible(): boolean;
  readRevision(signal: AbortSignal, revision: number): Promise<unknown>;
  onConnectionStatus(status: string): void;
  onAccessLost(status: number): void;
  onUnauthorized(): void;
  onCaptureEvent?(event: CaptureEvent, signal: AbortSignal): void;
  onCaptureDisconnect?(signal: AbortSignal): void;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function createDocumentCollaboration({
  request, workspace, isEditorVisible, readRevision, onConnectionStatus, onAccessLost, onUnauthorized, onCaptureEvent, onCaptureDisconnect
}: CollaborationOptions) {
  let liveController: AbortController | null = null;
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

  async function followDocument(id: string, controller: AbortController) {
    const signal = controller.signal, base = `/api/v1/documents/${encodeURIComponent(id)}`;
    const active = () => !signal.aborted && liveController === controller && workspace.documentId === id;
    let delay = 1000;
    async function frame(raw: string) {
      const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data || !active()) return;
      const event: unknown = JSON.parse(data);
      if (!isRecord(event) || typeof event.code !== 'string') throw new Error('Некорректное событие');
      if (event.code.startsWith('SCREEN_CAPTURE_')) { onCaptureEvent?.({ ...event, code: event.code }, signal); return; }
      if (event.code === 'FORBIDDEN') { throw new ApiError(403, {}); }
      if (event.code === 'RECONNECT_REQUIRED') throw new Error('Требуется восстановление');
      if (event.code !== 'CHANGE') return;
      if (!isRevision(event.revision) || !isRecord(event.change) || typeof event.change.documentId !== 'string' || event.change.documentId.toLowerCase() !== id.toLowerCase()) throw new Error('Некорректное событие');
      const current = workspace.revision;
      if (!isRevision(current)) throw new Error('Некорректная текущая ревизия');
      if (event.revision <= current) return;
      if (event.revision !== current + 1) throw new Error('Пропуск ревизии');
      await readRevision(signal, event.revision);
      if (active()) onConnectionStatus('Подключено · изменения участников получаются автоматически.');
    }
    while (active()) {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        onConnectionStatus('Восстановление соединения…');
        const recovery = await request(`${base}/reconnect?lastSeenRevision=${workspace.revision}`, {}, signal);
        if (!active()) return;
        if (!isRecord(recovery) || typeof recovery.code !== 'string' || !['EVENTS', 'SNAPSHOT'].includes(recovery.code) || !isRevision(recovery.revision) || !isRevision(workspace.revision)) throw new Error('Некорректный ответ восстановления');
        if (recovery.revision < workspace.revision) throw new Error('Устаревший ответ восстановления');
        // Render the recovered revision through the same bounded, revision-pinned queries as initial loading.
        if (recovery.revision > workspace.revision) await readRevision(signal, recovery.revision);
        if (!active()) return;
        const response = await fetch(`${base}/events?lastSeenRevision=${workspace.revision}`, {
          signal, cache: 'no-store', credentials: credentialsMode(), redirect: 'error', headers: { ...authHeaders(workspace.token ?? ''), ...(onCaptureEvent ? { 'X-FigVam-Screen-Capture': '1' } : {}) }
        });
        if (!active()) return;
        if (response.status === 401) { onUnauthorized(); return; }
        if (!response.ok) { throw new ApiError(response.status, {}); }
        if (!response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('Некорректный поток');
        if (!response.body) throw new Error('Пустой поток');
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
        if (!active() || (error instanceof Error && error.name === 'AbortError')) return;
        if (error instanceof ApiError && [403, 404].includes(error.status)) { onAccessLost(error.status); return; }
        if (error instanceof ApiError && error.status === 429) delay = 30000;
      } finally {
        onCaptureDisconnect?.(signal);
        if (reader) await reader.cancel().catch(() => {});
      }
      if (!active()) return;
      onConnectionStatus('Связь прервана · повторное подключение автоматически. Показана последняя полученная ревизия.');
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, delay); signal.addEventListener('abort', done, { once: true });
      });
      delay = Math.min(delay * 2, 30000);
    }
  }

  return { start, stop };
}
