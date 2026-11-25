export function createScreenResize({ element, request, refreshPages, workspace }) {
  const resizeOperations = new Map();
  let resizeDraftScreen = null, resizeError = null, resizeTimer;
  const dirtyAxes = new Set();

  function resizeKey(id, screen) { return `${id}:${screen}`; }
  function renderScreenSize() {
    const screen = workspace.screensItems.find(item => item.id === workspace.selectedScreen);
    const form = element('screen-resize'), operation = screen && resizeOperations.get(resizeKey(workspace.documentId, screen.id));
    element('screen-size-saved').textContent = screen ? `Подтверждённый размер: ${screen.dimensions.width} × ${screen.dimensions.height} uiUnit` : 'Выберите экран.';
    form.hidden = !screen || !['Owner', 'Editor'].includes(workspace.documentRole);
    if (resizeDraftScreen !== screen?.id) { resizeDraftScreen = screen?.id ?? null; dirtyAxes.clear(); resizeError = null; }
    if (screen) {
      for (const axis of ['width', 'height']) {
        const input = element('resize-' + axis);
        const sent = operation && operation.body[axis === 'width' ? 'updateWidth' : 'updateHeight'];
        if (sent) input.value = operation.body.dimensions[axis];
        else if (!dirtyAxes.has(axis)) input.value = screen.dimensions[axis];
      }
    }
    for (const id of ['resize-width', 'resize-height']) element(id).readOnly = !!operation;
    element('resize-retry').hidden = operation?.state !== 'uncertain';
    element('screen-size-status').textContent = operation?.state === 'pending' ? 'Ожидание подтверждения…' : '';
    element('screen-size-error').textContent = operation?.state === 'uncertain' ? 'Результат неизвестен. Повторите ту же команду.' : resizeError ?? '';
  }
  for (const id of ['resize-width', 'resize-height']) {
    const input = element(id);
    input.addEventListener('input', () => {
      dirtyAxes.add(id.slice('resize-'.length)); resizeError = null; element('screen-size-error').textContent = '';
      clearTimeout(resizeTimer);
      const screen = workspace.selectedScreen, doc = workspace.documentId;
      resizeTimer = setTimeout(() => {
        if (screen === workspace.selectedScreen && doc === workspace.documentId) applyResize();
      }, 500);
    });
    input.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); applyResize(); }
      if (event.key === 'Escape' && !input.readOnly) {
        clearTimeout(resizeTimer); dirtyAxes.clear(); resizeError = null; renderScreenSize();
      }
    });
  }
  element('screen-resize').addEventListener('focusout', event => {
    if (!element('screen-resize').contains(event.relatedTarget)) applyResize();
  });
  element('screen-resize').addEventListener('submit', event => { event.preventDefault(); applyResize(); });
  function applyResize() {
    clearTimeout(resizeTimer);
    if (!dirtyAxes.size) return;
    if (!workspace.selectedScreen || !['Owner', 'Editor'].includes(workspace.documentRole)) return;
    const width = element('resize-width').valueAsNumber, height = element('resize-height').valueAsNumber;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
      resizeError = 'Введите конечные неотрицательные ширину и высоту.'; renderScreenSize(); return;
    }
    const key = resizeKey(workspace.documentId, workspace.selectedScreen);
    if (resizeOperations.has(key)) return;
    const saved = workspace.screensItems.find(item => item.id === workspace.selectedScreen)?.dimensions;
    const updateWidth = dirtyAxes.has('width') && saved?.width !== width;
    const updateHeight = dirtyAxes.has('height') && saved?.height !== height;
    if (!updateWidth && !updateHeight) { dirtyAxes.clear(); return; }
    const operation = { body: { commandId: crypto.randomUUID(), screenId: workspace.selectedScreen,
      dimensions: { width, height }, updateWidth, updateHeight }, state: 'pending' };
    resizeError = null; resizeOperations.set(key, operation); sendResize(workspace.documentId, workspace.selectedScreen, operation);
  }
  element('resize-retry').addEventListener('click', () => {
    const operation = resizeOperations.get(resizeKey(workspace.documentId, workspace.selectedScreen));
    if (operation?.state === 'uncertain') sendResize(workspace.documentId, workspace.selectedScreen, operation);
  });
  async function sendResize(id, screen, operation) {
    const key = resizeKey(id, screen), current = workspace.generation, requestToken = workspace.token;
    const active = () => current === workspace.generation && workspace.documentId === id && workspace.token === requestToken && !element('editor-view').hidden;
    operation.state = 'pending'; renderScreenSize();
    try {
      await request(`/api/v1/documents/${encodeURIComponent(id)}/commands/resize-screen`, { method: 'POST', body: JSON.stringify(operation.body) });
      if (resizeOperations.get(key) !== operation) return;
      if (!active()) { operation.state = 'uncertain'; return; }
      resizeOperations.delete(key); if (workspace.selectedScreen === screen) dirtyAxes.clear();
      await refreshPages();
      if (active() && workspace.selectedScreen === screen) element('screen-size-status').textContent = 'Размер подтверждён.';
    } catch (error) {
      if (resizeOperations.get(key) !== operation) return;
      if (!active() || error instanceof TypeError || error.status >= 500 || error.name === 'AbortError') operation.state = 'uncertain';
      else { resizeOperations.delete(key); if (workspace.selectedScreen === screen) { dirtyAxes.clear(); resizeError = error.message; } }
    } finally { if (active() || (workspace.token === requestToken && workspace.documentId === id && workspace.selectedScreen === screen && resizeOperations.get(key) === operation && !element('editor-view').hidden)) { renderScreenSize(); } }
  }

  return {
    render: renderScreenSize,
    resetDraft() { clearTimeout(resizeTimer); dirtyAxes.clear(); resizeError = null; resizeDraftScreen = null; },
    clear() { clearTimeout(resizeTimer); resizeOperations.clear(); resizeDraftScreen = null; dirtyAxes.clear(); resizeError = null; }
  };
}
