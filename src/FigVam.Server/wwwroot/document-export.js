export function createDocumentExport({ element, getContext, onUnauthorized }) {
  let exportController = null;
  function reset() {
    exportController?.abort(); exportController = null;
    element('export-status').textContent = ''; element('export-error').textContent = '';
    render();
  }
  function render() {
    const { documentRole, revision } = getContext();
    const permitted = ['Owner', 'Editor'].includes(documentRole);
    element('export-access').textContent = documentRole === 'Viewer'
      ? 'Скачивание экспорта недоступно для роли просмотра по текущей политике.'
      : permitted && Number.isSafeInteger(revision) ? `Файл содержит показанную ревизию ${revision}. JSON не включает содержимое ассетов; для них используйте контейнер.` : 'Экспорт недоступен.';
    for (const id of ['export-json', 'export-container']) element(id).disabled = !permitted || !Number.isSafeInteger(revision) || !!exportController;
  }
  async function exportDocument(format) {
    const { token, documentId, revision, documentRole, navigationEpoch } = getContext();
    if (exportController || !token || !documentId || !Number.isSafeInteger(revision) || !['Owner', 'Editor'].includes(documentRole) || element('editor-view').hidden) return;
    const controller = new AbortController(), id = documentId, requestToken = token, epoch = navigationEpoch, atRevision = revision;
    exportController = controller; render();
    const active = () => exportController === controller && !controller.signal.aborted && epoch === getContext().navigationEpoch && getContext().documentId === id && getContext().token === requestToken && !element('editor-view').hidden;
    element('export-error').textContent = ''; element('export-status').textContent = `Подготовка ревизии ${atRevision}…`;
    try {
      const response = await fetch(`/api/v1/documents/${encodeURIComponent(id)}/${format}?revision=${atRevision}`, {
        signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { Authorization: `Bearer ${requestToken}` }
      });
      if (!active()) return;
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (!active()) return;
        const codes = { REVISION_UNAVAILABLE: 'Эта ревизия больше недоступна. Обновите документ и повторите экспорт.', EXPORT_DEPENDENCY_UNAVAILABLE: 'Экспорт невозможен: отсутствует или повреждён необходимый ассет.', EXPORT_TOO_LARGE: 'Документ превышает допустимый размер экспорта.' };
        throw new Error(codes[body.code] ?? (response.status === 403 ? 'Нет прав на экспорт. Обратитесь к владельцу документа.' : response.status === 404 ? 'Документ или ревизия недоступны. Обновите документ.' : response.status === 413 ? 'Документ превышает допустимый размер экспорта.' : 'Не удалось экспортировать документ. Повторите позже.'));
      }
      const blob = await response.blob();
      if (!active()) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = format === 'document.json' ? 'document.json' : 'document.figvam';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      element('export-status').textContent = `Скачана ревизия ${atRevision}.`;
    } catch (error) {
      if (!active() || error.name === 'AbortError') return;
      element('export-status').textContent = '';
      element('export-error').textContent = error instanceof TypeError ? 'Не удалось связаться с сервером. Проверьте соединение.' : error.message;
    } finally {
      if (exportController === controller) { exportController = null; render(); }
    }
  }
  element('export-json').addEventListener('click', () => exportDocument('document.json'));
  element('export-container').addEventListener('click', () => exportDocument('container.figvam'));
  return { reset, render };
}
