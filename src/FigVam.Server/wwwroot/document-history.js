export function createDocumentHistory({ element, request, pageSize, refreshPages, workspace }) {
  const versionOperations = new Map();
  const restoreOperations = new Map();
  const historyActions = new Map();
  let historyGeneration = 0, historyController = null, historyCursors = [null], historyIndex = 0, historyNext = null;
  const canEdit = () => ['Owner', 'Editor'].includes(workspace.documentRole);

  function renderVersionSave() {
    const operation = versionOperations.get(workspace.documentId);
    const form = element('version-save');
    element('version-name').value = operation?.name ?? '';
    element('version-name').readOnly = !!operation && (operation.state === 'pending' || operation.state === 'uncertain');
    form.querySelector('button').disabled = operation?.state === 'pending';
    form.querySelector('button').textContent = operation?.state === 'uncertain' ? 'Повторить создание версии' : 'Создать версию';
    element('version-result').textContent = operation?.state === 'success' ? `Версия создана: ${operation.versionId}` : operation?.state === 'pending' ? 'Создание версии…' : '';
    element('version-error').textContent = operation?.error ?? '';
  }

  element('version-save').addEventListener('submit', async event => {
    event.preventDefault();
    if (!canEdit()) return;
    const id = workspace.documentId;
    let operation = versionOperations.get(id);
    if (operation?.state === 'pending') return;
    if (operation?.state !== 'uncertain') {
      const name = element('version-name').value;
      operation = { name, commandId: crypto.randomUUID() };
      versionOperations.set(id, operation);
    }
    operation.state = 'pending'; operation.error = '';
    renderVersionSave();
    try {
      const result = await request(`/api/v1/documents/${encodeURIComponent(id)}/commands/save`, {
        method: 'POST', body: JSON.stringify({ commandId: operation.commandId, name: operation.name || null })
      });
      if (!result.versionId) throw new TypeError('Отсутствует идентификатор версии');
      operation.state = 'success'; operation.versionId = result.versionId;
    } catch (error) {
      const uncertain = !error.status || error.status >= 500;
      operation.state = uncertain ? 'uncertain' : 'failed';
      operation.error = uncertain ? 'Не удалось подтвердить создание версии. Повторите эту операцию: она могла выполниться.' : error.message;
    }
    if (versionOperations.get(id) === operation && workspace.documentId === id && workspace.token) { renderVersionSave(); if (operation.state === 'success') loadVersionHistory(); }
  });

  function renderHistoryAction() {
    const operation = historyActions.get(workspace.documentId);
    const writable = canEdit();
    const blocked = ['pending', 'uncertain'].includes(operation?.state);
    element('undo').disabled = element('redo').disabled = !writable || blocked;
    element('history-access').textContent = writable ? 'Сочетания: Ctrl/⌘+Z, Ctrl/⌘+Shift+Z или Ctrl+Y.' : 'Только просмотр: отмена и повтор недоступны.';
    element('history-action-status').textContent = operation?.state === 'pending' ? 'Ожидание подтверждения…' : operation?.state === 'success' ? 'Действие подтверждено.' : '';
    element('history-action-error').textContent = operation?.error ?? '';
    element('history-action-retry').hidden = !writable || operation?.state !== 'uncertain';
  }
  function beginHistoryAction(action) {
    if (!workspace.documentId || element('editor-view').hidden || !canEdit()) return;
    if (['pending', 'uncertain'].includes(historyActions.get(workspace.documentId)?.state)) return;
    const operation = { action, commandId: crypto.randomUUID(), state: 'pending' };
    historyActions.set(workspace.documentId, operation); sendHistoryAction(workspace.documentId, operation);
  }
  async function sendHistoryAction(id, operation) {
    if (operation.state === 'pending' && operation.sending) return;
    const epoch = workspace.navigationEpoch, requestToken = workspace.token;
    const active = () => workspace.navigationEpoch === epoch && workspace.documentId === id && workspace.token === requestToken && !element('editor-view').hidden;
    operation.sending = true; operation.state = 'pending'; operation.error = ''; renderHistoryAction();
    try {
      const result = await request(`/api/v1/documents/${encodeURIComponent(id)}/commands/${operation.action}`, {
        method: 'POST', body: JSON.stringify({ commandId: operation.commandId })
      });
      if (!Number.isSafeInteger(result.revision) || result.commandId?.toLowerCase() !== operation.commandId.toLowerCase() || result.documentId?.toLowerCase() !== id.toLowerCase()) throw new TypeError('Некорректное подтверждение');
      if (historyActions.get(id) !== operation) return;
      if (!active()) { operation.state = 'uncertain'; operation.error = 'Результат изменился после перехода. Повторите ту же команду для подтверждения.'; return; }
      operation.state = 'success'; renderHistoryAction();
      await refreshPages();
      if (active()) { element('history-action-status').textContent = 'Действие подтверждено.'; }
    } catch (error) {
      if (historyActions.get(id) !== operation) return;
      if (!active() || !error.status || error.status >= 500) {
        operation.state = 'uncertain'; operation.error = 'Результат неизвестен. Повторите ту же команду: она могла выполниться.';
      } else {
        operation.state = 'failed';
        operation.error = error.code === 'UNDO_NOT_APPLICABLE' ? 'Отмена неприменима к текущему состоянию: возможно, изменения несовместимы с последующими правками.' : error.code === 'REDO_NOT_APPLICABLE' ? 'Повтор неприменим к текущему состоянию: необходимые условия больше не выполняются.' : error.message;
      }
    } finally {
      operation.sending = false;
      if (historyActions.get(id) === operation && workspace.documentId === id && workspace.token && !element('editor-view').hidden) renderHistoryAction();
    }
  }
  element('undo').addEventListener('click', () => beginHistoryAction('undo'));
  element('redo').addEventListener('click', () => beginHistoryAction('redo'));
  element('history-action-retry').addEventListener('click', () => {
    const operation = historyActions.get(workspace.documentId);
    if (operation?.state === 'uncertain' && canEdit()) sendHistoryAction(workspace.documentId, operation);
  });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
    const target = event.target;
    if (target instanceof Element && (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || target.isContentEditable)) return;
    const key = event.key.toLowerCase();
    const action = key === 'z' ? (event.shiftKey ? 'redo' : 'undo') : key === 'y' && !event.shiftKey ? 'redo' : null;
    if (!action || !workspace.documentId || element('editor-view').hidden || !canEdit()) return;
    event.preventDefault(); beginHistoryAction(action);
  });

  function reset() {
    historyController?.abort(); historyController = null; historyGeneration++;
    element('version-save').hidden = true;
    historyCursors = [null]; historyIndex = 0; historyNext = null;
    element('versions-list').replaceChildren();
    element('versions-status').textContent = ''; element('versions-error').textContent = '';
    element('versions-number').textContent = '';
    element('versions-previous').disabled = true; element('versions-next').disabled = true;
    element('restore-status').textContent = ''; element('restore-error').textContent = '';
    element('restore-retry').hidden = true;
  }

  async function loadVersionHistory(index = 0, cursor = null) {
    if (!workspace.documentId || !workspace.token) return;
    historyController?.abort(); historyController = new AbortController();
    const current = ++historyGeneration, id = workspace.documentId;
    element('versions-status').textContent = 'Загрузка истории…';
    element('versions-error').textContent = '';
    element('versions-previous').disabled = element('versions-next').disabled = true;
    try {
      const query = new URLSearchParams({ limit: String(pageSize) });
      if (cursor !== null) query.set('beforeRevision', String(cursor));
      const result = await request(`/api/v1/documents/${encodeURIComponent(id)}/versions?${query}`, {}, historyController.signal);
      if (current !== historyGeneration || workspace.documentId !== id) return;
      historyIndex = index; historyCursors[index] = cursor; historyCursors.length = index + 1; historyNext = result.nextBeforeRevision;
      const list = element('versions-list'); list.replaceChildren();
      for (const version of result.versions) {
        const row = document.createElement('li'), description = document.createElement('span');
        const date = new Date(version.timestamp);
        description.textContent = `${version.name?.trim() || 'Без имени'} · Автор: ${version.authorId} · ${Number.isNaN(date.valueOf()) ? version.timestamp : date.toLocaleString()} · Ревизия ${version.revision}`;
        row.append(description);
        if (canEdit()) {
          const button = document.createElement('button'); button.type = 'button';
          button.textContent = 'Восстановить'; button.setAttribute('aria-label', `Восстановить версию ${version.name?.trim() || 'без имени'}, ревизия ${version.revision}`);
          button.disabled = ['pending', 'uncertain'].includes(restoreOperations.get(id)?.state);
          button.addEventListener('click', () => beginRestore(version)); row.append(' ', button);
        }
        list.append(row);
      }
      element('versions-status').textContent = result.versions.length ? `Версий на странице: ${result.versions.length}` : 'Сохранённых версий нет.';
      element('versions-number').textContent = `Страница ${index + 1}`;
      element('versions-previous').disabled = index === 0; element('versions-next').disabled = historyNext == null;
    } catch (error) {
      if (error.name === 'AbortError' || current !== historyGeneration || workspace.documentId !== id) return;
      element('versions-list').replaceChildren(); element('versions-status').textContent = '';
      element('versions-error').textContent = error instanceof TypeError ? 'Не удалось загрузить историю. Проверьте соединение и обновите историю.' : error.message;
    }
  }

  function renderRestore() {
    const operation = restoreOperations.get(workspace.documentId);
    element('restore-status').textContent = operation?.state === 'pending' ? 'Восстановление версии…' : operation?.state === 'success' ? 'Версия восстановлена в общий черновик.' : '';
    element('restore-error').textContent = operation?.error ?? '';
    element('restore-retry').hidden = operation?.state !== 'uncertain';
    for (const button of element('versions-list').querySelectorAll('button')) button.disabled = ['pending', 'uncertain'].includes(operation?.state);
  }
  function beginRestore(version) {
    if (!canEdit() || ['pending', 'uncertain'].includes(restoreOperations.get(workspace.documentId)?.state)) return;
    if (!confirm(`Восстановить версию «${version.name?.trim() || 'Без имени'}» (ревизия ${version.revision})? Будет создана новая ревизия общего черновика; история сохранённых версий не удалится.`)) return;
    const operation = { versionId: version.id, commandId: crypto.randomUUID() };
    restoreOperations.set(workspace.documentId, operation); submitRestore(workspace.documentId, operation);
  }
  async function submitRestore(id, operation) {
    operation.state = 'pending'; operation.error = ''; if (workspace.documentId === id) renderRestore();
    try {
      const result = await request(`/api/v1/documents/${encodeURIComponent(id)}/commands/restore`, {
        method: 'POST', body: JSON.stringify({ commandId: operation.commandId, versionId: operation.versionId })
      });
      if (!Number.isSafeInteger(result.revision)) throw new TypeError('Отсутствует ревизия');
      operation.state = 'success';
    } catch (error) {
      const uncertain = !error.status || error.status >= 500;
      operation.state = uncertain ? 'uncertain' : 'failed';
      operation.error = uncertain ? 'Не удалось подтвердить восстановление. Повторите эту операцию: она могла выполниться.' : error.code === 'REVISION_CONFLICT' || error.status === 409 ? 'Документ изменился или восстановление конфликтует с текущим состоянием. Обновите страницы и историю перед повтором.' : error.message;
    }
    if (restoreOperations.get(id) !== operation || workspace.documentId !== id || !workspace.token) return;
    renderRestore();
    if (operation.state === 'success' && !element('editor-view').hidden) { await refreshPages(); if (workspace.documentId === id && !element('editor-view').hidden) loadVersionHistory(); }
  }
  element('versions-refresh').addEventListener('click', () => loadVersionHistory());
  element('versions-previous').addEventListener('click', () => loadVersionHistory(historyIndex - 1, historyCursors[historyIndex - 1]));
  element('versions-next').addEventListener('click', () => loadVersionHistory(historyIndex + 1, historyNext));
  element('restore-retry').addEventListener('click', () => {
    const operation = restoreOperations.get(workspace.documentId);
    if (operation?.state === 'uncertain' && canEdit()) submitRestore(workspace.documentId, operation);
  });

  function clearCommands() {
    versionOperations.clear();
    restoreOperations.clear();
    historyActions.clear();
  }

  function prepare() {
    element('version-save').hidden = !canEdit();
    renderVersionSave();
  }

  function load() {
    renderRestore();
    renderHistoryAction();
    return loadVersionHistory();
  }

  return { reset, clearCommands, prepare, load };
}
