import { authHeaders, credentialsMode, isGoogleMode, setCsrf } from '../api/auth-client';
import { createScreenCapture } from '../canvas/screen-capture';
import { ApiError, createApiClient, type ApiClient } from '../api/api-client';
import { createDocumentQueries } from '../api/document-queries';
import { createAuthenticationView, createDocumentListView, createHomeNavigation, createUserAdmin, createMcpAccess, createScreenDiagnostics, createComponents, createPresence, createMembers, createScreenVariants, createDatasets, createDocumentHistory, createEditorShell } from '../features/home/index';
import { createDocumentCollaboration } from '../features/collaboration/document-collaboration';
import { createCanvasViewport } from '../canvas/canvas-viewport';
import { createVisualScreens } from '../canvas/visual-screen';
import { createCanvasNodeEditor } from '../canvas/canvas-node-editor';
import { createVisualNodeEditor } from '../features/editor/visual-node-editor';
import { createLayers } from '../features/editor/layers';
import { createDocumentExport } from '../features/documents/document-export';
import { createScenarios } from '../features/interactions/scenarios';
import { createScreenResize } from '../features/editor/screen-resize';
import { createTokens } from '../features/tokens/tokens';
import { createStyles } from '../features/styles/styles';
import { token, generation, pending, navigationEpoch, setToken, advanceNavigation, cancelRequest, startRequest, replacePendingRequest } from '../core/session';

import { element, required } from './dom';
import { createElement } from 'react';
import { disposeApplicationRoot, mountApplicationRoot } from './application-root';
import { ApplicationShell } from './application-shell';
import { createDocumentShellModel, createDeletionViewModel, canEditDocument } from './document-shell-state';
import { createApplicationShellState } from './application-shell-state';
import { createApplicationViews } from './application-views';
import { aborted, errorMessage, record, requiredRecord, text } from '../api/decode';
import type { DocumentListItem } from '../api/document-list';
import type { DeleteCatalogCommand } from '../features/home/document-list';
import type { components } from '../api/schema.generated';
import { postPageCommand, type PageCommandData } from './page-commands';

import { createRequestRunner } from './request-runner';
import { createDocumentCatalog } from './document-catalog';
import { createNavigation } from './navigation';
import { createDocumentRevisionState } from './document-workspace';
import { createWorkspaceSelection } from './workspace-selection';
import { createDocumentSync, type SelectionChange } from './document-sync';
import { isValidBearerToken, logoutGoogleSession, readAuthenticationMode, restoreGoogleSession } from '../features/home/session-authentication';
import { createDocumentNavigator, type NavigatorKind, type RenameDraft } from '../features/editor/document-navigator';
type ImportOperation = { token: string; epoch: number };
type Deletion = { id: string; name: string; body: string; commandId: string; state: 'ready' | 'pending' | 'uncertain' };
const statusOf = (error: unknown) => error instanceof ApiError ? error.status : undefined;
const uncertain = (error: unknown) => !(error instanceof ApiError) || error.status >= 500;
const catalog = createDocumentCatalog();
const shellState = createApplicationShellState();
const documentShell = createDocumentShellModel();
const deletionView = createDeletionViewModel();
const getDocumentRole = () => documentShell.getSnapshot().role;
const isEditorVisible = () => shellState.getSnapshot().view === 'editor';
const requestRunner = createRequestRunner({
  stopLive: () => stopLive(), startLive: () => startLive(), message,
  setBusy: busy => shellState.patch({ busy }),
  setControlsDisabled: controlsDisabled => shellState.patch({ controlsDisabled }),
});
function run(...args: Parameters<typeof requestRunner.run>) { return requestRunner.run(...args); }

const editorShell = createEditorShell({ beforePrototypeLeave: next => scenarios.requestLeave(next), addTool: kind => visualNodeEditor.addFromToolbar(kind), signOut: () => { void signOut(); }, createPage, document: documentShell, deletion: deletionView, renameDocument, deleteDocument, retryDeletion, createScreen, refreshPages: () => { void refreshPages(); } });
const views = createApplicationViews();
mountApplicationRoot(createElement(ApplicationShell, { shell: editorShell, views, model: shellState, actions: {
  createDocument, changeDocumentName: documentName => shellState.patch({ documentName }),
  chooseImportFile: importFile => shellState.patch({ importFile }), importDocument,
  refresh: () => { void loadList(); },
  previous: () => { const page = catalog.previous(); if (page) void loadList(page.index, page.cursor); },
  next: () => { const page = catalog.next(); if (page) void loadList(page.index, page.cursor); },
  retry: () => { void requestRunner.retry(); },
} }));
const authenticationView = createAuthenticationView(views.authentication, submitBearerToken);
const documentListView = createDocumentListView(views.documentList, deleteCatalogDocument);
const homeNavigation = createHomeNavigation(views.homeNavigation, selectHomeView);
const userAdmin = createUserAdmin(views.userAdmin);
function selectHomeView(view: 'users' | 'documents') {
  const users = view === 'users' && homeNavigation.isAdmin();
  shellState.patch({ homeView: users ? 'users' : 'documents' });
  homeNavigation.select(users ? 'users' : 'documents');
}
const pageSize = 20;
let documentId: string | null = null;
const selectionState = createWorkspaceSelection();
const revisions = createDocumentRevisionState();
let importOperation: ImportOperation | null = null;
let deletion: Deletion | null = null;
function resetDeletion() {
  deletion = null;
  deletionView.publish({ status: 'idle', message: '' });
}
function leaveDeletion() {
  if (!deletion) return;
  deletion.state = 'uncertain';
  deletionView.publish({ status: 'uncertain', message: `Результат удаления документа «${deletion.name}» неизвестен. Повторите запрос, чтобы получить подтверждение; документ мог быть удалён.` });
}
let statusDismissTimer: ReturnType<typeof setTimeout> | undefined;
const request: ApiClient = createApiClient({
  getToken: () => token,
  onUnauthorized: () => {
    clearSession();
    message('', 'Сессия завершена. Войдите повторно.');
  }
});

const diagnostics: ReturnType<typeof createScreenDiagnostics> = createScreenDiagnostics({ model: views.diagnostics,
  element, request, pageSize,
  getContext: () => ({ documentId, screen: selectionState.selectedScreen, revision: revisions.revision, token, navigationEpoch })
});
const screenResize: ReturnType<typeof createScreenResize> = createScreenResize({ model: views.screenResize,
  element, request, refreshPages: () => refreshPages(),
  workspace: {
    isEditorVisible,
    get documentId() { return documentId; }, get documentRole() { return getDocumentRole(); },
    get selectedScreen() { return selectionState.selectedScreen; }, get screensItems() { return selectionState.screens; },
    get generation() { return generation; }, get token() { return token; }
  }
});

const documentQueries = createDocumentQueries(request);
const findRole = documentQueries.findRole;

const mcpContext = () => ({ documentId, token, navigationEpoch, role: getDocumentRole(), theme: visualScreens.currentTheme });
const mcpAccess: ReturnType<typeof createMcpAccess> = createMcpAccess({ model: views.mcp, request, getContext: mcpContext, capture: createScreenCapture({ request, getContext: mcpContext }) });

const { start: startLive, stop: stopLive } = createDocumentCollaboration({
  request,
  workspace: {
    get documentId() { return documentId; },
    get revision() { return revisions.revision; },
    get token() { return token; }
  },
  isEditorVisible,
  readRevision: (signal, targetRevision) => readPages(signal, 0, targetRevision),
  onConnectionStatus: connectionStatus => documentShell.patch({ connectionStatus }),
  onAccessLost: closeInaccessibleDocument,
  onCaptureEvent: mcpAccess.onCaptureEvent,
  onCaptureDisconnect: mcpAccess.onCaptureDisconnect,
  onUnauthorized: () => {
    clearSession();
    message('', 'Сессия завершена. Войдите повторно.');
  }
});

const documentExport: ReturnType<typeof createDocumentExport> = createDocumentExport({
  element, getContext: () => ({ token, documentId, documentRole: getDocumentRole(), revision: revisions.revision, navigationEpoch }),
  onUnauthorized: () => {
    clearSession();
    message('', 'Сессия завершена. Войдите повторно.');
  }
});

const tokens: ReturnType<typeof createTokens> = createTokens({
  models:views.tokens,showEditor:editorShell.showEditor,selectLayer:id=>layers.selectById(id),element, request,
  getContext: () => ({ documentId, documentRole: getDocumentRole(), revision: revisions.revision, generation, navigationEpoch }),
  startRequest, stopLive, startLive, readPages
});
const styles: ReturnType<typeof createStyles> = createStyles({
  models:views.styles,selectLayer:id=>layers.selectById(id),element, request, getTokens: () => tokens.items,
  getContext: () => ({ documentId, documentRole: getDocumentRole(), revision: revisions.revision, generation }),
  startRequest, stopLive, startLive, readPages
});
const components: ReturnType<typeof createComponents> = createComponents({
  model: views.components, request, pageSize,
  getContext: () => ({ documentId, revision: revisions.revision, catalogRevision: revisions.catalogRevision })
});
const screenVariants: ReturnType<typeof createScreenVariants> = createScreenVariants({ model: views.screenVariants,
  element, request, refreshPages: () => refreshPages(),
  onSelectionChanged: () => renderCanvas(), pageSize,
  workspace: {
    isEditorVisible,
    get documentId() { return documentId; }, get documentRole() { return getDocumentRole(); },
    get selectedScreen() { return selectionState.selectedScreen; }, get revision() { return revisions.revision; },
    get catalogRevision() { return revisions.catalogRevision; },
    get token() { return token; }, get navigationEpoch() { return navigationEpoch; }
  }
});
const datasets: ReturnType<typeof createDatasets> = createDatasets({
  model: views.datasets, request, pageSize,
  getContext: () => ({ documentId, documentRole: getDocumentRole(), revision: revisions.revision, catalogRevision: revisions.catalogRevision, token, generation, navigationEpoch }),
  startRequest, stopLive, startLive, readPages, run
});
function closeInaccessibleDocument(status: number) {
  mcpAccess.reset();
  if (documentId) scenarios.clearDocumentCommands(documentId);
  cancelRequest(); advanceNavigation();
  diagnostics.reset(); scenarios.reset(); layers.reset(); documentHistory.reset();
  members.reset(); documentExport.reset(); documentShell.patch({ role: null }); revisions.reset(); selectionState.reset();
  documentShell.patch({ pageBusy: false, revisionLabel: '', title: '' });
  document.title = 'FigVam — доступ потерян';
  renderPages(); renderScreens(); shellState.patch({ view: 'none' });
  presence.stop(); stopLive(); message('', status === 404 ? 'Документ удалён или больше недоступен.' : 'Доступ к документу потерян. Запросите права у владельца и откройте документ снова.');
}

function message(status = '', error = '') {
  clearTimeout(statusDismissTimer);
  statusDismissTimer = undefined;
  shellState.patch({ status, error, canRetry: requestRunner.canRetry });
  // Progress and errors are persistent; successful editor notifications expire.
  if (status && !error && !status.endsWith('…') && shellState.getSnapshot().view === 'editor') {
    statusDismissTimer = setTimeout(() => {
      if (shellState.getSnapshot().status === status) shellState.patch({ status: '' });
      statusDismissTimer = undefined;
    }, 4000);
  }
}

function clearSession() {
  mcpAccess.reset();
  importOperation = null;
  shellState.resetImport();
  resetDeletion();
  presence.stop(); advanceNavigation(); diagnostics.reset(); scenarios.reset(); members.reset(); documentExport.reset(); scenarios.clearCommands(); layers.clearCommands();
  stopLive();
  setToken('');
  setCsrf('');
  userAdmin.hide();
  homeNavigation.setAdmin(false);
  selectHomeView('documents');
  documentHistory.clearCommands(); screenResize.clear(); documentHistory.reset();
  visualNodeEditor.clear(); visualScreens.clearPropertyPreviews();
  cancelRequest();
  authenticationView.clearToken();
  shellState.patch({ documentName: '' });
  documentListView.clear();
  documentId = null; documentShell.patch({ role: null }); revisions.reset(); selectionState.reset();
  renderPages();
  layers.reset();
  tokens.reset(); styles.reset(); components.reset(); datasets.reset(); screenVariants.reset();
  renderCanvas();
  documentShell.patch({ screenWidth: '1440', screenHeight: '900', pageBusy: false, title: '', revisionLabel: '' });
  resetDocumentRename();
  document.title = 'FigVam — документы';
  shellState.patch({ authenticated: false, view: 'none', busy: false, controlsDisabled: false, catalog: null });
  authenticationView.setVisible(true);
  catalog.reset();
  requestRunner.clearRetry();
  message();
}

const members: ReturnType<typeof createMembers> = createMembers({ model: views.members,
  element, request, findRole, openDocument, loadList, message, stopLive, startLive,
  workspace: {
    get documentId() { return documentId; },
    get documentRole() { return getDocumentRole(); },
    get navigationEpoch() { return navigationEpoch; },
    get token() { return token; }
  }
});

const documentHistory: ReturnType<typeof createDocumentHistory> = createDocumentHistory({ models: views.history,
  element, request, pageSize, refreshPages,
  workspace: {
    isEditorVisible,
    get documentId() { return documentId; },
    get documentRole() { return getDocumentRole(); },
    get navigationEpoch() { return navigationEpoch; },
    get token() { return token; }
  }
});

const layers: ReturnType<typeof createLayers> = createLayers({
  model: views.layers, element, request, refreshPages, closeInaccessibleDocument, message,
  workspace: {
    isEditorVisible,
    get documentId() { return documentId; },
    get documentRole() { return getDocumentRole(); },
    get selectedScreen() { return selectionState.selectedScreen; },
    get revision() { return revisions.revision; },
    get navigationEpoch() { return navigationEpoch; },
    get token() { return token; }
  },
  runPageRefresh: work => run(() => refreshPages(), work),
  readCurrentPages: (signal, isCurrent, reveal) => readPages(signal, 0, null, isCurrent, reveal),
  beforeSelectionChange: next => scenarios.requestLeave(next),
  onSelectionCleared: () => { scenarios.clearLayerSelection(); visualScreens.syncSelection(); visualNodeEditor.refresh(); },
  onLayerSelected: () => { scenarios.onLayerSelected(); visualScreens.syncSelection(); visualNodeEditor.refresh(); }
});

const scenarios: ReturnType<typeof createScenarios> = createScenarios({
  models:views.scenarios,element, request, pageSize,
  workspace: {
    isEditorVisible,
    get documentId() { return documentId; },
    get documentRole() { return getDocumentRole(); },
    get revision() { return revisions.revision; },
    get selectedScreen() { return selectionState.selectedScreen; },
    get layerSelection() { return layers.selection; }
  },
  findLayer: layers.findLayer,
  setInteractiveNodes: layers.setInteractiveNodes,
  selectSource: layers.selectFromCanvas,
  reloadPages: (targetRevision, isCurrent) =>
    run(() => refreshPages(), signal => readPages(signal, 0, targetRevision, isCurrent)),
  findRole,
  setDocumentRole: role => { documentShell.patch({ role }); datasets.refreshAccess(); tokens.refreshAccess(); layers.refreshMoveAvailability(); visualNodeEditor.refresh(); },
  closeInaccessibleDocument
});

async function loadList(index = 0, cursor: string | null | undefined = null): Promise<void> {
  mcpAccess.reset();
  leaveDeletion();
  if (!token) return;
  presence.stop(); advanceNavigation(); diagnostics.reset(); scenarios.reset(); members.reset(); documentExport.reset();
  stopLive();
  layers.reset();
  documentHistory.reset(); documentId = null; documentShell.patch({ role: null }); revisions.reset();
  selectionState.reset(); renderCanvas();
  shellState.patch({ view: 'documents' });
  selectHomeView('documents');
  documentListView.clear();
  shellState.patch({ catalog: null });
  document.title = 'FigVam — документы';
  catalog.beginLoad();
  await run(() => loadList(index, cursor), async (signal, current) => {
    const result = await catalog.read(request, index, cursor, pageSize, signal, current);
    if (!result) return;
    documentListView.render(result.items);
    shellState.patch({ catalog: { count: result.items.length, index, canGoBack: catalog.canGoBack, canGoForward: catalog.canGoForward } });
    message(result.items.length ? `Документов на странице: ${result.items.length}` : 'Доступных документов нет. Создайте документ или запросите права у владельца.');
  });
}

async function deleteCatalogDocument(item: DocumentListItem, command: DeleteCatalogCommand): Promise<void> {
  const body = JSON.stringify(command);
  const epoch = navigationEpoch;
  try {
    const result = requiredRecord(await request(`/api/v1/documents/${encodeURIComponent(item.documentId)}/commands/delete-document`, { method: 'POST', body }));
    if (epoch !== navigationEpoch) return;
    if (result.code !== 'ACCEPTED' || (typeof result.commandId === 'string' ? result.commandId.toLowerCase() : undefined) !== command.commandId.toLowerCase() ||
        (typeof result.documentId === 'string' ? result.documentId.toLowerCase() : undefined) !== item.documentId.toLowerCase() || result.revision !== command.expectedRevision + 1)
      throw new TypeError('Некорректное подтверждение');
    const loading = loadList(), listEpoch = navigationEpoch;
    await loading;
    if (token && listEpoch === navigationEpoch) message('Документ удалён.');
  } catch (error) {
    if (epoch !== navigationEpoch || !token) return;
    if ([400, 403, 404, 409].includes(statusOf(error) ?? 0)) {
      const loading = loadList(), listEpoch = navigationEpoch;
      await loading;
      if (token && listEpoch === navigationEpoch) message('', errorMessage(error));
    } else {
      message('', 'Результат удаления неизвестен. Повторите запрос: документ мог быть удалён.');
    }
  }
}

function navigatorCanEdit() {
  return canEditDocument(getDocumentRole());
}
function navigatorEditState(kind: NavigatorKind) {
  return selectionState.renameDraft(kind);
}
function setNavigatorEditState(kind: NavigatorKind, value: RenameDraft | null) {
  selectionState.setRenameDraft(kind, value);
}
function renderNavigatorKind(kind: NavigatorKind) {
  if (kind === 'page') renderPages();
  else renderScreens();
}
function startNavigatorNameEdit(kind: NavigatorKind, id: string, name: string) {
  if (!navigatorCanEdit() || documentShell.getSnapshot().pageBusy) return;
  setNavigatorEditState(kind === 'page' ? 'screen' : 'page', null);
  setNavigatorEditState(kind, {id, value:name});
  renderNavigatorKind(kind);
}
function discardNavigatorRename(kind: NavigatorKind, id: string) {
  setNavigatorEditState(kind, null);
  renderNavigatorKind(kind);
  document.querySelector<HTMLElement>('[data-' + kind + '-rename-id="' + id + '"]')?.focus({ preventScroll: true });
}
function renderPages() {
  navigatorView.render(selectionState.navigatorState(navigatorCanEdit()));
}
function selectPage(id: string) {
  if (selectionState.selectedPage !== id && !scenarios.requestLeave(() => selectPage(id))) return;
  if (selectionState.selectedPage === id) {
    selectionState.togglePage();
    renderPages();
    element('pages').querySelector<HTMLElement>('[data-page-id="' + id + '"]')?.focus();
    return;
  }
  layers.onScreenContextChanged();
  selectionState.selectPage(id);
  diagnostics.reset(); scenarios.reset(); screenVariants.reset(); layers.reset();
  renderPages(); renderScreens(); void refreshPages();
}
function selectScreen(id: string) {
  if ((selectionState.selectedScreen !== id || layers.selection) && !scenarios.requestLeave(() => selectScreen(id))) return;
  if (selectionState.selectedScreen !== id) {
    layers.onScreenContextChanged(); selectionState.selectScreen(id); diagnostics.reset(); scenarios.reset();
    screenVariants.reset(); screenResize.render(); void refreshPages();
  } else layers.clearSelection();
  renderPages(); renderCanvas();
}
function renderScreens() {
  renderPages();
  renderCanvas(); screenResize.render();
  const activeScreen = selectionState.activeScreen;
  documentShell.patch({ layersTitle: activeScreen
    ? `Слои · ${activeScreen.name ?? 'Экран ' + (selectionState.screens.indexOf(activeScreen) + 1)}`
    : 'Слои выбранного экрана' });
  const screenMenu = required(element('screen-preset').closest('details'));
  // Only suggest creation on the first empty page. Opening the popover on every
  // navigation obscures the page tree, and closing a user-opened menu mid-command
  // makes the form unusable while the page creation is still being committed.
  if (selectionState.selectedScreen || selectionState.screens.length > 0 || selectionState.pages.length > 1) screenMenu.open = false;
  else if (selectionState.selectedPage && selectionState.pages.length === 1 &&
      (getDocumentRole() === 'Owner' || getDocumentRole() === 'Editor') &&
      !document.querySelector('.navigator-context-menu[open]') && !selectionState.renameDraft('page')) screenMenu.open = true;
}




const presence: ReturnType<typeof createPresence> = createPresence({
  isEditorVisible,
  models: views.presence,
  element,
  getContext: () => ({ token, documentId, navigationEpoch, selectedScreen: selectionState.selectedScreen, selectedLayer: layers.selection }),
  toViewportPoint: point => canvasViewport.toViewportPoint(point)
});
const canvasViewport: ReturnType<typeof createCanvasViewport> = createCanvasViewport({
  element,
  getScreen: () => selectionState.activeScreen,
  getSelectedScreen: () => selectionState.selectedScreen,
  onViewportChange: presence.render,
  setPresenceCursor: presence.setCursor
});
const visualScreens: ReturnType<typeof createVisualScreens> = createVisualScreens({
  element, request, closeInaccessibleDocument, onDesignChange: () => canvasNodes.sync(),
  getContext: () => ({ documentId, revision: revisions.revision, screen: selectionState.activeScreen,
    selection: layers.selection, tokens: tokens.items, styles: styles.items, variantId: screenVariants.selectedVariantId })
});
const visualNodeEditor: ReturnType<typeof createVisualNodeEditor> = createVisualNodeEditor({
  models: views.propertyFields,
  element, request, readModel: visualScreens.readDesignModel, closeInaccessibleDocument, stopLive, startLive,
  previewProperties: visualScreens.setPropertyPreview,
  onDrawingToolsChanged: editorShell.setDrawingTools,
  getContext: () => ({ documentId, documentRole: getDocumentRole(), revision: revisions.revision, screen: selectionState.selectedScreen,
    variantId: screenVariants.selectedVariantId, selection: layers.selection, navigationEpoch, token }),
  refreshDocument: async (newRevision, isCurrent, reveal, selection, resourcesChanged = false) => {
    let synced = false;
    await run(() => refreshPages(), async (signal, current) => {
      synced = (revisions.revision !== null && newRevision === revisions.revision + 1
        ? await readNodeEditRevision(signal, newRevision, isCurrent, reveal, selection, resourcesChanged)
        : await readPages(signal, 0, null, isCurrent, reveal, selection)) === true;
      if (current() && !synced) message();
    }, { quiet: true });
    return synced;
  }
});
const canvasNodes: ReturnType<typeof createCanvasNodeEditor> = createCanvasNodeEditor({
  element, getContext: () => ({ documentRole: getDocumentRole(), revision: revisions.revision, selection: layers.selection }),
  getModel: () => visualScreens.designModel, getScale: () => canvasViewport.scale,
  selectLayer: layers.selectFromCanvas, editGeometry: visualNodeEditor.editGeometry,
  isEditPending: () => visualNodeEditor.editPending
});
function renderCanvas(nodeEdit = false) {
  canvasViewport.render();
  documentShell.patch({ hasPage: Boolean(selectionState.selectedPage), hasScreen: Boolean(selectionState.selectedScreen) });
  visualScreens.refresh(nodeEdit);
  visualNodeEditor.refresh();
}
const fitScreen = canvasViewport.fit;

function selectionAfterCommand(change?: SelectionChange) {
  return change && layers.selection?.id === change.previousId ? { id: change.nodeId } : layers.selection;
}

function renderRevision() {
  documentShell.patch({ revisionLabel: `Общий черновик · ревизия ${revisions.revision}` });
  documentExport.render();
}

const documentSync = createDocumentSync({
  context: () => ({ documentId, screen: selectionState.selectedScreen, page: selectionState.selectedPage, generation, revision: revisions.revision }),
  shouldReportFailure: signal => signal === pending?.signal,
  queries: documentQueries, layers, tokens, styles,
  applyNodeEdit(newRevision, screen, layerSnapshot, usages, selectionChange, resourcesChanged = false) {
    const selection = selectionAfterCommand(selectionChange);
    revisions.confirmNodeEdit(newRevision);
    tokens.applySelectedUsages(usages);
    layers.applySnapshot(layerSnapshot, selection);
    renderCanvas(!resourcesChanged);
    scenarios.retainAfterNodeEdit(screen);
    diagnostics.refresh();
    renderRevision();
  },
  applyStructure(structure, layerSnapshot, tokenSnapshot, styleSnapshot, name, selectionChange) {
    const { revision: nextRevision, selection: { screen } } = structure;
    const selection = selectionAfterCommand(selectionChange);
    const { pagesChanged, screensChanged } = selectionState.accept(structure, () => layers.reset());
    revisions.confirmStructure(nextRevision);
    tokens.apply(tokenSnapshot);
    styles.apply(styleSnapshot);
    if (pagesChanged) renderPages();
    if (screensChanged || pagesChanged) renderScreens();
    else renderCanvas();
    layers.applySnapshot(layerSnapshot, selection);
    documentShell.patch({ title: name }); document.title = `${name} — FigVam`;
    element('token-create').inert = element('token-edit').inert = element('token-import-form').inert = false;
    components.load(); datasets.load(); screenVariants.load();
    diagnostics.refresh();
    scenarios.refresh(screen);
    renderRevision();
  }
});
function readPages(...args: Parameters<typeof documentSync.readPages>) { return documentSync.readPages(...args); }
function readNodeEditRevision(...args: Parameters<typeof documentSync.readNodeEditRevision>) { return documentSync.readNodeEditRevision(...args); }

function resetDocumentRename() {
  documentShell.patch({ renameName: '', renameBusy: false, renameStatus: '', renameError: '' });
}

async function openDocument(id: string): Promise<void> {
  mcpAccess.reset();
  leaveDeletion();
  if (deletion?.id === id) {
    history.replaceState(null, '', '/');
    return loadList();
  }
  presence.stop(); advanceNavigation(); diagnostics.reset(); scenarios.reset(); members.reset(); documentExport.reset();
  stopLive();
  resetDocumentRename();
  shellState.patch({ view: 'none' });
  document.title = 'FigVam — открытие документа';
  documentHistory.reset(); tokens.reset(); components.reset(); datasets.reset(); screenVariants.reset(); screenResize.resetDraft(); documentId = id; documentShell.patch({ role: null }); revisions.reset(); selectionState.reset(); layers.reset(); renderCanvas();
  await run(() => openDocument(id), async (signal, current) => {
    const name = await documentQueries.readName(id, signal);
    const role = await findRole(id, signal);
    if (!current()) return;
    documentShell.patch({ role, title: name, renameName: name });
    members.prepare(role);
    document.title = `${name} — FigVam`;
    tokens.refreshAccess();
    datasets.refreshAccess();
    documentHistory.prepare();
    await readPages(signal, 0);
    if (!current()) return;
    shellState.patch({ view: 'editor' });
    presence.start();
    layers.refreshMoveAvailability();
    documentHistory.load();
    if (selectionState.selectedScreen) requestAnimationFrame(fitScreen);
    message();
  });
}

function deleteDocument() {
  if (deletion || !documentId || getDocumentRole() !== 'Owner' || revisions.revision === null || !Number.isSafeInteger(revisions.revision) || shellState.getSnapshot().view !== 'editor') return;
  if (!confirm(`Удалить документ «${documentShell.getSnapshot().title}»? Это действие нельзя отменить.`)) return;
  const commandId = crypto.randomUUID();
  const body: components['schemas']['DeleteDocumentRequest'] = { commandId, expectedRevision: revisions.revision };
  deletion = { id: documentId, name: documentShell.getSnapshot().title ?? '', body: JSON.stringify(body), commandId, state: 'ready' };
  void submitDeletion(deletion);
}
function retryDeletion() { if (deletion?.state === 'uncertain') void submitDeletion(deletion); }
async function submitDeletion(operation: Deletion): Promise<void> {
  if (deletion !== operation || operation.state === 'pending') return;
  operation.state = 'pending';
  const epoch = navigationEpoch, id = operation.id, requestToken = token;
  stopLive(); const signal = replacePendingRequest();
  const active = () => !signal.aborted && deletion === operation && epoch === navigationEpoch && token === requestToken;
  deletionView.publish({ status: 'pending', message: 'Удаление документа…' });
  try {
    const result = requiredRecord(await request(`/api/v1/documents/${encodeURIComponent(id)}/commands/delete-document`, { method: 'POST', body: operation.body }, signal));
    if (!active()) return;
    if (!Number.isSafeInteger(result.revision) || (typeof result.commandId === 'string' ? result.commandId.toLowerCase() : undefined) !== operation.commandId.toLowerCase() || (typeof result.documentId === 'string' ? result.documentId.toLowerCase() : undefined) !== id.toLowerCase()) throw new TypeError('Некорректное подтверждение');
    resetDeletion();
    history.pushState(null, '', '/');
    const loading = loadList(), listEpoch = navigationEpoch;
    await loading;
    if (token && listEpoch === navigationEpoch) message('Документ удалён.');
  } catch (error) {
    if (!active() || aborted(error)) return;
    if (uncertain(error)) {
      operation.state = 'uncertain';
      if (documentId === id) shellState.patch({ view: 'none' });
      deletionView.publish({ status: 'uncertain', message: 'Результат удаления неизвестен. Повторите запрос, чтобы получить подтверждение; документ мог быть удалён.' });
      return;
    }
    if (statusOf(error) === 403 || statusOf(error) === 404) {
      const explanation = statusOf(error) === 403 ? 'Нет прав на удаление документа или доступ к нему потерян.' : 'Документ уже удалён или больше недоступен.';
      resetDeletion();
      history.pushState(null, '', '/');
      const loading = loadList(), listEpoch = navigationEpoch;
      await loading;
      if (token && listEpoch === navigationEpoch) message('', explanation);
      return;
    }
    resetDeletion();
    if (statusOf(error) === 409) {
      const reopening = openDocument(id), refreshEpoch = navigationEpoch;
      await reopening;
      if (refreshEpoch === navigationEpoch && documentId === id && shellState.getSnapshot().view === 'editor') message('', 'Документ изменился. Проверьте обновлённую ревизию и повторите удаление.');
    } else { message('', errorMessage(error)); startLive(); }
  }
}

async function renameDocument() {
  if (documentShell.getSnapshot().renameBusy || !documentId || !canEditDocument(getDocumentRole())) return;
  const name = documentShell.getSnapshot().renameName;
  stopLive(); const { signal, current } = startRequest(), id = documentId;
  documentShell.patch({ renameBusy: true, renameStatus: 'Сохранение имени…', renameError: '' });
  signal.addEventListener('abort', () => {
    if (current === generation && id === documentId) documentShell.patch({ renameBusy: false, renameStatus: '' });
  }, { once: true });
  try {
    await request(`/api/v1/documents/${encodeURIComponent(id)}/commands/rename-document`, {
      method: 'POST', body: JSON.stringify({ commandId: crypto.randomUUID(), name })
    }, signal);
    if (signal.aborted || current !== generation || id !== documentId) return;
    await readPages(signal);
    if (signal.aborted || current !== generation || id !== documentId) return;
    documentShell.patch({ renameName: documentShell.getSnapshot().title, renameStatus: 'Имя документа изменено.' });
  } catch (error) {
    if (aborted(error) || current !== generation || id !== documentId) return;
    documentShell.patch({ renameStatus: '', renameError: uncertain(error)
      ? 'Не удалось подтвердить результат. Обновите документ перед повторной попыткой: команда могла выполниться.' : errorMessage(error) });
  } finally {
    if (current === generation && id === documentId) { documentShell.patch({ renameBusy: false }); startLive(); }
  }
}

async function refreshPages(offset = 0): Promise<void> {
  await run(() => refreshPages(offset), async (signal, current) => {
    await readPages(signal, offset);
    if (current()) message('Страницы обновлены.');
  });
}

async function pageCommand<K extends keyof PageCommandData>(command: K, data: PageCommandData[K], selection?: string | null, screenSelection?: string): Promise<void> {
  if (!documentId || !canEditDocument(getDocumentRole())) return;
  stopLive();
  const { signal, current } = startRequest();
  requestRunner.clearRetry(); message('Отправка изменений в общий черновик…');
  documentShell.patch({ pageBusy: true });
  try {
    await postPageCommand(request, documentId, command, data, signal);
    if (signal.aborted || current !== generation) return;
    selectionState.selectAfterCommand(selection, screenSelection);
    await readPages(signal);
    if (current === generation) {
      message('Изменения подтверждены в общем черновике.');
    }
  } catch (error) {
    if (aborted(error) || current !== generation) return;
    const unknownResult = uncertain(error);
    message('', unknownResult ? 'Не удалось подтвердить результат команды. Обновите страницы перед повторным действием: команда могла выполниться.' : errorMessage(error));
  } finally {
    if (current === generation) { documentShell.patch({ pageBusy: false }); startLive(); }
  }
}

const navigation = createNavigation({
  isAuthenticated: () => !!token,
  openDocument, loadList,
  requestLeave: resume => scenarios.requestLeave(resume),
  currentDocument: () => documentId,
  focusContent: () => element('content').focus(),
  hasDirtyDraft: () => scenarios.hasDirtyDraft(),
});
function route() { return navigation.route(); }
function navigate(path: string) { navigation.navigate(path); }

function submitBearerToken(supplied: string) {
  if (!isValidBearerToken(supplied)) {
    message('', 'Введите токен без пробелов и префикса Bearer.');
    return;
  }
  setToken(supplied);
  authenticationView.clearToken();
  authenticationView.setVisible(false);
  shellState.patch({ authenticated: true });
  route();
  requestAnimationFrame(() => element('content').focus());
}
async function signOut() {
  if (isGoogleMode()) {
    try {
      await logoutGoogleSession();
    } catch (error) { message('', errorMessage(error)); return; }
  }
  clearSession();
  if (!isGoogleMode()) authenticationView.focusToken();
}
async function createDocument() {
  if (shellState.getSnapshot().controlsDisabled || !token) return;
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
  if (importOperation || !token) return;
  const file = shellState.getSnapshot().importFile;
  if (!file) return;
  const name = file.name.toLowerCase();
  const format = name.endsWith('.figvam') ? 'container.figvam' : name.endsWith('.json') ? 'document.json' : null;
  shellState.patch({ importError: '', importStatus: '', importDiagnostics: [] });
  if (!format) { shellState.patch({ importError: 'Выберите файл document.json или .figvam.' }); return; }
  const operation = { token, epoch: navigationEpoch };
  importOperation = operation;
  const active = () => importOperation === operation && token === operation.token && navigationEpoch === operation.epoch;
  shellState.patch({ importBusy: true, importStatus: 'Импорт документа…' });
  try {
    const response = await fetch(`/api/v1/documents/import/${format}`, {
      method: 'POST', body: file, cache: 'no-store', credentials: credentialsMode(), redirect: 'error',
      headers: { ...authHeaders(operation.token, 'POST'), 'Content-Type': format === 'document.json' ? 'application/json' : 'application/zip' }
    });
    if (!active()) return;
    if (response.status === 401) { clearSession(); message('', 'Сессия завершена. Войдите повторно.'); return; }
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
    if (importOperation === operation && token === operation.token && navigationEpoch === operation.epoch + 1) navigate(`/documents/${body.documentId}`);
  } catch {
    if (active()) shellState.patch({ importStatus: '', importError: 'Результат импорта неизвестен: документ мог быть создан. Проверьте список перед повторной попыткой.' });
  } finally {
    if (importOperation === operation) {
      importOperation = null;
      shellState.patch({ importBusy: false, ...(navigationEpoch !== operation.epoch ? { importStatus: '' } : {}) });
    }
  }
}
function createScreen() {
  if (documentShell.getSnapshot().pageBusy) return;
  const width = Number.parseFloat(documentShell.getSnapshot().screenWidth), height = Number.parseFloat(documentShell.getSnapshot().screenHeight);
  if (!Number.isFinite(width) || width < 0 || !Number.isFinite(height) || height < 0) { message('', 'Укажите конечные неотрицательные ширину и высоту.'); return; }
  if (!selectionState.selectedPage) return;
  const screenId = crypto.randomUUID();
  pageCommand('add-screen', { pageId: selectionState.selectedPage, screenId, dimensions: { width, height } }, undefined, screenId);
}
const navigatorView = createDocumentNavigator(views.navigator, {
  isBusy: () => documentShell.getSnapshot().pageBusy || !navigatorCanEdit(),
  selectPage, selectScreen,
  startRename: startNavigatorNameEdit,
  changeDraft(kind, value) { const draft = navigatorEditState(kind); if (draft) draft.value = value; },
  discardRename: discardNavigatorRename,
  saveRename(kind, id, previousName, name) {
    discardNavigatorRename(kind, id);
    if (name === previousName) return;
    if (kind === 'page') void pageCommand('rename-page', {pageId:id, name});
    else void pageCommand('rename-screen', {screenId:id, name});
  },
  deletePage(item) {
    if (revisions.revision !== null && confirm('Удалить страницу «' + item.name + '»? Её экраны и их содержимое будут удалены.'))
      void pageCommand('delete-page', {pageId:item.id, expectedRevision: revisions.revision}, selectionState.selectedPage === item.id ? null : undefined);
  },
  duplicateScreen(item) {
    if (revisions.revision === null) return;
    const newScreenId = crypto.randomUUID();
    void pageCommand('duplicate-screen', {screenId:item.id, newScreenId, expectedRevision: revisions.revision}, undefined, newScreenId);
  },
});
renderPages();
function closeNavigatorContextMenus() {
  for (const menu of document.querySelectorAll<HTMLDetailsElement>('.navigator-context-menu[open]')) menu.open = false;
}
element('pages').addEventListener('scroll', closeNavigatorContextMenus);
window.addEventListener('resize', closeNavigatorContextMenus);
function createPage() {
  if (documentShell.getSnapshot().pageBusy) return;
  const pageId = crypto.randomUUID();
  pageCommand('add-page', { pageId }, pageId);
}
navigation.attach();
window.addEventListener('pagehide', event => {
  try { clearSession(); } finally { if (!event.persisted) disposeApplicationRoot(); }
});
async function initializeAuthentication() {
  try {
    const mode = await readAuthenticationMode();
    if (mode === 'bearer') {
      authenticationView.setMode('bearer');
      editorShell.setSignoutLabel('Забыть токен');
      return;
    }
    authenticationView.setMode('google');
    const authError = new URLSearchParams(location.search).get('auth_error');
    if (authError) authenticationView.setError('Google-аккаунт не подтверждён или доступ к FigVam не разрешён.');
    const session = await restoreGoogleSession();
    if (!session) return;
    setCsrf(session.csrfToken);
    setToken('__figvam_browser_session__');
    authenticationView.setVisible(false);
    shellState.patch({ authenticated: true });
    route();
    homeNavigation.setAdmin(session.admin === true);
    await userAdmin.show(session.admin === true);
  } catch (error) {
    authenticationView.setError(errorMessage(error));
  }
}
initializeAuthentication();
clearSession();
