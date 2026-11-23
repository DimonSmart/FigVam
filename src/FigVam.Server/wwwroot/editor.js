import { authHeaders, credentialsMode, configureAuth, isGoogleMode, setCsrf } from './auth-client.js';
import { createUserAdmin } from './user-admin.js';
import { createApiClient } from './api-client.js';
import { createDocumentCollaboration } from './document-collaboration.js';
import { createCanvasViewport } from './canvas-viewport.js';
import { createEditorShell } from './editor-shell.js';
import { createVisualScreens } from './visual-screen.js';
import { createCanvasNodeEditor } from './canvas-node-editor.js';
import { createVisualNodeEditor } from './visual-node-editor.js';
import { createPresence } from './presence.js';
import { createMembers } from './members.js';
import { createLayers } from './layers.js';
import { createDatasets } from './datasets.js';
import { createDocumentHistory } from './document-history.js';
import { createDocumentExport } from './document-export.js';
import { createComponents } from './components.js';
import { createScenarios } from './scenarios.js';
import { createScreenDiagnostics } from './screen-diagnostics.js';
import { createScreenResize } from './screen-resize.js';
import { createScreenVariants } from './screen-variants.js';
import { createTokens } from './tokens.js';
import { token, generation, pending, navigationEpoch, setToken, advanceNavigation, cancelRequest, startRequest, replacePendingRequest } from './session.js';

const element = id => document.getElementById(id);
createEditorShell();
const userAdmin = createUserAdmin(element);
function selectHomeView(view) {
  const users = view === 'users' && !element('home-users').hidden;
  element('home-documents-content').hidden = users;
  element('home-admin-content').hidden = !users;
  element('home-documents').setAttribute('aria-current', users ? 'false' : 'page');
  element('home-users').setAttribute('aria-current', users ? 'page' : 'false');
}
let cursors = [null];
let pageIndex = 0;
let nextCursor = null;
let retry = null;
const pageSize = 20;
let documentId = null, documentRole = null, revision = null, selectedPage = null, pagesOffset = 0, pagesTotal = 0;
let catalogRevision = null;
let pagesItems = [];
let importOperation = null;
let deletion = null;
function resetDeletion() {
  deletion = null;
  element('delete-result').hidden = true;
  element('delete-retry').hidden = true;
  element('delete-document').disabled = false;
}
function leaveDeletion() {
  if (!deletion) return;
  deletion.state = 'uncertain';
  element('delete-result').hidden = false;
  element('delete-retry').hidden = false;
  element('delete-message').textContent = `Результат удаления документа «${deletion.name}» неизвестен. Повторите запрос, чтобы получить подтверждение; документ мог быть удалён.`;
}
let selectedScreen = null, screensOffset = 0, screensTotal = 0, screensItems = [];
let editingScreenName = null;
let pageExpanded = true;
let statusDismissTimer = null;
const diagnostics = createScreenDiagnostics({
  element, request: (...args) => request(...args), pageSize,
  getContext: () => ({ documentId, screen: selectedScreen, revision, token, navigationEpoch })
});
const screenResize = createScreenResize({
  element, request: (...args) => request(...args), refreshPages: (...args) => refreshPages(...args),
  workspace: {
    get documentId() { return documentId; }, get documentRole() { return documentRole; },
    get selectedScreen() { return selectedScreen; }, get screensItems() { return screensItems; },
    get generation() { return generation; }, get token() { return token; }
  }
});

const request = createApiClient({
  getToken: () => token,
  onUnauthorized: () => {
    clearSession();
    message('', 'Сессия завершена. Войдите повторно.');
  }
});

const { start: startLive, stop: stopLive } = createDocumentCollaboration({
  request,
  workspace: {
    get documentId() { return documentId; },
    get revision() { return revision; },
    get token() { return token; }
  },
  isEditorVisible: () => !element('editor-view').hidden,
  readRevision: (signal, targetRevision) => readPages(signal, pagesOffset, targetRevision),
  onConnectionStatus: status => { element('connection-status').textContent = status; },
  onAccessLost: closeInaccessibleDocument,
  onUnauthorized: () => {
    clearSession();
    message('', 'Сессия завершена. Войдите повторно.');
  }
});

const documentExport = createDocumentExport({
  element, getContext: () => ({ token, documentId, documentRole, revision, navigationEpoch }),
  onUnauthorized: () => {
    clearSession();
    message('', 'Сессия завершена. Войдите повторно.');
  }
});

const tokens = createTokens({
  element, request: (...args) => request(...args),
  getContext: () => ({ documentId, documentRole, revision, generation }),
  startRequest, stopLive, startLive, readPages
});
const components = createComponents({
  element, request: (...args) => request(...args), pageSize,
  getContext: () => ({ documentId, revision, catalogRevision })
});
const screenVariants = createScreenVariants({
  element, request: (...args) => request(...args), refreshPages: (...args) => refreshPages(...args),
  onSelectionChanged: () => renderCanvas(), pageSize,
  workspace: {
    get documentId() { return documentId; }, get documentRole() { return documentRole; },
    get selectedScreen() { return selectedScreen; }, get revision() { return revision; },
    get catalogRevision() { return catalogRevision; },
    get token() { return token; }, get navigationEpoch() { return navigationEpoch; }
  }
});
const datasets = createDatasets({
  element, request: (...args) => request(...args), pageSize,
  getContext: () => ({ documentId, documentRole, revision, catalogRevision, token, generation }),
  startRequest, stopLive, startLive, readPages, run
});
function closeInaccessibleDocument(status) {
  cancelRequest(); advanceNavigation();
  diagnostics.reset(); scenarios.reset(); layers.reset(); documentHistory.reset();
  members.reset(); documentExport.reset(); documentRole = null; revision = null; pagesItems = []; screensItems = []; selectedPage = selectedScreen = null; editingScreenName = null; pageExpanded = true;
  element('page-edit').inert = element('screen-create').inert = false;
  element('revision').textContent = ''; element('document-title').textContent = '';
  document.title = 'FigVam — доступ потерян';
  renderPages(); renderScreens(); element('editor-view').hidden = true;
  presence.stop(); stopLive(); message('', status === 404 ? 'Документ удалён или больше недоступен.' : 'Доступ к документу потерян. Запросите права у владельца и откройте документ снова.');
}

function message(status = '', error = '') {
  clearTimeout(statusDismissTimer);
  statusDismissTimer = null;
  element('status').textContent = status;
  element('error').textContent = error;
  element('retry').hidden = !error || !retry;
  // Progress and errors are persistent; successful editor notifications expire.
  if (status && !error && !status.endsWith('…') && !element('editor-view').hidden) {
    statusDismissTimer = setTimeout(() => {
      if (element('status').textContent === status) element('status').textContent = '';
      statusDismissTimer = null;
    }, 4000);
  }
}

function clearSession() {
  importOperation = null;
  element('import-form').reset();
  element('import-file-name').textContent = 'Файл не выбран';
  element('import-form').querySelector('button').disabled = false;
  element('import-status').textContent = element('import-error').textContent = '';
  element('import-diagnostics').replaceChildren();
  resetDeletion();
  presence.stop(); advanceNavigation(); diagnostics.reset(); scenarios.reset(); members.reset(); documentExport.reset(); scenarios.clearCommands(); layers.clearCommands();
  stopLive();
  setToken('');
  setCsrf('');
  userAdmin.hide();
  element('home-users').hidden = true;
  selectHomeView('documents');
  documentHistory.clearCommands(); screenResize.clear(); documentHistory.reset();
  visualNodeEditor.clear();
  cancelRequest();
  element('token').value = '';
  element('document-name').value = '';
  element('document-list').replaceChildren();
  documentId = documentRole = revision = selectedPage = null; pagesOffset = pagesTotal = 0; pagesItems = [];
  // Detach the nested screen list before clearing its parent page rows.
  const screenList = element('screens');
  screenList.remove();
  element('pages').replaceChildren();
  element('pages').closest('.editor-group').append(screenList);
  selectedScreen = null; screensOffset = screensTotal = 0; screensItems = []; editingScreenName = null;
  screenList.replaceChildren();
  layers.reset();
  tokens.reset(); components.reset(); datasets.reset(); screenVariants.reset();
  renderCanvas();
  element('screen-create').reset();
  element('page-edit').inert = false;
  element('screen-create').inert = false;
  element('document-title').textContent = '';
  resetDocumentRename();
  element('revision').textContent = '';
  document.title = 'FigVam — документы';
  element('content').setAttribute('aria-busy', 'false');
  element('create-form').querySelector('button').disabled = false;
  element('content').hidden = true;
  element('documents-view').hidden = true;
  element('editor-view').hidden = true;
  element('authentication').hidden = false;
  element('disconnect').hidden = true;
  cursors = [null]; pageIndex = 0; nextCursor = null;
  retry = null;
  message();
}

const members = createMembers({
  element, request, findRole, openDocument, loadList, message, stopLive, startLive,
  workspace: {
    get documentId() { return documentId; },
    get documentRole() { return documentRole; },
    get navigationEpoch() { return navigationEpoch; },
    get token() { return token; }
  }
});

const documentHistory = createDocumentHistory({
  element, request, pageSize, refreshPages,
  workspace: {
    get documentId() { return documentId; },
    get documentRole() { return documentRole; },
    get navigationEpoch() { return navigationEpoch; },
    get token() { return token; }
  }
});

const layers = createLayers({
  element, request, refreshPages, closeInaccessibleDocument, message,
  workspace: {
    get documentId() { return documentId; },
    get documentRole() { return documentRole; },
    get selectedScreen() { return selectedScreen; },
    get revision() { return revision; },
    get navigationEpoch() { return navigationEpoch; },
    get token() { return token; }
  },
  runPageRefresh: work => run(() => refreshPages(), work),
  readCurrentPages: (signal, isCurrent, reveal) => readPages(signal, pagesOffset, null, isCurrent, reveal),
  onSelectionCleared: () => { scenarios.clearLayerSelection(); visualScreens.syncSelection(); visualNodeEditor.refresh(); },
  onLayerSelected: () => { scenarios.onLayerSelected(); visualScreens.syncSelection(); visualNodeEditor.refresh(); }
});

const scenarios = createScenarios({
  element, request, pageSize,
  workspace: {
    get documentId() { return documentId; },
    get documentRole() { return documentRole; },
    get revision() { return revision; },
    get selectedScreen() { return selectedScreen; },
    get layerSelection() { return layers.selection; },
    get hasLayers() { return layers.hasLayers; }
  },
  findLayer: layers.findLayer,
  reloadPages: (targetRevision, isCurrent) =>
    run(() => refreshPages(), signal => readPages(signal, pagesOffset, targetRevision, isCurrent)),
  findRole,
  setDocumentRole: role => { documentRole = role; visualNodeEditor.refresh(); },
  closeInaccessibleDocument
});

async function run(action, work, { create = false, quiet = false } = {}) {
  stopLive();
  const { signal, current } = startRequest();
  retry = create ? null : action;
  if (!quiet) {
    message(create ? 'Создание документа…' : 'Загрузка…');
    element('content').setAttribute('aria-busy', 'true');
  }
  element('create-form').querySelector('button').disabled = true;
  element('next').disabled = true;
  element('previous').disabled = true;
  try {
    await work(signal, () => current === generation);
  } catch (error) {
    if (error.name === 'AbortError') return;
    // A 401 clears the whole session, including its generation.
    if (current !== generation && token) return;
    const explanation = error instanceof TypeError ? 'Не удалось связаться с сервером. Проверьте соединение.' : error.message;
    message('', explanation + (create && token ? ' Перед повторным созданием обновите список: запрос мог успеть выполниться.' : ''));
  } finally {
    if (current === generation) {
      if (!quiet) element('content').setAttribute('aria-busy', 'false');
      element('create-form').querySelector('button').disabled = false;
      element('previous').disabled = pageIndex === 0;
      element('next').disabled = !nextCursor;
      startLive();
    }
  }
}

async function loadList(index = 0, cursor = null) {
  leaveDeletion();
  if (!token) return;
  presence.stop(); advanceNavigation(); diagnostics.reset(); scenarios.reset(); members.reset(); documentExport.reset();
  stopLive();
  layers.reset();
  documentHistory.reset(); documentId = documentRole = null;
  selectedScreen = null; screensItems = []; renderCanvas();
  element('documents-view').hidden = false;
  element('editor-view').hidden = true;
  selectHomeView('documents');
  element('document-list').replaceChildren();
  element('home-empty').hidden = true;
  element('home-count').textContent = '';
  element('home-pagination').hidden = true;
  element('page-number').textContent = '';
  document.title = 'FigVam — документы';
  nextCursor = null;
  await run(() => loadList(index, cursor), async (signal, current) => {
    const query = new URLSearchParams({ limit: String(pageSize) });
    if (cursor) query.set('cursor', cursor);
    const result = await request(`/api/v1/documents?${query}`, {}, signal);
    if (!current()) return;
    pageIndex = index;
    cursors[index] = cursor;
    cursors.length = index + 1;
    nextCursor = result.nextCursor;
    for (const item of result.items) {
      const row = document.createElement('li');
      const art = document.createElement('div');
      art.className = 'document-art';
      art.setAttribute('aria-hidden', 'true');
      // Neutral placeholder, not a fabricated preview of the document.
      art.innerHTML = '<div class="document-art-window"><div class="document-art-content"><div class="document-art-rail"></div><div class="document-art-lines"><span></span><span></span><span></span></div></div></div>';
      const details = document.createElement('div');
      details.className = 'document-card-meta';
      const link = document.createElement('a');
      link.href = `/documents/${encodeURIComponent(item.documentId)}`;
      link.dataset.navigation = '';
      link.textContent = item.name;
      const role = document.createElement('span');
      role.className = 'document-role';
      role.textContent = { Owner: 'Владелец', Editor: 'Редактор', Viewer: 'Просмотр' }[item.role] ?? item.role;
      details.append(link, role);
      row.append(art, details);
      element('document-list').append(row);
    }
    element('home-count').textContent = `${result.items.length} на странице`;
    element('home-empty').hidden = result.items.length > 0 || index > 0;
    element('home-pagination').hidden = index === 0 && !nextCursor;
    element('page-number').textContent = `Страница ${index + 1}`;
    message(result.items.length ? `Документов на странице: ${result.items.length}` : 'Доступных документов нет. Создайте документ или запросите права у владельца.');
  });
}

async function findRole(id, signal) {
  let cursor = null;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const result = await request(`/api/v1/documents?${query}`, {}, signal);
    const item = result.items.find(item => item.documentId.toLowerCase() === id.toLowerCase());
    if (item) return item.role;
    cursor = result.nextCursor;
  } while (cursor);
  return null;
}

function renderPages() {
  const list = element('pages');
  const screensList = element('screens');
  // Preserve the same live screen list (and its handlers) as the selected page changes.
  screensList.remove();
  list.replaceChildren();
  for (const item of pagesItems) {
    const selected = item.id === selectedPage;
    const row = document.createElement('li');
    row.className = 'page-tree-item';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'page-select';
    button.dataset.pageId = item.id;
    button.textContent = item.name;
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-expanded', String(selected && pageExpanded));
    button.addEventListener('click', () => {
      if (selectedPage === item.id) {
        pageExpanded = !pageExpanded;
        renderPages();
        element('pages').querySelector('[data-page-id="' + item.id + '"]')?.focus();
        return;
      }
      layers.onScreenContextChanged();
      selectedPage = item.id;
      selectedScreen = null;
      screensItems = []; screensTotal = 0;
      pageExpanded = true;
      diagnostics.reset(); scenarios.reset(); screenVariants.reset(); layers.reset();
      renderPages(); renderScreens(); refreshPages();
    });
    row.append(button);
    if (selected && pageExpanded) row.append(screensList);
    list.append(row);
  }
  if (!screensList.isConnected) list.closest('.editor-group').append(screensList);
  screensList.hidden = !selectedPage || !pageExpanded;
  const selected = pagesItems.find(item => item.id === selectedPage);
  element('page-name').value = selected?.name ?? '';
  element('page-rename').querySelector('button').disabled = !selected;
  element('page-name').disabled = !selected;
  element('page-delete').disabled = !selected;
}

function startScreenNameEdit(id, name) {
  if (!['Owner', 'Editor'].includes(documentRole)) return;
  editingScreenName = { id, value: name };
  renderScreens();
  const input = element('screen-name-input');
  input?.focus();
  input?.select();
}

function renderScreens() {
  const list = element('screens');
  const focusedScreenId = document.activeElement?.dataset?.screenId;
  const previousInput = document.activeElement?.id === 'screen-name-input' ? document.activeElement : null;
  const selection = previousInput ? [previousInput.selectionStart, previousInput.selectionEnd] : null;
  if (editingScreenName && (!screensItems.some(item => item.id === editingScreenName.id) ||
      !['Owner', 'Editor'].includes(documentRole))) editingScreenName = null;
  list.replaceChildren();
  for (const [index, item] of screensItems.entries()) {
    const name = item.name ?? `Экран ${screensOffset + index + 1}`;
    const row = document.createElement('li');
    row.className = 'screen-row';
    if (editingScreenName?.id === item.id) {
      const form = document.createElement('form');
      form.className = 'screen-rename-form';
      const input = document.createElement('input');
      input.id = 'screen-name-input';
      input.type = 'text';
      input.required = true;
      input.maxLength = 256;
      input.autocomplete = 'off';
      input.setAttribute('aria-label', 'Имя экрана');
      input.value = editingScreenName.value;
      input.addEventListener('input', () => {
        editingScreenName.value = input.value;
        input.setCustomValidity('');
      });
      const save = document.createElement('button');
      save.type = 'submit'; save.className = 'screen-rename-confirm';
      save.textContent = '✓'; save.title = 'Сохранить название';
      save.setAttribute('aria-label', 'Сохранить название экрана');
      const cancel = document.createElement('button');
      cancel.type = 'button'; cancel.className = 'screen-rename-cancel';
      cancel.textContent = '×'; cancel.title = 'Отменить переименование';
      cancel.setAttribute('aria-label', 'Отменить переименование экрана');
      const discard = () => { editingScreenName = null; renderScreens(); };
      cancel.addEventListener('click', discard);
      input.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); discard(); }
      });
      form.addEventListener('submit', event => {
        event.preventDefault();
        const newName = input.value.trim();
        if (!newName || /[\u0000-\u001f\u007f-\u009f]/.test(newName)) {
          input.setCustomValidity('Укажите непустое имя без управляющих символов.');
          input.reportValidity();
          return;
        }
        editingScreenName = null;
        renderScreens();
        if (newName !== name) pageCommand('rename-screen', { screenId: item.id, name: newName });
      });
      form.append(input, save, cancel);
      row.append(form);
    } else {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'screen-select'; button.dataset.screenId = item.id;
      button.textContent = `${name} · ${item.dimensions.width} × ${item.dimensions.height}`;
      button.title = name;
      button.setAttribute('aria-pressed', String(item.id === selectedScreen));
      button.addEventListener('click', () => {
        if (selectedScreen !== item.id) {
          layers.onScreenContextChanged(); selectedScreen = item.id; diagnostics.reset(); scenarios.reset();
          screenVariants.reset(); screenResize.render(); refreshPages();
        }
        for (const other of list.querySelectorAll('button[data-screen-id]'))
          other.setAttribute('aria-pressed', String(other === button));
        renderCanvas();
      });
      row.append(button);
      if (['Owner', 'Editor'].includes(documentRole)) {
        const rename = document.createElement('input');
        rename.type = 'button'; rename.value = '✎'; rename.className = 'screen-rename-action';
        rename.title = 'Переименовать экран';
        rename.setAttribute('aria-label', `Переименовать экран «${name}»`);
        rename.addEventListener('click', () => startScreenNameEdit(item.id, name));
        row.append(rename);
        const menu = document.createElement('details');
        menu.className = 'screen-context-menu';
        const trigger = document.createElement('summary');
        trigger.setAttribute('aria-label', `Действия с экраном «${name}»`);
        trigger.title = 'Действия с экраном';
        trigger.textContent = '⋯';
        const duplicate = document.createElement('input');
        duplicate.type = 'button';
        duplicate.value = 'Duplicate';
        duplicate.setAttribute('aria-label', `Дублировать экран «${name}»`);
        duplicate.addEventListener('click', () => {
          menu.open = false;
          const newScreenId = crypto.randomUUID();
          pageCommand('duplicate-screen', { screenId: item.id, newScreenId, expectedRevision: revision },
            undefined, newScreenId);
        });
        menu.append(trigger, duplicate);
        row.addEventListener('contextmenu', event => {
          if (event.target.closest('input, button, summary')) return;
          event.preventDefault();
          menu.open = true;
          duplicate.focus({ preventScroll: true });
        });
        row.append(menu);
      }
    }
    list.append(row);
  }
  if (selection && editingScreenName) {
    const input = element('screen-name-input');
    if (input) { input.focus({ preventScroll: true }); input.setSelectionRange(...selection); }
  }
  if (focusedScreenId && !editingScreenName)
    list.querySelector('[data-screen-id="' + focusedScreenId + '"]')?.focus({ preventScroll: true });
  renderCanvas(); screenResize.render();
  const activeScreen = screensItems.find(item => item.id === selectedScreen);
  element('layers-title').textContent = activeScreen
    ? `Слои · ${activeScreen.name ?? 'Экран ' + (screensItems.indexOf(activeScreen) + 1)}`
    : 'Слои выбранного экрана';
  element('screen-create').querySelectorAll('input, button').forEach(control => { control.disabled = !selectedPage; });
  const screenMenu = element('screen-preset').closest('details');
  screenMenu.hidden = documentRole !== 'Owner' && documentRole !== 'Editor';
  // Only suggest creation on the first empty page. Opening the popover on every
  // navigation obscures the page tree, and closing a user-opened menu mid-command
  // makes the form unusable while the page creation is still being committed.
  if (selectedScreen || screensItems.length > 0 || pagesItems.length > 1) screenMenu.open = false;
  else if (selectedPage && pagesItems.length === 1 &&
      (documentRole === 'Owner' || documentRole === 'Editor') &&
      !element('page-edit').querySelector('.page-options').open) screenMenu.open = true;
}




const presence = createPresence({
  element,
  getContext: () => ({ token, documentId, navigationEpoch, selectedScreen, selectedLayer: layers.selection }),
  toViewportPoint: point => canvasViewport.toViewportPoint(point)
});
const canvasViewport = createCanvasViewport({
  element,
  getScreen: () => screensItems.find(item => item.id === selectedScreen),
  getSelectedScreen: () => selectedScreen,
  onViewportChange: presence.render,
  setPresenceCursor: presence.setCursor
});
const visualScreens = createVisualScreens({
  element, request, closeInaccessibleDocument, onDesignChange: () => canvasNodes.sync(),
  getContext: () => ({ documentId, revision, screen: screensItems.find(item => item.id === selectedScreen),
    selection: layers.selection, tokens: tokens.items, variantId: screenVariants.selectedVariantId })
});
const visualNodeEditor = createVisualNodeEditor({
  element, request, readModel: visualScreens.readDesignModel, closeInaccessibleDocument, stopLive, startLive,
  getContext: () => ({ documentId, documentRole, revision, screen: selectedScreen,
    variantId: screenVariants.selectedVariantId, selection: layers.selection, navigationEpoch, token }),
  refreshDocument: async (newRevision, isCurrent, reveal, selection, resourcesChanged = false) => {
    let synced = false;
    await run(() => refreshPages(), async (signal, current) => {
      synced = (newRevision === revision + 1
        ? await readNodeEditRevision(signal, newRevision, isCurrent, reveal, selection, resourcesChanged)
        : await readPages(signal, pagesOffset, null, isCurrent, reveal, selection)) === true;
      if (current() && !synced) message();
    }, { quiet: true });
    return synced;
  }
});
const canvasNodes = createCanvasNodeEditor({
  element, getContext: () => ({ documentRole, revision, selection: layers.selection }),
  getModel: () => visualScreens.designModel, getScale: () => canvasViewport.scale,
  selectLayer: layers.selectFromCanvas, editGeometry: visualNodeEditor.editGeometry,
  isEditPending: () => visualNodeEditor.editPending
});
function renderCanvas(nodeEdit = false) {
  canvasViewport.render();
  const empty = element('canvas-empty');
  empty.hidden = Boolean(selectedScreen);
  if (!selectedScreen) {
    const allowed = documentRole === 'Owner' || documentRole === 'Editor';
    const action = empty.querySelector('button');
    action.hidden = !allowed;
    action.textContent = selectedPage ? 'Создать экран' : 'Создать страницу';
    empty.querySelector('p').textContent = selectedPage
      ? 'Выберите экран слева или создайте новый, чтобы начать работу.'
      : 'Создайте первую страницу, затем добавьте экран.';
  }
  visualScreens.refresh(nodeEdit);
  visualNodeEditor.refresh();
}
const fitScreen = canvasViewport.fit;

function selectionAfterCommand(change) {
  return change && layers.selection?.id === change.previousId ? { id: change.nodeId } : layers.selection;
}

function renderRevision() {
  element('revision').textContent = `Общий черновик · ревизия ${revision}`;
  documentExport.render();
}

async function readNodeEditRevision(signal, newRevision, isCurrent, reveal, selectionChange, resourcesChanged = false) {
  const doc = documentId, screen = selectedScreen, current = generation, previousRevision = revision;
  const valid = () => !signal.aborted && current === generation && previousRevision === revision &&
    doc === documentId && screen === selectedScreen && isCurrent();
  const base = `/api/v1/documents/${encodeURIComponent(doc)}`;
  // One confirmed node command cannot change the document header, page and screen lists, or token definitions.
  const [layerSnapshot, usages] = await Promise.all([
    layers.readSnapshot({ base, screen, revision: newRevision, signal, isCurrent: valid, reveal,
      shouldReportFailure: () => signal === pending?.signal }),
    tokens.readSelectedUsages(base, newRevision, signal, valid)
  ]);
  if (!valid()) return;
  if (!layers.isExpansionCurrent(layerSnapshot)) return readNodeEditRevision(signal, newRevision, isCurrent, reveal, selectionChange, resourcesChanged);
  const selection = selectionAfterCommand(selectionChange);
  revision = newRevision;
  tokens.applySelectedUsages(usages);
  layers.applySnapshot(layerSnapshot, selection);
  renderCanvas(!resourcesChanged);
  scenarios.retainAfterNodeEdit(screen, previousRevision);
  diagnostics.refresh();
  renderRevision();
  return true;
}

// The structure API is intentionally capped at 100 items per request; the editor tree
// collects every page and every screen instead of exposing technical pagination.
async function readAllStructure(url, fields, signal, valid, pinnedRevision = null) {
  const items = [];
  let expectedRevision = pinnedRevision, total = 0;
  do {
    const query = new URLSearchParams({ offset: String(items.length), limit: '100', fields });
    if (expectedRevision !== null) query.set('revision', String(expectedRevision));
    const result = await request(`${url}?${query}`, {}, signal, valid);
    if (!valid()) return null;
    if (expectedRevision !== null && result.revision !== expectedRevision)
      throw new Error('Ревизия документа изменилась во время загрузки дерева.');
    expectedRevision = result.revision;
    total = result.total;
    if (!result.items.length && items.length < total) throw new Error('Не удалось загрузить полный список.');
    items.push(...result.items);
  } while (items.length < total);
  return { items, total, revision: expectedRevision };
}

async function readPages(signal, _offset = 0, targetRevision = null, isCurrent = () => true, reveal = [], selectionChange) {
  const id = documentId, current = generation;
  const valid = () => !signal.aborted && id === documentId && current === generation && isCurrent();
  const base = `/api/v1/documents/${encodeURIComponent(id)}`;
  const result = await readAllStructure(`${base}/pages`, 'name,childCount', signal, valid, targetRevision);
  if (!valid() || !result) return;
  const nextRevision = result.revision;
  const page = result.items.some(item => item.id === selectedPage) ? selectedPage : result.items[0]?.id ?? null;
  if (page !== selectedPage) pageExpanded = true;
  let screen = page === selectedPage ? selectedScreen : null;
  let screens = { items: [], total: 0 };
  if (page) {
    screens = await readAllStructure(`${base}/pages/${encodeURIComponent(page)}/screens`,
      'dimensions,name', signal, valid, nextRevision);
    if (!valid() || !screens) return;
  }
  if (!screens.items.some(item => item.id === screen)) screen = null;
  const layerSnapshot = await layers.readSnapshot({
    base, screen, revision: nextRevision, signal, isCurrent: valid, reveal,
    shouldReportFailure: () => signal === pending?.signal
  });
  const tokenSnapshot = await tokens.read(base, nextRevision, signal, valid);
  const header = await request(`${base}?fields=name&revision=${nextRevision}`, {}, signal, valid);
  if (!valid()) return;
  if (!layers.isExpansionCurrent(layerSnapshot))
    return readPages(signal, 0, nextRevision, isCurrent, reveal, selectionChange);
  const selection = selectionAfterCommand(selectionChange);
  const pagesChanged = page !== selectedPage ||
    JSON.stringify(result.items) !== JSON.stringify(pagesItems);
  const screensChanged = screen !== selectedScreen ||
    JSON.stringify(screens.items) !== JSON.stringify(screensItems);
  if (page !== selectedPage || screen !== selectedScreen) layers.reset();
  pagesOffset = 0; pagesItems = result.items; pagesTotal = result.total; selectedPage = page;
  screensOffset = 0; screensItems = screens.items; screensTotal = screens.total; selectedScreen = screen;
  revision = catalogRevision = nextRevision;
  tokens.apply(tokenSnapshot);
  if (pagesChanged) renderPages();
  if (screensChanged || pagesChanged) renderScreens();
  else renderCanvas();
  layers.applySnapshot(layerSnapshot, selection);
  const name = header.items[0].name;
  element('document-title').textContent = name; document.title = `${name} — FigVam`;
  element('token-create').inert = element('token-edit').inert = false;
  components.load(); datasets.load(); screenVariants.load();
  diagnostics.refresh();
  scenarios.refresh(screen);
  renderRevision();
  return true;
}


function resetDocumentRename() {
  const form = element('document-rename');
  form.hidden = true; form.reset(); form.querySelector('button').disabled = false;
  element('document-rename-status').textContent = '';
  element('document-rename-error').textContent = '';
}

async function openDocument(id) {
  leaveDeletion();
  if (deletion?.id === id) {
    history.replaceState(null, '', '/');
    return loadList();
  }
  presence.stop(); advanceNavigation(); diagnostics.reset(); scenarios.reset(); members.reset(); documentExport.reset();
  stopLive();
  resetDocumentRename();
  element('documents-view').hidden = true;
  element('editor-view').hidden = true;
  document.title = 'FigVam — открытие документа';
  documentHistory.reset(); tokens.reset(); components.reset(); datasets.reset(); screenVariants.reset(); screenResize.resetDraft(); documentId = id; documentRole = null; selectedPage = null; selectedScreen = null; screensItems = []; pagesOffset = 0; pageExpanded = true; layers.reset(); renderCanvas();
  await run(() => openDocument(id), async (signal, current) => {
    const result = await request(`/api/v1/documents/${encodeURIComponent(id)}?fields=name`, {}, signal);
    const role = await findRole(id, signal);
    if (!current()) return;
    documentRole = role;
    const name = result.items[0].name;
    element('document-title').textContent = name;
    element('rename-document-name').value = name;
    element('document-rename').hidden = !['Owner', 'Editor'].includes(role);
    element('delete-document').hidden = role !== 'Owner';
    members.prepare(role);
    document.title = `${name} — FigVam`;
    element('page-access').textContent = role === 'Viewer' ? 'Только просмотр страниц.' : role ? '' : 'Права на редактирование не определены. Обновите страницу.';
    element('page-edit').hidden = !['Owner', 'Editor'].includes(role);
    element('screen-create').hidden = !['Owner', 'Editor'].includes(role);
    element('token-create').hidden = !['Owner', 'Editor'].includes(role);
    element('dataset-edit').hidden = !['Owner', 'Editor'].includes(role);
    documentHistory.prepare();
    await readPages(signal, 0);
    if (!current()) return;
    element('editor-view').hidden = false;
    presence.start();
    documentHistory.load();
    if (selectedScreen) requestAnimationFrame(fitScreen);
    message();
  });
}

element('delete-document').addEventListener('click', () => {
  if (deletion || documentRole !== 'Owner' || !Number.isSafeInteger(revision) || element('editor-view').hidden) return;
  if (!confirm(`Удалить документ «${element('document-title').textContent}»? Это действие нельзя отменить.`)) return;
  deletion = { id: documentId, name: element('document-title').textContent, body: JSON.stringify({ commandId: crypto.randomUUID(), expectedRevision: revision }), state: 'ready' };
  submitDeletion(deletion);
});
element('delete-retry').addEventListener('click', () => { if (deletion?.state === 'uncertain') submitDeletion(deletion); });
async function submitDeletion(operation) {
  if (deletion !== operation || operation.state === 'pending') return;
  operation.state = 'pending';
  const epoch = navigationEpoch, id = operation.id, requestToken = token;
  stopLive(); const signal = replacePendingRequest();
  const active = () => !signal.aborted && deletion === operation && epoch === navigationEpoch && token === requestToken;
  element('delete-document').disabled = true;
  element('delete-result').hidden = false;
  element('delete-retry').hidden = true;
  element('delete-message').textContent = 'Удаление документа…';
  try {
    const result = await request(`/api/v1/documents/${encodeURIComponent(id)}/commands/delete-document`, { method: 'POST', body: operation.body }, signal);
    if (!active()) return;
    const body = JSON.parse(operation.body);
    if (!Number.isSafeInteger(result.revision) || result.commandId?.toLowerCase() !== body.commandId.toLowerCase() || result.documentId?.toLowerCase() !== id.toLowerCase()) throw new TypeError('Некорректное подтверждение');
    resetDeletion();
    history.pushState(null, '', '/');
    const loading = loadList(), listEpoch = navigationEpoch;
    await loading;
    if (token && listEpoch === navigationEpoch) message('Документ удалён.');
  } catch (error) {
    if (!active() || error.name === 'AbortError') return;
    if (error instanceof TypeError || error.status >= 500 || error.status === undefined) {
      operation.state = 'uncertain';
      if (documentId === id) element('editor-view').hidden = true;
      element('delete-message').textContent = 'Результат удаления неизвестен. Повторите запрос, чтобы получить подтверждение; документ мог быть удалён.';
      element('delete-retry').hidden = false;
      return;
    }
    if (error.status === 403 || error.status === 404) {
      const explanation = error.status === 403 ? 'Нет прав на удаление документа или доступ к нему потерян.' : 'Документ уже удалён или больше недоступен.';
      resetDeletion();
      history.pushState(null, '', '/');
      const loading = loadList(), listEpoch = navigationEpoch;
      await loading;
      if (token && listEpoch === navigationEpoch) message('', explanation);
      return;
    }
    resetDeletion();
    if (error.status === 409) {
      const reopening = openDocument(id), refreshEpoch = navigationEpoch;
      await reopening;
      if (refreshEpoch === navigationEpoch && documentId === id && !element('editor-view').hidden) message('', 'Документ изменился. Проверьте обновлённую ревизию и повторите удаление.');
    } else { message('', error.message); startLive(); }
  }
}

element('document-rename').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector('button');
  if (button.disabled || !['Owner', 'Editor'].includes(documentRole)) return;
  const name = element('rename-document-name').value;
  stopLive(); const { signal, current } = startRequest(), id = documentId;
  button.disabled = true;
  signal.addEventListener('abort', () => {
    if (current === generation && id === documentId) {
      button.disabled = false;
      element('document-rename-status').textContent = '';
    }
  }, { once: true });
  element('document-rename-status').textContent = 'Сохранение имени…';
  element('document-rename-error').textContent = '';
  try {
    await request(`/api/v1/documents/${encodeURIComponent(id)}/commands/rename-document`, {
      method: 'POST', body: JSON.stringify({ commandId: crypto.randomUUID(), name })
    }, signal);
    if (signal.aborted || current !== generation || id !== documentId) return;
    await readPages(signal);
    if (signal.aborted || current !== generation || id !== documentId) return;
    element('rename-document-name').value = element('document-title').textContent;
    element('document-rename-status').textContent = 'Имя документа изменено.';
  } catch (error) {
    if (error.name === 'AbortError' || current !== generation || id !== documentId) return;
    element('document-rename-status').textContent = '';
    element('document-rename-error').textContent = error instanceof TypeError || error.status >= 500
      ? 'Не удалось подтвердить результат. Обновите документ перед повторной попыткой: команда могла выполниться.' : error.message;
  } finally {
    if (current === generation && id === documentId) { button.disabled = false; startLive(); }
  }
});

async function refreshPages(offset = pagesOffset) {
  await run(() => refreshPages(offset), async (signal, current) => {
    await readPages(signal, offset);
    if (current()) message('Страницы обновлены.');
  });
}

async function pageCommand(command, data, selection, screenSelection) {
  stopLive();
  if (!['Owner', 'Editor'].includes(documentRole)) return;
  const { signal, current } = startRequest();
  retry = null; message('Отправка изменений в общий черновик…');
  element('page-edit').inert = true;
  element('screen-create').inert = true;
  try {
    await request(`/api/v1/documents/${encodeURIComponent(documentId)}/commands/${command}`, {
      method: 'POST', body: JSON.stringify({ commandId: crypto.randomUUID(), ...data })
    }, signal);
    if (signal.aborted || current !== generation) return;
    if (selection !== undefined) selectedPage = selection;
    if (screenSelection) selectedScreen = screenSelection;
    await readPages(signal);
    if (current === generation) {
      if (command === 'rename-page') element('page-edit').querySelector('.page-options').open = false;
      message('Изменения подтверждены в общем черновике.');
    }
  } catch (error) {
    if (error.name === 'AbortError' || current !== generation) return;
    const uncertain = error instanceof TypeError || error.status >= 500;
    message('', uncertain ? 'Не удалось подтвердить результат команды. Обновите страницы перед повторным действием: команда могла выполниться.' : error.message);
  } finally {
    if (current === generation) { element('page-edit').inert = false; element('screen-create').inert = false; startLive(); }
  }
}

function route() {
  if (!token) return;
  const match = location.pathname.match(/^\/documents\/([0-9a-f-]+)\/?$/i);
  return match ? openDocument(match[1]) : loadList();
}

function navigate(path) {
  history.pushState(null, '', path);
  route();
  element('content').focus();
}

element('authentication-form').addEventListener('submit', event => {
  event.preventDefault();
  const supplied = element('token').value.trim();
  if (!supplied || /\s/.test(supplied)) {
    message('', 'Введите токен без пробелов и префикса Bearer.');
    return;
  }
  setToken(supplied);
  element('token').value = '';
  element('authentication').hidden = true;
  element('disconnect').hidden = false;
  element('content').hidden = false;
  route();
  element('content').focus();
});
element('disconnect').addEventListener('click', async () => {
  if (isGoogleMode()) {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store',
        credentials: 'same-origin', redirect: 'error', headers: authHeaders('', 'POST') });
      if (!response.ok) throw new Error('Не удалось завершить серверную сессию.');
    } catch (error) { message('', error.message); return; }
  }
  clearSession();
  if (!isGoogleMode()) element('token').focus();
});
element('create-form').addEventListener('submit', async event => {
  event.preventDefault();
  const name = element('document-name').value.trim();
  if (!name || /[\u0000-\u001f\u007f-\u009f]/.test(name)) {
    message('', 'Укажите непустое имя без управляющих символов.');
    return;
  }
  const documentId = crypto.randomUUID();
  await run(null, async (signal, current) => {
    await request('/api/v1/documents', { method: 'POST', body: JSON.stringify({ documentId, name }) }, signal);
    if (!current()) return;
    element('document-name').value = '';
    navigate(`/documents/${documentId}`);
  }, { create: true });
});
element('import-file').addEventListener('change', () => {
  element('import-file-name').textContent = element('import-file').files[0]?.name || 'Файл не выбран';
});
element('import-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (importOperation || !token) return;
  const file = element('import-file').files[0];
  if (!file) return;
  const name = file.name.toLowerCase();
  const format = name.endsWith('.figvam') ? 'container.figvam' : name.endsWith('.json') ? 'document.json' : null;
  const errorView = element('import-error'), statusView = element('import-status');
  errorView.textContent = statusView.textContent = '';
  element('import-diagnostics').replaceChildren();
  if (!format) { errorView.textContent = 'Выберите файл document.json или .figvam.'; return; }
  const operation = { token, epoch: navigationEpoch };
  importOperation = operation;
  const active = () => importOperation === operation && token === operation.token && navigationEpoch === operation.epoch;
  element('import-form').querySelector('button').disabled = true;
  statusView.textContent = 'Импорт документа…';
  try {
    const response = await fetch(`/api/v1/documents/import/${format}`, {
      method: 'POST', body: file, cache: 'no-store', credentials: credentialsMode(), redirect: 'error',
      headers: { ...authHeaders(operation.token, 'POST'), 'Content-Type': format === 'document.json' ? 'application/json' : 'application/zip' }
    });
    if (!active()) return;
    if (response.status === 401) { clearSession(); message('', 'Сессия завершена. Войдите повторно.'); return; }
    const body = await response.json().catch(() => ({}));
    if (!active()) return;
    if (!response.ok) {
      if (response.status >= 500) throw new Error('uncertain');
      const explanations = { 400: 'Файл не прошёл проверку.', 403: 'Нет прав на импорт документа.', 409: 'Документ с таким идентификатором уже существует. Проверьте список.', 413: 'Файл превышает допустимый размер.', 415: 'Формат файла не поддерживается.', 429: 'Слишком много запросов. Повторите позже.' };
      errorView.textContent = (explanations[response.status] ?? 'Сервер отклонил импорт.') + (body.code ? ` Код: ${body.code}.` : '');
      for (const diagnostic of Array.isArray(body.diagnostics) ? body.diagnostics : []) {
        const item = document.createElement('li');
        item.textContent = [diagnostic.code, diagnostic.path, diagnostic.message].filter(Boolean).join(' — ');
        element('import-diagnostics').append(item);
      }
      statusView.textContent = '';
      return;
    }
    if (body.code !== 'ACCEPTED' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.documentId ?? '')) throw new Error('uncertain');
    element('import-form').reset();
    element('import-file-name').textContent = 'Файл не выбран';
    await loadList();
    if (importOperation === operation && token === operation.token && navigationEpoch === operation.epoch + 1) navigate(`/documents/${body.documentId}`);
  } catch {
    if (active()) { statusView.textContent = ''; errorView.textContent = 'Результат импорта неизвестен: документ мог быть создан. Проверьте список перед повторной попыткой.'; }
  } finally {
    if (importOperation === operation) {
      importOperation = null;
      element('import-form').querySelector('button').disabled = false;
      if (!active() && navigationEpoch !== operation.epoch) statusView.textContent = '';
    }
  }
});
element('screen-create').addEventListener('submit', event => {
  event.preventDefault();
  const width = element('screen-width').valueAsNumber, height = element('screen-height').valueAsNumber;
  if (!Number.isFinite(width) || width < 0 || !Number.isFinite(height) || height < 0) { message('', 'Укажите конечные неотрицательные ширину и высоту.'); return; }
  if (!selectedPage) return;
  const screenId = crypto.randomUUID();
  pageCommand('add-screen', { pageId: selectedPage, screenId, dimensions: { width, height } }, undefined, screenId);
});
element('page-refresh').addEventListener('click', () => refreshPages());
element('page-create').addEventListener('click', () => {
  const pageId = crypto.randomUUID();
  pageCommand('add-page', { pageId }, pageId);
});
element('page-rename').addEventListener('submit', event => {
  event.preventDefault();
  const name = element('page-name').value.trim();
  if (!name || /[\u0000-\u001f\u007f-\u009f]/.test(name)) { message('', 'Укажите непустое имя без управляющих символов.'); return; }
  pageCommand('rename-page', { pageId: selectedPage, name });
});
element('page-delete').addEventListener('click', () => {
  const page = pagesItems.find(item => item.id === selectedPage);
  if (page && confirm(`Удалить страницу «${page.name}»? Её экраны и их содержимое будут удалены.`))
    pageCommand('delete-page', { pageId: page.id, expectedRevision: revision }, null);
});
element('home-documents').addEventListener('click', () => selectHomeView('documents'));
element('home-users').addEventListener('click', () => selectHomeView('users'));
element('refresh').addEventListener('click', () => loadList());
element('previous').addEventListener('click', () => loadList(pageIndex - 1, cursors[pageIndex - 1]));
element('next').addEventListener('click', () => loadList(pageIndex + 1, nextCursor));
element('retry').addEventListener('click', () => retry?.());
document.addEventListener('click', event => {
  const link = event.target.closest('a[data-navigation]');
  if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(link.getAttribute('href'));
});
window.addEventListener('popstate', route);
window.addEventListener('pagehide', clearSession);
async function initializeAuthentication() {
  try {
    const config = await fetch('/api/auth/config', { credentials: 'same-origin', cache: 'no-store' });
    if (!config.ok) throw new Error('Режим аутентификации недоступен.');
    const info = await config.json();
    configureAuth(info.mode);
    if (!isGoogleMode()) {
      element('authentication-help').textContent = 'Для API-режима введите выданный Bearer-токен. Вход через Google настроен отдельно.';
      element('disconnect').textContent = 'Забыть токен';
      element('editor-signout').textContent = 'Забыть токен';
      element('editor-signout-menu').textContent = 'Забыть токен';
      element('authentication-form').hidden = false;
      return;
    }
    element('authentication-form').hidden = true;
    element('google-login').hidden = false;
    const authError = new URLSearchParams(location.search).get('auth_error');
    if (authError) element('authentication-error').textContent = 'Google-аккаунт не подтверждён или доступ к FigVam не разрешён.';
    const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось восстановить сессию.');
    const session = await response.json();
    if (!session.authenticated) return;
    setCsrf(session.csrfToken);
    setToken('__figvam_browser_session__');
    element('authentication').hidden = true;
    element('disconnect').hidden = false;
    element('content').hidden = false;
    route();
    element('home-users').hidden = !session.admin;
    await userAdmin.show(session.admin);
  } catch (error) {
    element('authentication-error').textContent = error.message;
  }
}
initializeAuthentication();
clearSession();
