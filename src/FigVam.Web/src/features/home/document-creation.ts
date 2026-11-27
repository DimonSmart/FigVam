import type { AuthPolicy } from '../../api/auth-client';
import type { ApiClient } from '../../api/api-client';
import { record } from '../../api/decode';
import type { SessionLifecycle } from '../../core/session';
import type { ApplicationShellModel } from '../../app/application-shell-state';
import type { Retry, Work } from '../../app/request-runner';

interface Options {
  auth: AuthPolicy;
  shellState: ApplicationShellModel;
  session: Pick<SessionLifecycle, 'token' | 'navigationEpoch' | 'signal'>;
  request: ApiClient;
  run(action: Retry | null, work: Work, options?: { create?: boolean; quiet?: boolean }): Promise<void>;
  message(status?: string, error?: string): void;
  navigate(path: string): void;
  loadList(): Promise<void>;
  onUnauthorized(): void;
}

/** Owns document creation and the import operation for the current session. */
export function createDocumentCreation({auth, shellState, request, run, message, navigate, loadList, onUnauthorized, session}: Options) {
  let importOperation: { token: string; epoch: number } | null = null;

  async function createDocument() {
    if (shellState.getSnapshot().controlsDisabled || !session.token) return;
    const name = shellState.getSnapshot().documentName.trim();
    if (!name || /[\u0000-\u001f\u007f-\u009f]/.test(name)) {
      message('', 'Укажите непустое имя без управляющих символов.');
      return;
    }
    const documentId = crypto.randomUUID();
    await run(null, async (signal, current) => {
      await request('/api/v1/documents', { method: 'POST', body: JSON.stringify({ documentId, name }) }, signal);
      if (!current()) return;
      shellState.patch({ documentName: '' });
      navigate(`/documents/${documentId}`);
    }, { create: true });
  }
  async function importDocument() {
    if (importOperation || !session.token) return;
    const file = shellState.getSnapshot().importFile;
    if (!file) return;
    const name = file.name.toLowerCase();
    const format = name.endsWith('.figvam') ? 'container.figvam' : name.endsWith('.json') ? 'document.json' : null;
    shellState.patch({ importError: '', importStatus: '', importDiagnostics: [] });
    if (!format) { shellState.patch({ importError: 'Выберите файл document.json или .figvam.' }); return; }
    const operation = { token: session.token, epoch: session.navigationEpoch };
    importOperation = operation;
    const active = () => importOperation === operation && session.token === operation.token && session.navigationEpoch === operation.epoch;
    shellState.patch({ importBusy: true, importStatus: 'Импорт документа…' });
    try {
      const response = await fetch(`/api/v1/documents/import/${format}`, {
        method: 'POST', body: file, signal: session.signal, cache: 'no-store', credentials: auth.credentialsMode(), redirect: 'error',
        headers: { ...auth.authHeaders(operation.token, 'POST'), 'Content-Type': format === 'document.json' ? 'application/json' : 'application/zip' }
      });
      if (!active()) return;
      if (response.status === 401) { onUnauthorized(); return; }
      const raw: unknown = await response.json().catch(() => ({}));
      const body = record(raw) ? raw : {};
      if (!active()) return;
      if (!response.ok) {
        if (response.status >= 500) throw new Error('uncertain');
        const explanations: Partial<Record<number, string>> = { 400: 'Файл не прошёл проверку.', 403: 'Нет прав на импорт документа.', 409: 'Документ с таким идентификатором уже существует. Проверьте список.', 413: 'Файл превышает допустимый размер.', 415: 'Формат файла не поддерживается.', 429: 'Слишком много запросов. Повторите позже.' };
        const importError = (explanations[response.status] ?? 'Сервер отклонил импорт.') + (typeof body.code === 'string' && body.code ? ` Код: ${body.code}.` : '');
        const importDiagnostics = (Array.isArray(body.diagnostics) ? body.diagnostics : []).flatMap((diagnostic: unknown) => record(diagnostic)
          ? [[diagnostic.code, diagnostic.path, diagnostic.message].filter(value => typeof value === 'string' && value).join(' — ')]
          : []);
        shellState.patch({ importError, importDiagnostics, importStatus: '' });
        return;
      }
      if (body.code !== 'ACCEPTED' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(typeof body.documentId === 'string' ? body.documentId : '')) throw new Error('uncertain');
      shellState.resetImport();
      shellState.patch({ importBusy: true, importStatus: 'Импорт документа…' });
      await loadList();
      if (importOperation === operation && session.token === operation.token && session.navigationEpoch === operation.epoch + 1) navigate(`/documents/${body.documentId}`);
    } catch {
      if (active()) shellState.patch({ importStatus: '', importError: 'Результат импорта неизвестен: документ мог быть создан. Проверьте список перед повторной попыткой.' });
    } finally {
      if (importOperation === operation) {
        importOperation = null;
        shellState.patch({ importBusy: false, ...(session.navigationEpoch !== operation.epoch ? { importStatus: '' } : {}) });
      }
    }
  }
  return {
    createDocument, importDocument,
    reset() { importOperation = null; shellState.resetImport(); },
  };
}
