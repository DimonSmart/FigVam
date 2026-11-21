export function createScreenDiagnostics({ element, request, getContext, pageSize }) {
  let diagnosticsController = null, diagnosticsGeneration = 0, diagnosticsOffset = 0, diagnosticsTotal = 0, diagnosticsKey = null;
  function resetDiagnostics() {
    diagnosticsController?.abort(); diagnosticsController = null; diagnosticsGeneration++;
    diagnosticsOffset = diagnosticsTotal = 0; diagnosticsKey = null;
    element('diagnostics-list').replaceChildren(); element('diagnostics-status').textContent = 'Выберите экран.';
    element('diagnostics-error').textContent = ''; element('diagnostics-retry').hidden = true;
    element('diagnostics-number').textContent = '';
    element('diagnostics-previous').disabled = element('diagnostics-next').disabled = true;
  }
  async function loadDiagnostics() {
    diagnosticsController?.abort();
    const controller = new AbortController(), current = ++diagnosticsGeneration;
    diagnosticsController = controller;
    const { documentId: doc, screen, revision: atRevision, token: requestToken, navigationEpoch: epoch } = getContext(), offset = diagnosticsOffset;
    if (!doc || !screen || !Number.isSafeInteger(atRevision)) { resetDiagnostics(); return; }
    diagnosticsKey = `${doc}:${screen}:${atRevision}`;
    const valid = () => {
      const context = getContext();
      return !controller.signal.aborted && current === diagnosticsGeneration && doc === context.documentId && screen === context.screen && atRevision === context.revision && requestToken === context.token && epoch === context.navigationEpoch && !element('editor-view').hidden;
    };
    element('diagnostics-list').replaceChildren(); element('diagnostics-error').textContent = '';
    element('diagnostics-retry').hidden = true; element('diagnostics-number').textContent = '';
    element('diagnostics-previous').disabled = element('diagnostics-next').disabled = true;
    element('diagnostics-status').textContent = 'Загрузка диагностики…';
    try {
      const query = new URLSearchParams({ screenId: screen, revision: String(atRevision), offset: String(offset), limit: String(pageSize) });
      const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/diagnostics?${query}`, {}, controller.signal);
      if (!valid()) return;
      if (result.documentId?.toLowerCase() !== doc.toLowerCase() || result.screenId?.toLowerCase() !== screen.toLowerCase() || result.revision !== atRevision || result.offset !== offset || result.limit !== pageSize || !Number.isInteger(result.total) || result.total < 0 || !Array.isArray(result.items)) throw new TypeError('Некорректный ответ');
      diagnosticsTotal = result.total;
      for (const item of result.items) {
        const li = document.createElement('li');
        li.textContent = [item.code, item.path, item.message, item.referenceId ? `ID ссылки: ${item.referenceId}` : null, item.property ? `Свойство: ${item.property}` : null].filter(Boolean).join(' — ');
        element('diagnostics-list').append(li);
      }
      element('diagnostics-status').textContent = result.total ? 'Диагностика выбранного экрана.' : 'Диагностик для выбранного экрана нет.';
      element('diagnostics-number').textContent = result.total ? `${offset + 1}–${offset + result.items.length} из ${result.total}` : '';
      element('diagnostics-previous').disabled = offset === 0;
      element('diagnostics-next').disabled = offset + result.items.length >= result.total || !result.items.length;
    } catch (error) {
      if (!valid() || error.name === 'AbortError') return;
      element('diagnostics-status').textContent = 'Не удалось загрузить диагностику.';
      element('diagnostics-error').textContent = error instanceof TypeError ? 'Не удалось получить корректный ответ сервера.' : error.message;
      element('diagnostics-retry').hidden = false;
    }
  }
  element('diagnostics-retry').addEventListener('click', loadDiagnostics);
  element('diagnostics-previous').addEventListener('click', () => { diagnosticsOffset = Math.max(0, diagnosticsOffset - pageSize); loadDiagnostics(); });
  element('diagnostics-next').addEventListener('click', () => { if (diagnosticsOffset + pageSize < diagnosticsTotal) { diagnosticsOffset += pageSize; loadDiagnostics(); } });
  function refresh() {
    const { documentId, screen, revision } = getContext();
    const nextKey = screen ? `${documentId}:${screen}:${revision}` : null;
    if (diagnosticsKey !== nextKey) { resetDiagnostics(); if (screen) loadDiagnostics(); }
  }
  return { reset: resetDiagnostics, refresh };
}
