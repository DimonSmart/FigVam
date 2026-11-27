import { createAuthContext } from '../api/auth-client';
import { createDocumentCreation } from '../features/home/document-creation';
import { createScreenCapture } from '../canvas/screen-capture';
import { createApiClient, type ApiClient } from '../api/api-client';
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
import { createSessionLifecycle } from '../core/session';

import { element } from './dom';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createCanvasChrome } from './canvas-chrome';
import { createPreviewChrome } from './preview-chrome';
import { disposeApplicationRoot, mountApplicationRoot } from './application-root';
import { ApplicationShell } from './application-shell';
import { createDocumentShellModel, createDeletionViewModel, canEditDocument } from './document-shell-state';
import { createApplicationShellState } from './application-shell-state';
import { createApplicationViews } from './application-views';
import { aborted, errorMessage, text } from '../api/decode';
import type { DocumentListItem } from '../api/document-list';
import type { DeleteCatalogCommand } from '../features/home/document-list';
import { createDocumentMutations } from './document-mutations';
import { createPageCommands } from './page-commands';

import { createRequestRunner } from './request-runner';
import { createDocumentCatalog } from './document-catalog';
import { createNavigation } from './navigation';
import { createDocumentRevisionState } from './document-workspace';
import { createWorkspaceSelection } from './workspace-selection';
import { createDocumentSync, type SelectionChange } from './document-sync';
import { isValidBearerToken, logoutGoogleSession, readAuthenticationMode, restoreGoogleSession } from '../features/home/session-authentication';
import { createDocumentNavigator, type NavigatorKind, type RenameDraft } from '../features/editor/document-navigator';
const sessionState = createSessionLifecycle();
const auth = createAuthContext();
const { setToken, advanceNavigation, cancelRequest, startRequest } = sessionState;
// Synchronization reads must not supersede unrelated foreground work.
const startSynchronization = () => ({signal:sessionState.navigationSignal,current:sessionState.generation});
const catalog = createDocumentCatalog();
const shellState = createApplicationShellState();
const documentShell = createDocumentShellModel();
const deletionView = createDeletionViewModel();
const getDocumentRole = () => documentShell.getSnapshot().role;
const isEditorVisible = () => shellState.getSnapshot().view === 'editor';
const requestRunner = createRequestRunner(sessionState, {
  stopLive: () => stopLive(), startLive: () => startLive(), message,
  setBusy: busy => shellState.patch({ busy }),
  setControlsDisabled: controlsDisabled => shellState.patch({ controlsDisabled }),
});
function run(...args: Parameters<typeof requestRunner.run>) { return requestRunner.run(...args); }

const previewChrome=createPreviewChrome(),canvasChrome=createCanvasChrome();
const editorShell = createEditorShell({ canvasChrome, zoomIn:()=>canvasViewport.zoomIn(),zoomOut:()=>canvasViewport.zoomOut(),fitCanvas:()=>canvasViewport.fit(),actualSize:()=>canvasViewport.actualSize(), previewChrome, openPreview:()=>visualScreens.openPreview(), closePreview:()=>visualScreens.closePreview(), changePreviewTheme:theme=>visualScreens.changeTheme(theme), resetPreview:()=>visualScreens.resetPreview(), previewBack:()=>visualScreens.goBack(), retryRender:()=>visualScreens.retry(), beforePrototypeLeave: next => scenarios.requestLeave(next), addTool: kind => visualNodeEditor.addFromToolbar(kind), signOut: () => { void signOut(); }, createPage, document: documentShell, deletion: deletionView, renameDocument, deleteDocument, retryDeletion, createScreen, refreshPages: () => { void refreshPages(); } });
const views = createApplicationViews();
mountApplicationRoot(createElement(ApplicationShell, { shell: editorShell, views, model: shellState, actions: {
  createDocument: () => { void documentCreation.createDocument(); }, changeDocumentName: documentName => shellState.patch({ documentName }),
  chooseImportFile: importFile => shellState.patch({ importFile }), importDocument: () => { void documentCreation.importDocument(); },
  refresh: () => { void loadList(); },
  previous: () => { const page = catalog.previous(); if (page) void loadList(page.index, page.cursor); },
  next: () => { const page = catalog.next(); if (page) void loadList(page.index, page.cursor); },
  retry: () => { void requestRunner.retry(); },
} }));
const authenticationView = createAuthenticationView(views.authentication, submitBearerToken);
const documentListView = createDocumentListView(views.documentList, deleteCatalogDocument);
const homeNavigation = createHomeNavigation(views.homeNavigation, selectHomeView);
const userAdmin = createUserAdmin(views.userAdmin, auth);
function selectHomeView(view: 'users' | 'documents') {
  const users = view === 'users' && homeNavigation.isAdmin();
  shellState.patch({ homeView: users ? 'users' : 'documents' });
  homeNavigation.select(users ? 'users' : 'documents');
}
const pageSize = 20;
let documentId: string | null = null;
const selectionState = createWorkspaceSelection();
const revisions = createDocumentRevisionState();
let statusDismissTimer: ReturnType<typeof setTimeout> | undefined;
const request: ApiClient = createApiClient({
  auth,
  getToken: () => sessionState.token,
  getSessionEpoch: () => sessionState.sessionEpoch,
  getSessionSignal: () => sessionState.signal,
  onUnauthorized: () => {
    clearSession();
    message('', 'Сессия завершена. Войдите повторно.');
  }
});

const documentCreation = createDocumentCreation({
  auth,
  shellState, request, run, message, navigate, loadList, session: sessionState,
  onUnauthorized: () => { clearSession(); message('', 'Сессия завершена. Войдите повторно.'); }
});

const diagnostics: ReturnType<typeof createScreenDiagnostics> = createScreenDiagnostics({ model: views.diagnostics,
  request, pageSize,
  getContext: () => ({ documentId, screen: selectionState.selectedScreen, revision: revisions.revision, token: sessionState.token, navigationEpoch: sessionState.navigationEpoch, isEditorVisible: isEditorVisible() })
});
const screenResize: ReturnType<typeof createScreenResize> = createScreenResize({ model: views.screenResize,
  element, request, refreshPages: () => refreshPages(),
  workspace: {
    isEditorVisible,
    get documentId() { return documentId; }, get documentRole() { return getDocumentRole(); },
    get selectedScreen() { return selectionState.selectedScreen; }, get screensItems() { return selectionState.screens; },
    get generation() { return sessionState.generation; }, get token() { return sessionState.token; },
    get navigationEpoch() { return sessionState.navigationEpoch; }, get revision() { return revisions.revision; }
  }
});

const documentQueries = createDocumentQueries(request);
const findRole = documentQueries.findRole;

const mcpContext = () => ({ documentId, token: sessionState.token, navigationEpoch: sessionState.navigationEpoch, role: getDocumentRole(), title: documentShell.getSnapshot().title, theme: visualScreens.currentTheme });
const mcpAccess: ReturnType<typeof createMcpAccess> = createMcpAccess({ model: views.mcp, request, menu: editorShell.menu, getContext: mcpContext, capture: createScreenCapture({ request, getContext: mcpContext }) });

const { start: startLive, stop: stopLive } = createDocumentCollaboration({
  auth,
  request,
  workspace: {
    get documentId() { return documentId; },
    get revision() { return revisions.revision; },
    get token() { return sessionState.token; }
  },
  isEditorVisible,
  readRevision: (signal, targetRevision) => readPages(signal, 0, targetRevision),
  onConnectionStatus: connectionStatus => documentShell.patch({ connectionStatus }),
  onAccessLost: closeInaccessibleDocument,
  readRole: documentQueries.findRole, onRoleChanged: setDocumentRole,
  onCaptureEvent: mcpAccess.onCaptureEvent,
  onCaptureDisconnect: mcpAccess.onCaptureDisconnect,
  onUnauthorized: () => {
    clearSession();
    message('', 'Сессия завершена. Войдите повторно.');
  }
});

const documentExport: ReturnType<typeof createDocumentExport> = createDocumentExport({
  auth,
  model: views.documentExport, isEditorVisible, getContext: () => ({ token: sessionState.token, documentId, documentRole: getDocumentRole(), revision: revisions.revision, navigationEpoch: sessionState.navigationEpoch }),
  onUnauthorized: () => {
    clearSession();
    message('', 'Сессия завершена. Войдите повторно.');
  }
});

const tokens: ReturnType<typeof createTokens> = createTokens({
  models:views.tokens,showEditor:editorShell.showEditor,selectLayer:id=>layers.selectById(id),request,
  getContext: () => ({ documentId, documentRole: getDocumentRole(), revision: revisions.revision, generation: sessionState.generation, navigationEpoch: sessionState.navigationEpoch }),
  startRequest: startSynchronization, stopLive, startLive, readPages
});
const styles: ReturnType<typeof createStyles> = createStyles({
  models:views.styles,selectLayer:id=>layers.selectById(id),request, getTokens: () => tokens.items,
  getContext: () => ({ documentId, documentRole: getDocumentRole(), revision: revisions.revision, generation: sessionState.generation, navigationEpoch: sessionState.navigationEpoch }),
  startRequest: startSynchronization, stopLive, startLive, readPages
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
    get token() { return sessionState.token; }, get navigationEpoch() { return sessionState.navigationEpoch; }
  }
});
const datasets: ReturnType<typeof createDatasets> = createDatasets({
  model: views.datasets, request, pageSize,
  getContext: () => ({ documentId, documentRole: getDocumentRole(), revision: revisions.revision, catalogRevision: revisions.catalogRevision, token: sessionState.token, generation: sessionState.generation, navigationEpoch: sessionState.navigationEpoch }),
  startRequest: startSynchronization, stopLive, startLive, readPages, run
});
function discardDocumentEdits(id: string) {
  scenarios.clearDocumentCommands(id); pageCommands.discard(id); visualNodeEditor.clearDocument(id);
  layers.discardDocument(id); documentHistory.discardDocument(id); screenResize.discardDocument(id);
  screenVariants.discardDocument(id); datasets.discardDocument(id); tokens.discardDocument(id);
  styles.discardDocument(id); documentMutations.discardDocument(id);
  visualScreens.clearPropertyPreviews(); requestRunner.clearRetry();
}
function setDocumentRole(role: string) {
  const previous=getDocumentRole();
  if(previous===role||!documentId)return;
  documentShell.patch({role});
  if(canEditDocument(previous)&&!canEditDocument(role)){
    discardDocumentEdits(documentId);
    scenarios.reset(); datasets.reset(); tokens.reset(); styles.reset();
    screenResize.resetDraft(); documentExport.reset(); mcpAccess.reset();
    documentShell.patch({pageBusy:false,renameBusy:false});
    // Retain the document and selection but reload authoritative read-only data.
    void readPages(sessionState.navigationSignal).catch(error=>{
      if(!aborted(error)&&getDocumentRole()===role)message('',errorMessage(error));
    });
  }
  members.prepare(role);
  datasets.refreshAccess(); tokens.refreshAccess(); layers.refreshMoveAvailability();
  renderPages(); screenResize.render(); visualNodeEditor.refresh(); documentExport.render();
}
function closeInaccessibleDocument(status: number) {
  mcpAccess.reset();
  if(documentId)discardDocumentEdits(documentId);
  visualScreens.clearPropertyPreviews(); requestRunner.clearRetry();
  cancelRequest(); advanceNavigation();
  documentShell.patch({role:null}); shellState.patch({view:'none',busy:false,controlsDisabled:false});
  diagnostics.reset(); scenarios.reset(); layers.reset(); documentHistory.reset();
  tokens.reset(); styles.reset(); components.reset(); datasets.reset(); screenVariants.reset(); screenResize.resetDraft();
  documentId = null;
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
  editorShell.menu.publish(null);
  mcpAccess.reset();
  documentCreation.reset();
  pageCommands.clear();
  documentMutations.clear(); datasets.clearCommands(); screenVariants.clearCommands(); tokens.clearCommands(); styles.clearCommands();
  presence.stop(); advanceNavigation(); diagnostics.reset(); scenarios.reset(); members.reset(); documentExport.reset(); scenarios.clearCommands(); layers.clearCommands();
  stopLive();
  setToken('');
  auth.setCsrf('');
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
  documentShell.patch({ screenPreset: '1440x900', screenWidth: '1440', screenHeight: '900', pageBusy: false, title: '', revisionLabel: '' });
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
    isEditorVisible,
    get documentId() { return documentId; },
    get documentRole() { return getDocumentRole(); },
    get navigationEpoch() { return sessionState.navigationEpoch; },
    get token() { return sessionState.token; }
  }
});

const documentHistory: ReturnType<typeof createDocumentHistory> = createDocumentHistory({ models: views.history,
  request, pageSize, refreshPages: async () => {
    let synced=false;
    await run(() => refreshPages(), async (signal,current) => { synced=await readPages(signal,0,null,current)===true; });
    return synced;
  },
  workspace: {
    isEditorVisible,
    get documentId() { return documentId; },
    get documentRole() { return getDocumentRole(); },
    get navigationEpoch() { return sessionState.navigationEpoch; },
    get token() { return sessionState.token; },
    get revision() { return revisions.revision; }
  }
});

const layers: ReturnType<typeof createLayers> = createLayers({
  model: views.layers, setMoveEnabled:layerMoveEnabled=>documentShell.patch({layerMoveEnabled}), element, request, refreshPages, closeInaccessibleDocument, message,
  workspace: {
    isEditorVisible,
    get documentId() { return documentId; },
    get documentRole() { return getDocumentRole(); },
    get selectedScreen() { return selectionState.selectedScreen; },
    get revision() { return revisions.revision; },
    get navigationEpoch() { return sessionState.navigationEpoch; },
    get token() { return sessionState.token; }
  },
  runPageRefresh: work => run(() => refreshPages(), work),
  readCurrentPages: (signal, isCurrent, reveal) => readPages(signal, 0, null, isCurrent, reveal),
  beforeSelectionChange: next => scenarios.requestLeave(next),
  onSelectionCleared: () => { scenarios.clearLayerSelection(); visualScreens.syncSelection(); visualNodeEditor.refresh(); },
  onLayerSelected: () => { scenarios.onLayerSelected(); visualScreens.syncSelection(); visualNodeEditor.refresh(); }
});

const scenarios: ReturnType<typeof createScenarios> = createScenarios({
  models:views.scenarios,element, request, pageSize,
  prototypeVisible:()=>editorShell.rightTab.getSnapshot()==='prototype',subscribePrototype:editorShell.rightTab.subscribe,
  workspace: {
    isEditorVisible,
    get documentId() { return documentId; },
    get documentRole() { return getDocumentRole(); },
    get revision() { return revisions.revision; },
    get selectedScreen() { return selectionState.selectedScreen; },
    get layerSelection() { return layers.selection; },
    get token() { return sessionState.token; },
    get navigationEpoch() { return sessionState.navigationEpoch; }
  },
  findLayer: layers.findLayer,
  setInteractiveNodes: layers.setInteractiveNodes,
  selectSource: layers.selectFromCanvas,
  reloadPages: (targetRevision, isCurrent) =>
    run(() => refreshPages(), signal => readPages(signal, 0, targetRevision, isCurrent)),
  findRole,
  setDocumentRole,
  closeInaccessibleDocument
});

async function loadList(index = 0, cursor: string | null | undefined = null): Promise<void> {
  mcpAccess.reset();
  documentMutations.leaveDeletion();
  if (!sessionState.token) return;
  presence.stop(); advanceNavigation(); diagnostics.reset(); scenarios.reset(); members.reset(); documentExport.reset();
  stopLive();
  layers.reset();
  documentHistory.reset(); tokens.reset(); styles.reset(); components.reset(); datasets.reset(); screenVariants.reset(); screenResize.resetDraft(); documentId = null; documentShell.patch({ role: null }); revisions.reset();
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

function deleteCatalogDocument(item:DocumentListItem,command:DeleteCatalogCommand){return documentMutations.deleteCatalogDocument(item,command);}

function navigatorCanEdit() {
  return canEditDocument(getDocumentRole());
}
function navigatorEditState(kind: NavigatorKind) {
  return selectionState.renameDraft(kind);
}
function setNavigatorEditState(kind: NavigatorKind, value: RenameDraft | null) {
  selectionState.setRenameDraft(kind, value);
}
function renderNavigatorKind(kind: NavigatorKind, synchronous=false) {
  if (kind === 'page') renderPages(synchronous);
  else {renderScreens();if(synchronous)renderPages(true);}
}
function startNavigatorNameEdit(kind: NavigatorKind, id: string, name: string) {
  if (!navigatorCanEdit() || documentShell.getSnapshot().pageBusy) return;
  setNavigatorEditState(kind === 'page' ? 'screen' : 'page', null);
  setNavigatorEditState(kind, {id, value:name});
  renderNavigatorKind(kind);
}
function discardNavigatorRename(kind: NavigatorKind, id: string) {
  setNavigatorEditState(kind, null);
  renderNavigatorKind(kind,true);
  document.querySelector<HTMLElement>('[data-' + kind + '-rename-id="' + id + '"]')?.focus({ preventScroll: true });
}
function renderPages(synchronous=false) {
  navigatorView.render(selectionState.navigatorState(navigatorCanEdit()),synchronous);
}
function selectPage(id: string) {
  if (selectionState.selectedPage !== id && !scenarios.requestLeave(() => selectPage(id))) return;
  if (selectionState.selectedPage === id) {
    selectionState.togglePage();
    renderPages(true);
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
  // Only suggest creation on the first empty page. Opening the popover on every
  // navigation obscures the page tree, and closing a user-opened menu mid-command
  // makes the form unusable while the page creation is still being committed.
  if (selectionState.selectedScreen || selectionState.screens.length > 0 || selectionState.pages.length > 1) editorShell.menu.close('screen-create');
  else if (selectionState.selectedPage && selectionState.pages.length === 1 &&
      (getDocumentRole() === 'Owner' || getDocumentRole() === 'Editor') &&
      !editorShell.menu.getSnapshot()?.startsWith('page:') && !editorShell.menu.getSnapshot()?.startsWith('screen:') && !selectionState.renameDraft('page')) editorShell.menu.publish('screen-create');
}




const presence: ReturnType<typeof createPresence> = createPresence({
  auth,
  isEditorVisible,
  models: views.presence,
  element,
  getContext: () => ({ token: sessionState.token, documentId, navigationEpoch: sessionState.navigationEpoch, selectedScreen: selectionState.selectedScreen, selectedLayer: layers.selection }),
  toViewportPoint: point => canvasViewport.toViewportPoint(point)
});
const canvasViewport: ReturnType<typeof createCanvasViewport> = createCanvasViewport({
  chrome:canvasChrome,element,
  getScreen: () => selectionState.activeScreen,
  getSelectedScreen: () => selectionState.selectedScreen,
  onViewportChange: presence.render,
  setPresenceCursor: presence.setCursor
});
const visualScreens: ReturnType<typeof createVisualScreens> = createVisualScreens({
  chrome:previewChrome,publishMode:active=>{if(previewChrome.getSnapshot().active!==active)flushSync(()=>previewChrome.patch({active}));},
  element, request, closeInaccessibleDocument, onDesignChange: () => canvasNodes.sync(),
  getContext: () => ({ documentId, revision: revisions.revision, screen: selectionState.activeScreen,
    selection: layers.selection, tokens: tokens.items, styles: styles.items, variantId: screenVariants.selectedVariantId })
});
const visualNodeEditor: ReturnType<typeof createVisualNodeEditor> = createVisualNodeEditor({
  models: views.propertyFields,
  request, readModel: visualScreens.readDesignModel, closeInaccessibleDocument, stopLive, startLive,
  previewProperties: visualScreens.setPropertyPreview,
  onDrawingToolsChanged: editorShell.setDrawingTools,
  getContext: () => ({ documentId, documentRole: getDocumentRole(), revision: revisions.revision, screen: selectionState.selectedScreen,
    variantId: screenVariants.selectedVariantId, selection: layers.selection, navigationEpoch: sessionState.navigationEpoch, token: sessionState.token }),
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
  isEditPending: () => visualNodeEditor.editPending,
  setHint:hint=>canvasChrome.patch({hint}),deleteSelected:layers.deleteNode
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
  context: () => ({ documentId, screen: selectionState.selectedScreen, page: selectionState.selectedPage, navigationEpoch: sessionState.navigationEpoch, revision: revisions.revision }),
  shouldReportFailure: signal => signal === sessionState.pending?.signal,
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
    tokens.clearBusy();
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
  documentMutations.leaveDeletion();
  if (documentMutations.deletingId === id) {
    history.replaceState(null, '', '/');
    return loadList();
  }
  presence.stop(); advanceNavigation(); diagnostics.reset(); scenarios.reset(); members.reset(); documentExport.reset();
  stopLive();
  resetDocumentRename();
  shellState.patch({ view: 'none' });
  document.title = 'FigVam — открытие документа';
  documentHistory.reset(); tokens.reset(); styles.reset(); components.reset(); datasets.reset(); screenVariants.reset(); screenResize.resetDraft(); documentId = id; documentShell.patch({ role: null, pageBusy: false }); revisions.reset(); selectionState.reset(); layers.reset(); renderCanvas();
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
    pageCommands.resume();
  });
}

const documentMutations=createDocumentMutations({
  sessionState,shellState,documentShell,deletionView,request,getDocumentId:()=>documentId,getRevision:()=>revisions.revision,
  loadList,openDocument,refresh:(signal,current)=>readPages(signal,0,null,current),stopLive,startLive,message,setRetry:requestRunner.setRetry,
  navigateHome:()=>history.pushState(null,'','/'),confirmDeletion:message=>confirm(message),
});
function deleteDocument(){documentMutations.deleteDocument();}
function retryDeletion(){documentMutations.retryDeletion();}
function renameDocument(){return documentMutations.renameDocument();}

async function refreshPages(offset = 0): Promise<void> {
  await run(() => refreshPages(offset), async (signal, current) => {
    await readPages(signal, offset);
    if (current()) message('Страницы обновлены.');
  });
}

const pageCommands = createPageCommands({
  request,
  context: () => ({documentId,revision:revisions.revision,navigationEpoch:sessionState.navigationEpoch,
    sessionEpoch:sessionState.sessionEpoch,page:selectionState.selectedPage,screen:selectionState.selectedScreen,canEdit:canEditDocument(getDocumentRole())}),
  stopLive,startLive,setBusy:pageBusy=>documentShell.patch({pageBusy}),
  setRetry:requestRunner.setRetry,message,
  select:selectionState.selectAfterCommand,
  refresh:(signal,current)=>readPages(signal,0,null,current),
});
const pageCommand=pageCommands.start;

const navigation = createNavigation({
  isAuthenticated: () => !!sessionState.token,
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
  const epoch = sessionState.sessionEpoch;
  if (auth.isGoogleMode()) {
    try {
      await logoutGoogleSession(auth, sessionState.signal);
    } catch (error) { if (epoch === sessionState.sessionEpoch) message('', errorMessage(error)); return; }
  }
  if (epoch !== sessionState.sessionEpoch) return;
  clearSession();
  if (!auth.isGoogleMode()) authenticationView.focusToken();
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
  menu:editorShell.menu,
  isBusy: () => documentShell.getSnapshot().pageBusy || !navigatorCanEdit(),
  selectPage, selectScreen,
  startRename: startNavigatorNameEdit,
  changeDraft(kind, value) {
    const draft = navigatorEditState(kind);
    if (draft) { setNavigatorEditState(kind, { ...draft, value }); renderPages(); }
  },
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
function createPage() {
  if (documentShell.getSnapshot().pageBusy) return;
  const pageId = crypto.randomUUID();
  pageCommand('add-page', { pageId }, pageId);
}
const detachNavigation=navigation.attach();
window.addEventListener('pagehide', event => {
  try { clearSession(); } finally {
    if (!event.persisted) {
      detachNavigation();mcpAccess.dispose();scenarios.dispose();documentHistory.dispose();layers.dispose();
      screenResize.dispose();canvasNodes.dispose();canvasViewport.dispose();visualScreens.dispose();navigatorView.dispose();disposeApplicationRoot();
    }
  }
});
window.addEventListener('pageshow',event=>{if(event.persisted)void initializeAuthentication();});
async function initializeAuthentication() {
  const epoch = sessionState.sessionEpoch;
  try {
    const mode = await readAuthenticationMode();
    if (epoch !== sessionState.sessionEpoch) return;
    auth.configureAuth(mode);
    if (mode === 'bearer') {
      authenticationView.setMode('bearer');
      editorShell.setSignoutLabel('Забыть токен');
      return;
    }
    authenticationView.setMode('google');
    const authError = new URLSearchParams(location.search).get('auth_error');
    if (authError) authenticationView.setError('Google-аккаунт не подтверждён или доступ к FigVam не разрешён.');
    const session = await restoreGoogleSession();
    if (!session || epoch !== sessionState.sessionEpoch) return;
    auth.setCsrf(session.csrfToken);
    setToken('__figvam_browser_session__');
    authenticationView.setVisible(false);
    shellState.patch({ authenticated: true });
    route();
    homeNavigation.setAdmin(session.admin === true);
    await userAdmin.show(session.admin === true);
  } catch (error) {
    if (epoch === sessionState.sessionEpoch) authenticationView.setError(errorMessage(error));
  }
}
clearSession();
initializeAuthentication();
