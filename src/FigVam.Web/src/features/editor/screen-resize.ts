import { ApiError } from '../api/api-client.js';
import type { components } from '../api/schema.generated';

type Axis = 'width' | 'height';
type ResizeBody = components['schemas']['ResizeScreenRequest'];
interface Operation { body: ResizeBody; state: 'pending' | 'uncertain' }
interface ResizeWorkspace {
  documentId: string | null; documentRole: string | null; selectedScreen: string | null;
  screensItems: { id: string; dimensions: { width: number; height: number } }[];
  generation: number; token: string | null;
}
interface ResizeOptions {
  element(id: string): HTMLElement;
  request(path: string, options: RequestInit): Promise<unknown>;
  refreshPages(): Promise<unknown>;
  workspace: ResizeWorkspace;
}
export function createScreenResize({ element, request, refreshPages, workspace }: ResizeOptions) {
  const resizeOperations = new Map<string, Operation>();
  let resizeDraftScreen: string | null = null, resizeError: string | null = null, resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const dirtyAxes = new Set<Axis>();
  const listeners = new AbortController();
  const signal = listeners.signal;
  function inputElement(id: string): HTMLInputElement {
    const input = element(id);
    if (!(input instanceof HTMLInputElement)) throw new TypeError('Expected input: ' + id);
    return input;
  }

  function resizeKey(id: string | null, screen: string | null) { return `${id}:${screen}`; }
  function renderScreenSize() {
    const screen = workspace.screensItems.find(item => item.id === workspace.selectedScreen);
    const form = element('screen-resize'), operation = screen && resizeOperations.get(resizeKey(workspace.documentId, screen.id));
    element('screen-size-saved').textContent = screen ? `Подтверждённый размер: ${screen.dimensions.width} × ${screen.dimensions.height} uiUnit` : 'Выберите экран.';
    form.hidden = !screen || !['Owner', 'Editor'].includes(workspace.documentRole ?? '');
    if (resizeDraftScreen !== screen?.id) { resizeDraftScreen = screen?.id ?? null; dirtyAxes.clear(); resizeError = null; }
    if (screen) {
      for (const axis of ['width', 'height'] as const) {
        const input = inputElement('resize-' + axis);
        const sent = operation && operation.body[axis === 'width' ? 'updateWidth' : 'updateHeight'];
        if (sent) input.value = String(operation.body.dimensions[axis]);
        else if (!dirtyAxes.has(axis)) input.value = String(screen.dimensions[axis]);
      }
    }
    for (const id of ['resize-width', 'resize-height']) inputElement(id).readOnly = !!operation;
    element('resize-retry').hidden = operation?.state !== 'uncertain';
    element('screen-size-status').textContent = operation?.state === 'pending' ? 'Ожидание подтверждения…' : '';
    element('screen-size-error').textContent = operation?.state === 'uncertain' ? 'Результат неизвестен. Повторите ту же команду.' : resizeError ?? '';
  }
  for (const axis of ['width', 'height'] as const) {
    const input = inputElement('resize-' + axis);
    input.addEventListener('input', () => {
      dirtyAxes.add(axis); resizeError = null; element('screen-size-error').textContent = '';
      clearTimeout(resizeTimer);
      const screen = workspace.selectedScreen, doc = workspace.documentId;
      resizeTimer = setTimeout(() => {
        if (screen === workspace.selectedScreen && doc === workspace.documentId) applyResize();
      }, 500);
    }, { signal });
    input.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); applyResize(); }
      if (event.key === 'Escape' && !input.readOnly) {
        clearTimeout(resizeTimer); dirtyAxes.clear(); resizeError = null; renderScreenSize();
      }
    }, { signal });
  }
  element('screen-resize').addEventListener('focusout', event => {
    if (!(event.relatedTarget instanceof Node) || !element('screen-resize').contains(event.relatedTarget)) applyResize();
  }, { signal });
  element('screen-resize').addEventListener('submit', event => { event.preventDefault(); applyResize(); }, { signal });
  function applyResize() {
    clearTimeout(resizeTimer);
    if (!dirtyAxes.size) return;
    if (!workspace.documentId || !workspace.selectedScreen || !['Owner', 'Editor'].includes(workspace.documentRole ?? '')) return;
    const width = inputElement('resize-width').valueAsNumber, height = inputElement('resize-height').valueAsNumber;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
      resizeError = 'Введите конечные неотрицательные ширину и высоту.'; renderScreenSize(); return;
    }
    const key = resizeKey(workspace.documentId, workspace.selectedScreen);
    if (resizeOperations.has(key)) return;
    const saved = workspace.screensItems.find(item => item.id === workspace.selectedScreen)?.dimensions;
    const updateWidth = dirtyAxes.has('width') && saved?.width !== width;
    const updateHeight = dirtyAxes.has('height') && saved?.height !== height;
    if (!updateWidth && !updateHeight) { dirtyAxes.clear(); return; }
    const operation: Operation = { body: { commandId: crypto.randomUUID(), screenId: workspace.selectedScreen,
      dimensions: { width, height }, updateWidth, updateHeight }, state: 'pending' };
    resizeError = null; resizeOperations.set(key, operation); sendResize(workspace.documentId, workspace.selectedScreen, operation);
  }
  element('resize-retry').addEventListener('click', () => {
    const operation = resizeOperations.get(resizeKey(workspace.documentId, workspace.selectedScreen));
    if (workspace.documentId && workspace.selectedScreen && operation?.state === 'uncertain') sendResize(workspace.documentId, workspace.selectedScreen, operation);
  }, { signal });
  async function sendResize(id: string, screen: string, operation: Operation) {
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
      if (!active() || error instanceof TypeError || (error instanceof ApiError && error.status >= 500) || (error instanceof Error && error.name === 'AbortError')) operation.state = 'uncertain';
      else { resizeOperations.delete(key); if (workspace.selectedScreen === screen) { dirtyAxes.clear(); resizeError = error instanceof Error ? error.message : String(error); } }
    } finally { if (active() || (workspace.token === requestToken && workspace.documentId === id && workspace.selectedScreen === screen && resizeOperations.get(key) === operation && !element('editor-view').hidden)) { renderScreenSize(); } }
  }

  return {
    render: renderScreenSize,
    dispose() { clearTimeout(resizeTimer); listeners.abort(); resizeOperations.clear(); },
    resetDraft() { clearTimeout(resizeTimer); dirtyAxes.clear(); resizeError = null; resizeDraftScreen = null; },
    clear() { clearTimeout(resizeTimer); resizeOperations.clear(); resizeDraftScreen = null; dirtyAxes.clear(); resizeError = null; }
  };
}
