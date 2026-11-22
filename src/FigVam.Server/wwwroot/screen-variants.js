export function createScreenVariants({ element, request, refreshPages, pageSize, workspace }) {
  let variantGeneration = 0, variantOffset = 0, variantTotal = 0, variantScreen = null;
  const variantOperations = new Map();
  function variantKey(doc, screen) { return `${doc}/${screen}`; }
  function resetScreenVariants() {
    variantGeneration++; variantOffset = variantTotal = 0; variantScreen = null;
    element('screen-variants-list').replaceChildren(); element('screen-variants-status').textContent = 'Выберите экран.';
    element('screen-variants-error').textContent = ''; element('screen-variants-retry').hidden = true;
    element('screen-variant-create').reset(); renderScreenVariants();
  }
  function renderScreenVariants() {
    const op = variantOperations.get(variantKey(workspace.documentId, workspace.selectedScreen));
    const editable = !!workspace.selectedScreen && ['Owner', 'Editor'].includes(workspace.documentRole);
    element('screen-variant-create').hidden = !editable;
    element('screen-variant-create').querySelector('button').disabled = !!op;
    element('screen-variant-name').readOnly = !!op;
    element('screen-variant-command-retry').hidden = !editable || op?.state !== 'uncertain';
    element('screen-variants-previous').disabled = !workspace.selectedScreen || variantOffset === 0;
    element('screen-variants-next').disabled = !workspace.selectedScreen || variantOffset + pageSize >= variantTotal;
    element('screen-variants-number').textContent = variantTotal ? `${variantOffset + 1}–${Math.min(variantOffset + pageSize, variantTotal)} из ${variantTotal}` : '';
    if (op?.state === 'uncertain') element('screen-variants-error').textContent = 'Результат создания неизвестен. Повторите ту же команду.';
  }
  async function loadScreenVariants() {
    const screen = workspace.selectedScreen, doc = workspace.documentId, atRevision = workspace.revision,
      catalogRevision = workspace.catalogRevision, current = ++variantGeneration;
    if (variantScreen !== screen) { variantOffset = variantTotal = 0; variantScreen = screen; }
    element('screen-variants-list').replaceChildren(); element('screen-variants-error').textContent = '';
    element('screen-variants-retry').hidden = true; renderScreenVariants();
    if (!screen || !doc || !Number.isSafeInteger(atRevision)) { element('screen-variants-status').textContent = 'Выберите экран.'; return; }
    const valid = () => current === variantGeneration && doc === workspace.documentId && screen === workspace.selectedScreen && catalogRevision === workspace.catalogRevision;
    element('screen-variants-status').textContent = 'Загрузка вариантов…';
    try {
      const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/screens/${encodeURIComponent(screen)}/variants?revision=${atRevision}&offset=${variantOffset}&limit=${pageSize}`);
      if (!valid()) return;
      if (result.revision !== atRevision || result.screenId.toLowerCase() !== screen.toLowerCase() || result.documentId.toLowerCase() !== doc.toLowerCase()) throw new TypeError('Некорректный ответ');
      if (variantOffset && !result.items.length) { variantOffset = Math.max(0, variantOffset - pageSize); return loadScreenVariants(); }
      variantTotal = result.total;
      const base = document.createElement('li'); base.textContent = 'Базовое состояние'; element('screen-variants-list').append(base);
      for (const item of result.items) { const li = document.createElement('li'); li.textContent = item.name; element('screen-variants-list').append(li); }
      element('screen-variants-status').textContent = `Сохранённых вариантов: ${result.total} · ревизия ${atRevision}`; renderScreenVariants();
    } catch (error) {
      if (!valid() || error.name === 'AbortError') return;
      element('screen-variants-status').textContent = ''; element('screen-variants-error').textContent = error.message;
      element('screen-variants-retry').hidden = false;
    }
  }
  async function sendScreenVariant(doc, screen, op) {
    const key = variantKey(doc, screen), requestToken = workspace.token, epoch = workspace.navigationEpoch;
    if (op.state === 'pending' || !['Owner', 'Editor'].includes(workspace.documentRole)) return;
    const active = () => doc === workspace.documentId && screen === workspace.selectedScreen && workspace.token === requestToken && epoch === workspace.navigationEpoch && !element('editor-view').hidden;
    op.state = 'pending'; if (active()) { element('screen-variants-error').textContent = ''; renderScreenVariants(); }
    try {
      await request(`/api/v1/documents/${encodeURIComponent(doc)}/commands/add-screen-variant`, { method: 'POST', body: JSON.stringify(op.body) });
      if (variantOperations.get(key) !== op) return;
      variantOperations.delete(key);
      if (active()) { element('screen-variant-create').reset(); await refreshPages(); }
    } catch (error) {
      if (variantOperations.get(key) !== op) return;
      if (error instanceof TypeError || error.name === 'AbortError' || !error.status || error.status >= 500) op.state = 'uncertain';
      else { variantOperations.delete(key); if (active()) element('screen-variants-error').textContent = error.message; }
    } finally { if (active()) renderScreenVariants(); }
  }
  element('screen-variant-create').addEventListener('submit', event => {
    event.preventDefault(); const doc = workspace.documentId, screen = workspace.selectedScreen, key = variantKey(doc, screen);
    if (!screen || !['Owner', 'Editor'].includes(workspace.documentRole) || variantOperations.has(key)) return;
    const op = { body: { commandId: crypto.randomUUID(), screenId: screen, variantId: crypto.randomUUID(), name: element('screen-variant-name').value }, state: 'ready' };
    variantOperations.set(key, op); sendScreenVariant(doc, screen, op);
  });
  element('screen-variant-command-retry').addEventListener('click', () => { const op = variantOperations.get(variantKey(workspace.documentId, workspace.selectedScreen)); if (op?.state === 'uncertain') sendScreenVariant(workspace.documentId, workspace.selectedScreen, op); });
  element('screen-variants-previous').addEventListener('click', () => { variantOffset = Math.max(0, variantOffset - pageSize); loadScreenVariants(); });
  element('screen-variants-next').addEventListener('click', () => { variantOffset += pageSize; loadScreenVariants(); });
  element('screen-variants-retry').addEventListener('click', loadScreenVariants);
  return { reset: resetScreenVariants, load: loadScreenVariants };
}
