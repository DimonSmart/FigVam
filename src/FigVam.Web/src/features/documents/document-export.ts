import { authHeaders, credentialsMode } from '../../api/auth-client.js';
import { createExportModel, type ExportFormat } from './document-export-view';
interface ExportContext { token: string | null; documentId: string | null; revision: number | null; documentRole: string | null; navigationEpoch: number }
interface ExportOptions { model: ReturnType<typeof createExportModel>; isEditorVisible(): boolean; getContext(): ExportContext; onUnauthorized(): void }

export function createDocumentExport({ model, isEditorVisible, getContext, onUnauthorized }: ExportOptions) {
  let exportController: AbortController | null = null;
  let status = '', errorMessage = '';
  function reset() {
    exportController?.abort(); exportController = null;
    status = errorMessage = '';
    render();
  }
  function render() {
    const { documentRole, revision } = getContext();
    const permitted = ['Owner', 'Editor'].includes(documentRole ?? '');
    const access = documentRole === 'Viewer'
      ? 'Скачивание экспорта недоступно для роли просмотра по текущей политике.'
      : permitted && Number.isSafeInteger(revision) ? `Файл содержит показанную ревизию ${revision}. JSON не включает содержимое ассетов; для них используйте контейнер.` : 'Экспорт недоступен.';
    model.publish({ access, disabled: !permitted || !Number.isSafeInteger(revision) || !!exportController, status, error: errorMessage, download: format => { void exportDocument(format); } });
  }
  async function exportDocument(format: ExportFormat) {
    const { token, documentId, revision, documentRole, navigationEpoch } = getContext();
    if (exportController || !token || !documentId || !Number.isSafeInteger(revision) || !['Owner', 'Editor'].includes(documentRole ?? '') || !isEditorVisible()) return;
    const controller = new AbortController(), id = documentId, requestToken = token, epoch = navigationEpoch, atRevision = revision;
    exportController = controller;
    const active = () => exportController === controller && !controller.signal.aborted && epoch === getContext().navigationEpoch && getContext().documentId === id && getContext().token === requestToken && isEditorVisible();
    errorMessage = ''; status = `Подготовка ревизии ${atRevision}…`; render();
    try {
      const response = await fetch(`/api/v1/documents/${encodeURIComponent(id)}/${format}?revision=${atRevision}`, {
        signal: controller.signal, cache: 'no-store', credentials: credentialsMode(), redirect: 'error', headers: authHeaders(requestToken)
      });
      if (!active()) return;
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => ({}));
        if (!active()) return;
        const codes: Record<string, string | undefined> = { REVISION_UNAVAILABLE: 'Эта ревизия больше недоступна. Обновите документ и повторите экспорт.', EXPORT_DEPENDENCY_UNAVAILABLE: 'Экспорт невозможен: отсутствует или повреждён необходимый ассет.', EXPORT_TOO_LARGE: 'Документ превышает допустимый размер экспорта.' };
        const code = body && typeof body === 'object' && 'code' in body && typeof body.code === 'string' ? body.code : '';
        throw new Error(codes[code] ?? (response.status === 403 ? 'Нет прав на экспорт. Обратитесь к владельцу документа.' : response.status === 404 ? 'Документ или ревизия недоступны. Обновите документ.' : response.status === 413 ? 'Документ превышает допустимый размер экспорта.' : 'Не удалось экспортировать документ. Повторите позже.'));
      }
      const blob = await response.blob();
      if (!active()) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = format === 'document.json' ? 'document.json' : 'document.figvam';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status = `Скачана ревизия ${atRevision}.`;
    } catch (error) {
      if (!active() || (error instanceof Error && error.name === 'AbortError')) return;
      status = '';
      errorMessage = error instanceof TypeError ? 'Не удалось связаться с сервером. Проверьте соединение.' : error instanceof Error ? error.message : String(error);
    } finally {
      if (exportController === controller) { exportController = null; render(); }
    }
  }
  render();
  return { reset, render, dispose: reset };
}
