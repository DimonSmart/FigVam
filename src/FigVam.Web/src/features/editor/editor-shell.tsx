import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MousePointer2, Frame, Type, RectangleHorizontal, TextCursorInput, Image } from 'lucide-react';
import { Button } from '../../ui/button';

function required<T>(value:T|null|undefined, description:string):T {
  if(value==null) throw new Error('Missing editor shell element: '+description);
  return value;
}
function asElement<T extends HTMLElement>(node:HTMLElement, ctor:{new():T}):T {
  if(!(node instanceof ctor)) throw new Error('Unexpected element type: '+node.id);
  return node;
}
function section(node:HTMLElement):HTMLElement {return required(node.closest('section'),node.id+' section');}
// Presentation-only composition. Existing editor modules continue to own documents and commands.
function el<K extends keyof HTMLElementTagNameMap>(tag:K, className?:string, text?:string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function group(title:string, ...nodes:Node[]) {
  const section = el('section', 'editor-group');
  const heading = el('h3', 'editor-group-title', title);
  section.append(heading, ...nodes);
  return section;
}

function menu(label:string, className:string) {
  const details = el('details', 'editor-menu ' + className);
  const summary = el('summary', 'menu-trigger', label);
  details.append(summary);
  return details;
}

const toolIcons={select:MousePointer2, Frame, Text:Type, Button:RectangleHorizontal, TextInput:TextCursorInput, Image};
type ToolKind=keyof typeof toolIcons;
function renderToolIcon(host:HTMLElement,name:ToolKind) {
  const Icon=toolIcons[name],root=createRoot(host);
  flushSync(()=>root.render(<Icon size={18} strokeWidth={1.7} aria-hidden="true"/>));
}

type TabEntry=readonly [key:string,name:string,panel:HTMLElement];
type BeforeSelect=(previous:string|undefined,next:string,resume:()=>void)=>boolean;
function tabs(root:HTMLElement, entries:readonly TabEntry[], label:string, beforeSelect:BeforeSelect|null=null) {
  const nav=el('div','editor-tabs');
  nav.setAttribute('role','tablist');
  nav.setAttribute('aria-label',label);
  const stage=el('div','panel-stage');
  const reactRoot=createRoot(nav);
  let selected:string|undefined;
  for(const [key,,panel] of entries) {
    panel.classList.add('panel-page');
    panel.id ||= 'shell-'+key;
    panel.setAttribute('role','tabpanel');
    panel.setAttribute('aria-labelledby','tab-'+key);
    stage.append(panel);
  }
  function focus(key:string) {document.getElementById('tab-'+key)?.focus();}
  function select(key:string,confirmed=false):boolean {
    if(!confirmed&&beforeSelect&&!beforeSelect(selected,key,()=>{select(key,true);focus(key);})) return false;
    selected=key;
    for(const [id,,panel] of entries) panel.hidden=id!==key;
    flushSync(()=>reactRoot.render(<>{entries.map(([id,name,panel])=><Button key={id} id={'tab-'+id} className="editor-tab" role="tab" aria-controls={panel.id} aria-selected={id===selected} tabIndex={id===selected?0:-1} onClick={()=>select(id)}>{name}</Button>)}</>));
    return true;
  }
  nav.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const active=entries.findIndex(([key])=>document.getElementById('tab-'+key)===document.activeElement);
    if(active<0)return;
    const next=event.key==='Home'?0:event.key==='End'?entries.length-1:(active+(event.key==='ArrowRight'?1:-1)+entries.length)%entries.length;
    const entry=entries[next];
    event.preventDefault();
    if(entry&&select(entry[0]))focus(entry[0]);
  });
  root.append(nav,stage);
  const first=entries[0];
  if(first)select(first[0]);
  return{select};
}

export function createEditorShell({ beforePrototypeLeave = () => true }:{beforePrototypeLeave?:(resume:()=>void)=>boolean} = {}) {
  // Capture original nodes before reparenting them into temporarily detached panels.
  const shellNodes = new Map([...document.querySelectorAll<HTMLElement>('[id]')].map(node => [node.id, node]));
  const byId = (id:string):HTMLElement => required(shellNodes.get(id) ?? document.getElementById(id),id);
  const input=(id:string)=>asElement(byId(id),HTMLInputElement);
  const select=(id:string)=>asElement(byId(id),HTMLSelectElement);
  const form=(id:string)=>asElement(byId(id),HTMLFormElement);
  const button=(id:string)=>asElement(byId(id),HTMLButtonElement);
  const design = byId('editor-design');
  const header = required(design.querySelector<HTMLElement>(':scope > .document-panel'),':scope > .document-panel');
  const workspace = required(design.querySelector<HTMLElement>('.workspace'),'.workspace');
  const left = required(workspace.querySelector<HTMLElement>('aside:first-child'),'aside:first-child');
  const right = required(workspace.querySelector<HTMLElement>('aside:last-child'),'aside:last-child');
  const canvas = required(workspace.querySelector<HTMLElement>('.canvas'),'.canvas');
  design.classList.add('app-shell');
  header.classList.add('app-toolbar');
  left.classList.add('layers-sidebar');
  right.classList.add('properties-sidebar');

  // Move the existing controls rather than recreating them or their event handlers.
  const docMenu = menu('Файл', 'document-menu');
  const shareMenu = menu('Поделиться', 'share-menu');
  const mcpMenu = menu('MCP-доступ', 'mcp-menu');
  mcpMenu.id = 'mcp-access-menu';
  const mcpBody = el('div', 'menu-body');
  mcpBody.id = 'mcp-access-body';
  mcpMenu.append(mcpBody);
  const documentActions = el('div', 'menu-body');
  docMenu.append(documentActions);
  const exportSection = section(byId('export-title'));
  const versionSection = section(byId('versions-title'));
  const historySection = section(byId('undo'));
  const rename = byId('document-rename');
  const deletion = byId('delete-document');
  const versionSave = byId('version-save');
  const historyAccess = byId('history-access');
  documentActions.append(group('Документ', rename, deletion), group('Экспорт', exportSection),
    group('Версии', versionSave, versionSection),
    group('История команд', historyAccess, byId('history-action-status'),
      byId('history-action-error'), byId('history-action-retry')));
  historySection.remove();

  const shareActions = el('div', 'menu-body');
  const presenceSection = section(byId('presence-title'));
  const membersSection = byId('member-management');
  shareActions.append(group('Совместная работа', membersSection, presenceSection));
  shareMenu.append(shareActions);

  const presence = byId('presence-list');
  presence.classList.add('presence-chips');
  presenceSection.insertAdjacentElement('afterbegin', el('p', 'visually-hidden', 'Настройки присутствия'));
  const headerEnd = el('div', 'app-header-actions');
  const leftToggle = el('button', 'icon-action sidebar-toggle', '☰');
  leftToggle.type = 'button'; leftToggle.title = 'Показать или скрыть слои';
  leftToggle.setAttribute('aria-label', 'Показать или скрыть слои');
  const rightToggle = el('button', 'icon-action sidebar-toggle', '▤');
  rightToggle.type = 'button'; rightToggle.title = 'Показать или скрыть инспектор';
  rightToggle.setAttribute('aria-label', 'Показать или скрыть инспектор');
  leftToggle.addEventListener('click', () => {
    const closed = workspace.classList.toggle('left-collapsed');
    leftToggle.setAttribute('aria-expanded', String(!closed));
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  });
  rightToggle.addEventListener('click', () => {
    const closed = workspace.classList.toggle('right-collapsed');
    rightToggle.setAttribute('aria-expanded', String(!closed));
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  });
  leftToggle.setAttribute('aria-expanded', 'true');
  rightToggle.setAttribute('aria-expanded', 'true');
  const undo = byId('undo'), redo = byId('redo'), preview = byId('open-preview');
  for (const [button, label, sign] of [[undo, 'Отменить действие', '↶'], [redo, 'Повторить действие', '↷']] as const) {
    button.textContent = sign;
    button.title = label; button.setAttribute('aria-label', label); button.classList.add('icon-action');
  }
  const signOut = el('button', 'subtle-action', 'Выйти');
  signOut.id = 'editor-signout';
  signOut.type = 'button';
  signOut.addEventListener('click', () => byId('disconnect').click());
  const mobileSignOut = el('button', 'mobile-signout', 'Выйти');
  mobileSignOut.id = 'editor-signout-menu';
  mobileSignOut.type = 'button';
  mobileSignOut.addEventListener('click', () => byId('disconnect').click());
  documentActions.append(group('Аккаунт', mobileSignOut));
  const mode = el('div', 'document-mode-switch');
  const editorMode = el('button', 'editor-tab', 'Редактор');
  const tokenMode = el('button', 'editor-tab', 'Токены');
  editorMode.id = 'document-mode-editor'; tokenMode.id = 'document-mode-tokens';
  for (const button of [editorMode, tokenMode]) button.type = 'button';
  mode.append(editorMode, tokenMode);
  mode.setAttribute('role', 'group'); mode.setAttribute('aria-label', 'Режим документа');
  design.insertBefore(mode, workspace);
  const brand = el('span', 'editor-brand', 'FigVam');
  header.insertBefore(brand, header.firstChild);
  const originalMode = [...header.children].find(child => child.tagName === 'SPAN' && child.textContent?.trim() === 'Design');
  originalMode?.remove();
  headerEnd.append(leftToggle, rightToggle, undo, redo, preview,
    presence, byId('connection-status'), shareMenu, mcpMenu, docMenu, signOut);
  header.append(headerEnd);

  // Master-detail navigation: document pages/screens above, selected screen's layers below.
  const pagesGroup = group('Страницы и экраны');
  const pageEdit = byId('page-edit');
  byId('page-create').classList.add('add-page-action');
  byId('page-create').setAttribute('aria-label', 'Создать страницу');
  byId('page-create').title = 'Создать страницу';
  byId('page-refresh').title = 'Обновить страницы';

  const screensSection = section(byId('screens-title'));
  const screenForm = byId('screen-create');
  const screenOptions = menu('+ Экран', 'inline-menu screen-options');
  const preset = document.createElement('select');
  preset.id = 'screen-preset';
  preset.setAttribute('aria-label', 'Типовой размер экрана');
  for (const [value, label] of [['1440x900','Desktop · 1440 × 900'], ['390x844','Mobile · 390 × 844'],
      ['768x1024','Tablet · 768 × 1024'], ['custom','Другой размер']]) preset.add(new Option(label, value));
  const screenWidth = input('screen-width'), screenHeight = input('screen-height');
  const initialPreset = required(preset.options[0],'initial preset').value;
  const [defaultWidth='1440', defaultHeight='900'] = initialPreset.split('x');
  screenWidth.defaultValue = screenWidth.value = defaultWidth;
  screenHeight.defaultValue = screenHeight.value = defaultHeight;
  preset.addEventListener('change', () => {
    if (preset.value === 'custom') return;
    const [width='', height=''] = preset.value.split('x');
    screenWidth.value = width;
    screenHeight.value = height;
  });
  const syncPreset = () => {
    const dimensions = `${screenWidth.value}x${screenHeight.value}`;
    preset.value = [...preset.options].some(option => option.value === dimensions) ? dimensions : 'custom';
  };
  screenWidth.addEventListener('input', syncPreset);
  screenHeight.addEventListener('input', syncPreset);
  screenForm.addEventListener('reset', () => { preset.value = initialPreset; });
  const screenMenuBody = el('div', 'screen-options-body');
  screenMenuBody.append(preset, screenForm);
  screenOptions.append(screenMenuBody);
  const navigatorToolbar = el('div', 'navigator-toolbar');
  navigatorToolbar.append(pageEdit, screenOptions, byId('page-refresh'));
  const navigatorMenus: [HTMLDetailsElement,HTMLElement][] = [[screenOptions, screenMenuBody]];
  function positionNavigatorMenu(menu:HTMLDetailsElement, body:HTMLElement) {
    if (!menu.open || !body.getClientRects().length) return;
    const anchor = required(menu.querySelector('summary'),'menu summary').getBoundingClientRect();
    const margin = 8, gap = 6;
    // Keep the automatically suggested creation form below the empty page's row,
    // so that the page's rename and context actions remain directly clickable.
    const selectedPageRow = byId('pages').querySelector(':scope > li > .page-select[aria-pressed="true"]')?.parentElement;
    const emptyPage = selectedPageRow && !selectedPageRow.querySelector('.screen-row');
    const lowerEdge = emptyPage ? Math.max(anchor.bottom, selectedPageRow.getBoundingClientRect().bottom) : anchor.bottom;
    const below = Math.max(0, window.innerHeight - lowerEdge - gap - margin);
    const above = Math.max(0, anchor.top - gap - margin);
    body.style.maxHeight = '';
    const openAbove = body.offsetHeight > below && above > below;
    body.style.maxHeight = `${openAbove ? above : below}px`;
    const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - body.offsetWidth - margin));
    const top = openAbove ? anchor.top - gap - body.offsetHeight : lowerEdge + gap;
    body.style.left = `${left}px`;
    body.style.top = `${top}px`;
  }
  function positionNavigatorMenus() {
    for (const [menu, body] of navigatorMenus) positionNavigatorMenu(menu, body);
  }
  for (const [current, body] of navigatorMenus) {
    current.addEventListener('toggle', () => {
      if (!current.open) return;
      for (const [other] of navigatorMenus) {
        if (other !== current) other.open = false;
      }
      for (const rowMenu of document.querySelectorAll<HTMLDetailsElement>('.navigator-context-menu[open]')) rowMenu.open = false;
      positionNavigatorMenu(current, body);
    });
  }
  // The toolbar can become visible again when switching tabs or opening a collapsed sidebar.
  const navigatorObserver = new ResizeObserver(positionNavigatorMenus);
  navigatorObserver.observe(navigatorToolbar);
  window.addEventListener('resize', positionNavigatorMenus);
  const screensList = byId('screens');
  pagesGroup.append(navigatorToolbar, byId('pages'), byId('page-access'), screensList);
  byId('pages').setAttribute('aria-label', 'Страницы и экраны');
  byId('screens').setAttribute('aria-label', 'Экраны выбранной страницы');
  // The screen list is moved under its selected page by renderPages.
  screensSection.remove();
  const layersSection = section(byId('layers-title'));
  layersSection.classList.add('layer-tree-group');
  const layersPage = el('div', 'layers-page');
  const master = el('div', 'layers-master');
  const detail = el('div', 'layers-detail');
  master.append(pagesGroup);
  detail.append(layersSection);
  const splitter = el('div', 'layers-splitter');
  splitter.tabIndex = 0;
  splitter.setAttribute('role', 'separator');
  splitter.setAttribute('aria-label', 'Изменить высоту навигации и дерева слоёв');
  splitter.setAttribute('aria-orientation', 'horizontal');
  splitter.setAttribute('aria-valuemin', '22');
  splitter.setAttribute('aria-valuemax', '72');
  function setSplit(percent:number) {
    const value = Math.round(Math.min(72, Math.max(22, percent)));
    master.style.flexBasis = `${value}%`;
    splitter.setAttribute('aria-valuenow', String(value));
  }
  function resizeAt(y:number) {
    const bounds = layersPage.getBoundingClientRect();
    if (bounds.height) setSplit((y - bounds.top) / bounds.height * 100);
  }
  let dragging = false;
  splitter.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    dragging = true;
    splitter.setPointerCapture(event.pointerId);
    resizeAt(event.clientY);
    event.preventDefault();
  });
  splitter.addEventListener('pointermove', event => {
    if (dragging) resizeAt(event.clientY);
  });
  splitter.addEventListener('pointerup', () => { dragging = false; });
  splitter.addEventListener('pointercancel', () => { dragging = false; });
  splitter.addEventListener('lostpointercapture', () => { dragging = false; });
  splitter.addEventListener('keydown', event => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    setSplit(Number(splitter.getAttribute('aria-valuenow')) + (event.key === 'ArrowDown' ? 5 : -5));
  });
  setSplit(42);
  layersPage.append(master, splitter, detail);

  const componentsPage = el('div', 'components-page');
  componentsPage.append(section(byId('components-title')));
  const resources = el('div', 'assets-page');
  const pngHelp = required(byId('asset-upload-form').nextElementSibling,'PNG help');
  const assetPanel = group('Изображения', byId('asset-upload-form'), pngHelp, byId('asset-upload-status'),
    byId('asset-upload-error'), byId('asset-upload-retry'));
  const tokenPage = section(byId('tokens-title'));
  tokenPage.id = 'token-workspace'; tokenPage.classList.add('token-workspace');
  const tokenHeader = el('div', 'token-tree-toolbar');
  const tokenGrid = el('div', 'token-workspace-grid');
  const tokenSidebar = el('div', 'token-sidebar');
  const tokenGroups = el('nav', 'token-groups'); tokenGroups.id = 'token-groups';
  tokenGroups.setAttribute('aria-label', 'Группы токенов');
  const tokenTable = el('div', 'token-table-area');
  const tokenDetails = el('aside', 'token-details-area');
  const search = el('input'); search.id = 'token-search'; search.type = 'search'; search.placeholder = 'Поиск токенов'; search.setAttribute('aria-label', 'Поиск токенов');
  const menuButton = el('button', 'token-menu-button', '…'); menuButton.id = 'token-menu-open'; menuButton.type = 'button';
  menuButton.setAttribute('aria-label', 'Управление токенами'); menuButton.setAttribute('popovertarget', 'token-menu');
  const tokenMenu = el('div', 'token-menu'); tokenMenu.id = 'token-menu'; tokenMenu.setAttribute('popover', 'auto');
  tokenMenu.setAttribute('role', 'group'); tokenMenu.setAttribute('aria-label', 'Управление токенами');
  const command = (id:string, label:string) => { const b = el('button', '', label); b.id = id; b.type = 'button'; b.addEventListener('click', () => { tokenMenu.hidePopover(); menuButton.focus(); }); return b; };
  const newToken = command('new-token-open', '+ Новый токен…'); newToken.hidden = true;
  const importButton = command('token-import-open', 'Импорт токенов…'); importButton.hidden = true;
  const exportButton = command('token-export', 'Экспорт токенов…');
  const exportLight = command('token-export-light', 'Экспорт Light');
  const exportDark = command('token-export-dark', 'Экспорт Dark');
  for (const b of [exportButton, exportLight, exportDark]) b.disabled = true;
  const typeFilter = el('div', 'token-type-filter'); typeFilter.id = 'token-type-filter';
  typeFilter.setAttribute('role', 'group'); typeFilter.setAttribute('aria-label', 'Отображаемые типы');
  tokenMenu.append(newToken, el('hr'), importButton, exportButton, exportLight, exportDark, el('hr'), typeFilter);
  function positionTokenMenu() {
    if (!tokenMenu.matches(':popover-open')) return;
    const rect = menuButton.getBoundingClientRect();
    const margin = 8;
    tokenMenu.style.left = Math.max(margin, Math.min(rect.right - tokenMenu.offsetWidth, window.innerWidth - tokenMenu.offsetWidth - margin)) + 'px';
    const below = window.innerHeight - rect.bottom - margin, above = rect.top - margin;
    const openAbove = below < tokenMenu.scrollHeight && above > below;
    tokenMenu.style.maxHeight = Math.max(0, openAbove ? above : below) + 'px';
    tokenMenu.style.top = (openAbove ? rect.top - tokenMenu.offsetHeight : rect.bottom) + 'px';
  }
  tokenMenu.addEventListener('toggle', positionTokenMenu);
  window.addEventListener('resize', positionTokenMenu);
  tokenHeader.append(search, menuButton, tokenMenu);
  tokenSidebar.append(tokenHeader, tokenGroups);
  const importForm = el('form', 'token-import-form'); importForm.id = 'token-import-form'; importForm.hidden = true;
  const modeLabel = el('label', '', 'Формат импорта');
  const importMode = el('select'); importMode.id = 'token-import-mode';
  importMode.add(new Option('FigVam — обе темы', 'combined')); importMode.add(new Option('Два файла DTCG', 'pair'));
  modeLabel.append(importMode); importForm.append(modeLabel);
  for (const [key, title] of [['combined','FigVam JSON'],['light','DTCG JSON · Light'],['dark','DTCG JSON · Dark']]) {
    const label = el('label', '', title); label.id = 'token-import-' + key + '-label';
    const field = el('textarea'); field.id = 'token-import-' + key; field.rows = 4; label.append(field);
    const file = el('input'); file.type = 'file'; file.accept = '.json,application/json';
    file.id = field.id + '-file'; file.setAttribute('aria-label', 'Файл токенов ' + (key === 'combined' ? 'FigVam' : key === 'light' ? 'Light' : 'Dark'));
    label.append(file); importForm.append(label);
  }
  const mappingLabel = el('label', '', 'Сопоставление типов/категорий (JSON, необязательно)');
  const mapping = el('textarea'); mapping.id = 'token-import-mapping'; mapping.rows = 3; mapping.placeholder = '{"dimensionTypes":{"space":"Spacing"}}'; mappingLabel.append(mapping);
  const importSubmit = el('button', '', 'Импортировать токены'); importSubmit.type = 'submit';
  const importCancel = el('button', '', 'Отмена'); importCancel.type = 'button'; importCancel.addEventListener('click', () => { importForm.hidden = true; });
  importForm.append(mappingLabel, importSubmit, importCancel);
  const placeholder = el('p', 'token-placeholder', 'Выберите токен или создайте новый.'); placeholder.id = 'token-placeholder';
  const tokenDiagnostic = el('p', 'token-invalid'); tokenDiagnostic.id = 'token-detail-diagnostic'; tokenDiagnostic.setAttribute('role','status');
  byId('token-detail-type').after(tokenDiagnostic);
  const cancelNew = el('button', '', 'Отмена'); cancelNew.id = 'new-token-cancel'; cancelNew.type = 'button'; byId('token-create').append(cancelNew);
  const table = el('table', 'token-table'); table.setAttribute('aria-label','Токены документа');
  const head = table.createTHead().insertRow();
  for (const name of ['Имя','Тип','Light','Dark','Источник','Usages','Статус']) { const th = el('th', '', name); th.scope = 'col'; head.append(th); }
  const body = table.createTBody(); body.id = 'tokens-list';
  byId('tokens-list').remove();
  tokenPage.removeAttribute('aria-labelledby'); tokenPage.setAttribute('aria-label', 'Токены');
  tokenTable.append(table);
  tokenDetails.append(placeholder, byId('token-create'), byId('token-detail'));
  tokenGrid.append(tokenSidebar, tokenTable, tokenDetails);
  const stylesPanel = byId('styles-panel');
  const status = byId('tokens-status'), error = byId('tokens-error');
  tokenPage.replaceChildren(status, error, importForm, tokenGrid);
  design.append(tokenPage);
  const stylesGroup = el('section', 'editor-group');
  stylesGroup.append(stylesPanel);
  resources.append(assetPanel, section(byId('datasets-title')),
    stylesGroup, section(byId('screen-variants-title')));
  function selectMode(tokens:boolean) {
    if (!tokens && tokenMenu.matches(':popover-open')) tokenMenu.hidePopover();
    workspace.hidden = tokens; tokenPage.hidden = !tokens;
    editorMode.setAttribute('aria-pressed', String(!tokens)); tokenMode.setAttribute('aria-pressed', String(tokens));
    for (const control of [leftToggle, rightToggle]) control.hidden = tokens;
    if (!tokens) requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  editorMode.addEventListener('click', () => selectMode(false));
  tokenMode.addEventListener('click', () => {
    if (tokenPage.hidden && document.getElementById('tab-prototype')?.getAttribute('aria-selected') === 'true') {
      if (!beforePrototypeLeave(() => selectMode(true))) return;
    }
    selectMode(true);
  });
  selectMode(false);
  const treeTitle = byId('tree-title');
  treeTitle.classList.add('visually-hidden');
  left.replaceChildren(treeTitle);
  tabs(left, [['layers', 'Слои', layersPage], ['components', 'Компоненты', componentsPage],
    ['assets', 'Ресурсы', resources]], 'Разделы документа');

  // Right: only the selection and applicable properties by default.
  const inspectorPage = el('div', 'inspector-page');
  const inspectorTitle = byId('inspector-title');
  const selection = byId('inspector-selection');
  const nodeDelete = byId('node-delete');
  const metadata = byId('node-metadata');
  const visualInspector = byId('visual-inspector');
  const screenSize = section(byId('screen-size-title'));
  inspectorPage.append(inspectorTitle, selection, nodeDelete,
    byId('node-delete-status'), byId('node-delete-retry'), visualInspector, metadata, screenSize);
  const prototypePage = el('div', 'prototype-page');
  prototypePage.append(section(byId('scenarios-title')));
  const diagnosticsPage = el('div', 'diagnostics-page');
  diagnosticsPage.append(section(byId('diagnostics-title')));
  right.replaceChildren();
  tabs(right, [['design', 'Дизайн', inspectorPage], ['prototype', 'Prototype', prototypePage],
    ['diagnostics', 'Проверка', diagnosticsPage]], 'Разделы инспектора',
    (previous, next, resume) => previous !== 'prototype' || next === 'prototype' || beforePrototypeLeave(resume));

  // Creation toolbar submits the original profile-aware add-node form.
  const drawing = el('div', 'drawing-toolbar');
  const drawingLabel = el('span', 'drawing-label', 'Инструменты');
  drawing.append(drawingLabel);
  const selectTool = el('button', 'drawing-tool selected');
  selectTool.type = 'button'; selectTool.title = 'Выбор и перемещение';
  selectTool.setAttribute('aria-label', 'Выбор и перемещение');
  renderToolIcon(selectTool,'select');
  selectTool.addEventListener('click', () => byId('viewport').focus());
  drawing.append(selectTool);
  const palette = byId('visual-palette');
  const kindSelect = select('visual-kind');
  const parentSelect = select('visual-parent');
  const addForm = form('visual-palette-form');
  const detailed = menu('Параметры добавления', 'palette-options');
  detailed.append(palette);
  const toolNames = [['Frame', 'Контейнер'], ['Text', 'Текст'], ['Button', 'Кнопка'],
    ['TextInput', 'Поле ввода'], ['Image', 'Изображение']] as const;
  const buttons:[ToolKind,HTMLButtonElement][] = [];
  function syncTools() {
    const enabled = !palette.hidden && !addForm.hidden && !kindSelect.disabled;
    for (const [kind, button] of buttons) {
      button.disabled = !enabled || ![...kindSelect.options].some(option => option.value === kind);
    }
  }
  for (const [kind, label] of toolNames) {
    const button = el('button', 'drawing-tool');
    button.type = 'button'; button.title = 'Добавить: ' + label;
    button.setAttribute('aria-label', 'Добавить ' + label.toLowerCase());
    renderToolIcon(button,kind);
    button.addEventListener('click', () => {
      if (button.disabled) return;
      kindSelect.value = kind;
      kindSelect.dispatchEvent(new Event('change', { bubbles: true }));
      if (asElement(byId('visual-add'),HTMLButtonElement).disabled && parentSelect.options.length) {
        parentSelect.selectedIndex = 0;
        parentSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (asElement(byId('visual-add'),HTMLButtonElement).disabled) {
        detailed.open = true;
        byId('visual-required-properties').querySelector<HTMLElement>('input, select, textarea')?.focus();
      } else addForm.requestSubmit();
    });
    buttons.push([kind, button]);
    drawing.append(button);
  }
  drawing.append(detailed);
  const observer = new MutationObserver(syncTools);
  observer.observe(palette, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(addForm, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(kindSelect, { childList: true, attributes: true, attributeFilter: ['disabled'] });
  syncTools();
  const compact = matchMedia('(max-width: 1050px)');
  function resetPanelLayout(narrow:boolean) {
    workspace.classList.toggle('left-collapsed', narrow);
    workspace.classList.toggle('right-collapsed', narrow);
    leftToggle.setAttribute('aria-expanded', String(!narrow));
    rightToggle.setAttribute('aria-expanded', String(!narrow));
  }
  resetPanelLayout(compact.matches);
  compact.addEventListener('change', event => resetPanelLayout(event.matches));

  const canvasTitle = byId('canvas-title');
  canvasTitle.classList.add('visually-hidden');
  const viewportControls = required(canvas.querySelector<HTMLElement>('.viewport-controls'),'.viewport-controls');
  canvas.insertBefore(drawing, canvas.firstChild);
  canvas.append(viewportControls);
  canvas.classList.add('design-canvas');
  const canvasHelp = byId('canvas-help');
  canvasHelp.classList.add('visually-hidden');
  const blank = el('div', 'canvas-blank');
  blank.id = 'canvas-empty';
  const blankTitle = el('h2', '', 'Нет выбранного экрана');
  const blankText = el('p', '', 'Выберите экран слева или создайте новый, чтобы начать работу.');
  const blankAction = el('button', 'primary-action', 'Создать экран');
  blankAction.type = 'button';
  blankAction.setAttribute('aria-label', 'Открыть создание экрана');
  blankAction.addEventListener('click', () => {
    if (!byId('page-edit').hidden && !byId('pages').querySelector('[aria-pressed=true]')) {
      byId('page-create').click();
      return;
    }
    const container = byId('screen-create').closest<HTMLDetailsElement>('details');
    if (!container || byId('screen-create').hidden) return;
    byId('tab-layers').click();
    workspace.classList.remove('left-collapsed');
    leftToggle.setAttribute('aria-expanded', 'true');
    container.open = true;
    byId('screen-width').focus();
  });
  blank.append(blankTitle, blankText, blankAction);
  canvas.insertBefore(blank, byId('viewport'));
  const zoom = byId('zoom-level');
  zoom.title = 'Текущий масштаб';
  byId('zoom-out').title = 'Уменьшить';
  byId('zoom-in').title = 'Увеличить';
  byId('fit-screen').title = 'Вместить экран в холст';
  byId('canvas-selection').classList.add('canvas-caption');

  // Menus are temporary views. Their controls keep their draft values when closed.
  // Close previously open menus before a pointer action; do not close a menu opened by that click.
  document.addEventListener('pointerdown', event => {
    if(!(event.target instanceof Element))return;
    const clickedMenu = event.target.closest('details.editor-menu, .navigator-toolbar details, .navigator-context-menu');
    for (const details of document.querySelectorAll<HTMLDetailsElement>('details.editor-menu[open], .navigator-toolbar details[open], .navigator-context-menu[open]')) {
      if (details !== clickedMenu && !details.contains(event.target)) details.open = false;
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const opened = [...document.querySelectorAll<HTMLDetailsElement>('details.editor-menu[open], .navigator-toolbar details[open], .navigator-context-menu[open]')];
    if (!opened.length) return;
    const last=opened.at(-1);
    if(!last)return;
    last.open=false;
    last.querySelector<HTMLElement>('summary')?.focus();
    event.preventDefault();
  });
}
