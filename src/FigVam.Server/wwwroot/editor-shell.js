// Presentation-only composition. Existing editor modules continue to own documents and commands.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function group(title, ...nodes) {
  const section = el('section', 'editor-group');
  const heading = el('h3', 'editor-group-title', title);
  section.append(heading, ...nodes);
  return section;
}

function menu(label, className) {
  const details = el('details', 'editor-menu ' + className);
  const summary = el('summary', 'menu-trigger', label);
  details.append(summary);
  return details;
}

function icon(name) {
  const paths = {
    select: '<path d="m5 3 14 9-7 1-3 7z"/>',
    Frame: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 8h16M8 4v16"/>',
    Text: '<path d="M4 6V4h16v2M12 4v16M8 20h8"/>',
    Button: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M9 12h6"/>',
    TextInput: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 9v6M6 9h4M6 15h4M13 12h5"/>',
    Image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 18 6-6 4 3 3-4 4 5"/>'
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths[name];
  return svg;
}

function tabs(root, entries, label, beforeSelect = null) {
  const byId = id => document.getElementById(id);
  const nav = el('div', 'editor-tabs');
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', label);
  const stage = el('div', 'panel-stage');
  for (const [key, name, panel] of entries) {
    panel.classList.add('panel-page');
    panel.id ||= 'shell-' + key;
    const tab = el('button', 'editor-tab', name);
    tab.type = 'button';
    tab.id = 'tab-' + key;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    tab.addEventListener('click', () => select(key));
    nav.append(tab);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    stage.append(panel);
  }
  function select(key, confirmed = false) {
    const previous = entries.find(([id]) => byId('tab-' + id)?.getAttribute('aria-selected') === 'true')?.[0];
    if (!confirmed && beforeSelect && !beforeSelect(previous, key, () => { select(key, true); byId('tab-' + key)?.focus(); })) return false;
    for (const [id, , panel] of entries) {
      const selected = id === key;
      panel.hidden = !selected;
      const tab = byId('tab-' + id);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    return true;
  }
  nav.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const active = entries.findIndex(([key]) => byId('tab-' + key) === document.activeElement);
    if (active < 0) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 :
      (active + (event.key === 'ArrowRight' ? 1 : -1) + entries.length) % entries.length;
    event.preventDefault();
    if (select(entries[next][0])) byId('tab-' + entries[next][0]).focus();
  });
  root.append(nav, stage);
  select(entries[0][0]);
  return { select };
}

export function createEditorShell({ beforePrototypeLeave = () => true } = {}) {
  // Capture original nodes before reparenting them into temporarily detached panels.
  const shellNodes = new Map([...document.querySelectorAll('[id]')].map(node => [node.id, node]));
  const byId = id => shellNodes.get(id) ?? document.getElementById(id);
  const design = byId('editor-design');
  const header = design.querySelector(':scope > .document-panel');
  const workspace = design.querySelector('.workspace');
  const left = workspace.querySelector('aside:first-child');
  const right = workspace.querySelector('aside:last-child');
  const canvas = workspace.querySelector('.canvas');
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
  const exportSection = byId('export-title').closest('section');
  const versionSection = byId('versions-title').closest('section');
  const historySection = byId('undo').closest('section');
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
  const presenceSection = byId('presence-title').closest('section');
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
  for (const [button, label, sign] of [[undo, 'Отменить действие', '↶'], [redo, 'Повторить действие', '↷']]) {
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
  const mode = el('span', 'design-mode', 'Design');
  const brand = el('span', 'editor-brand', 'FigVam');
  header.insertBefore(brand, header.firstChild);
  const originalMode = [...header.children].find(child => child.tagName === 'SPAN' && child.textContent.trim() === 'Design');
  originalMode?.remove();
  headerEnd.append(leftToggle, rightToggle, undo, redo, mode, preview,
    presence, byId('connection-status'), shareMenu, mcpMenu, docMenu, signOut);
  header.append(headerEnd);

  // Master-detail navigation: document pages/screens above, selected screen's layers below.
  const pagesGroup = group('Страницы и экраны');
  const pageEdit = byId('page-edit');
  const pageOptions = menu('⋯', 'inline-menu page-options');
  pageOptions.querySelector('summary').setAttribute('aria-label', 'Действия страницы');
  pageOptions.querySelector('summary').title = 'Действия страницы';
  const pageMenuBody = el('div', 'navigator-page-menu');
  pageMenuBody.append(byId('page-rename'), byId('page-delete'));
  pageOptions.append(pageMenuBody);
  pageEdit.append(pageOptions);
  byId('page-create').classList.add('add-page-action');
  byId('page-create').setAttribute('aria-label', 'Создать страницу');
  byId('page-create').title = 'Создать страницу';
  byId('page-refresh').title = 'Обновить страницы';

  const screensSection = byId('screens-title').closest('section');
  const screenForm = byId('screen-create');
  const screenOptions = menu('+ Экран', 'inline-menu screen-options');
  const preset = document.createElement('select');
  preset.id = 'screen-preset';
  preset.setAttribute('aria-label', 'Типовой размер экрана');
  for (const [value, label] of [['1440x900','Desktop · 1440 × 900'], ['390x844','Mobile · 390 × 844'],
      ['768x1024','Tablet · 768 × 1024'], ['custom','Другой размер']]) preset.add(new Option(label, value));
  const screenWidth = byId('screen-width'), screenHeight = byId('screen-height');
  const initialPreset = preset.options[0].value;
  const [defaultWidth, defaultHeight] = initialPreset.split('x');
  screenWidth.defaultValue = screenWidth.value = defaultWidth;
  screenHeight.defaultValue = screenHeight.value = defaultHeight;
  preset.addEventListener('change', () => {
    if (preset.value === 'custom') return;
    const [width, height] = preset.value.split('x');
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
  const navigatorMenus = [[pageOptions, pageMenuBody], [screenOptions, screenMenuBody]];
  function positionNavigatorMenu(menu, body) {
    if (!menu.open || !body.getClientRects().length) return;
    const anchor = menu.querySelector('summary').getBoundingClientRect();
    const margin = 8, gap = 6;
    const below = Math.max(0, window.innerHeight - anchor.bottom - gap - margin);
    const above = Math.max(0, anchor.top - gap - margin);
    body.style.maxHeight = '';
    const openAbove = body.offsetHeight > below && above > below;
    body.style.maxHeight = `${openAbove ? above : below}px`;
    const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - body.offsetWidth - margin));
    const top = openAbove ? anchor.top - gap - body.offsetHeight : anchor.bottom + gap;
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
  const layersSection = byId('layers-title').closest('section');
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
  function setSplit(percent) {
    const value = Math.round(Math.min(72, Math.max(22, percent)));
    master.style.flexBasis = `${value}%`;
    splitter.setAttribute('aria-valuenow', String(value));
  }
  function resizeAt(y) {
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
  componentsPage.append(byId('components-title').closest('section'));
  const resources = el('div', 'assets-page');
  const pngHelp = byId('asset-upload-form').nextElementSibling;
  const assetPanel = group('Изображения', byId('asset-upload-form'), pngHelp, byId('asset-upload-status'),
    byId('asset-upload-error'), byId('asset-upload-retry'));
  resources.append(assetPanel, byId('datasets-title').closest('section'),
    byId('tokens-title').closest('section'), byId('screen-variants-title').closest('section'));
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
  const screenSize = byId('screen-size-title').closest('section');
  inspectorPage.append(inspectorTitle, selection, nodeDelete,
    byId('node-delete-status'), byId('node-delete-retry'), visualInspector, metadata, screenSize);
  const prototypePage = el('div', 'prototype-page');
  prototypePage.append(byId('scenarios-title').closest('section'));
  const diagnosticsPage = el('div', 'diagnostics-page');
  diagnosticsPage.append(byId('diagnostics-title').closest('section'));
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
  selectTool.append(icon('select'));
  selectTool.addEventListener('click', () => byId('viewport').focus());
  drawing.append(selectTool);
  const palette = byId('visual-palette');
  const kindSelect = byId('visual-kind');
  const parentSelect = byId('visual-parent');
  const addForm = byId('visual-palette-form');
  const detailed = menu('Параметры добавления', 'palette-options');
  detailed.append(palette);
  const toolNames = [['Frame', 'Контейнер'], ['Text', 'Текст'], ['Button', 'Кнопка'],
    ['TextInput', 'Поле ввода'], ['Image', 'Изображение']];
  const buttons = [];
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
    button.append(icon(kind));
    button.addEventListener('click', () => {
      if (button.disabled) return;
      kindSelect.value = kind;
      kindSelect.dispatchEvent(new Event('change', { bubbles: true }));
      if (byId('visual-add').disabled && parentSelect.options.length) {
        parentSelect.selectedIndex = 0;
        parentSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (byId('visual-add').disabled) {
        detailed.open = true;
        byId('visual-required-properties').querySelector('input, select, textarea')?.focus();
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
  function resetPanelLayout(narrow) {
    workspace.classList.toggle('left-collapsed', narrow);
    workspace.classList.toggle('right-collapsed', narrow);
    leftToggle.setAttribute('aria-expanded', String(!narrow));
    rightToggle.setAttribute('aria-expanded', String(!narrow));
  }
  resetPanelLayout(compact.matches);
  compact.addEventListener('change', event => resetPanelLayout(event.matches));

  const canvasTitle = byId('canvas-title');
  canvasTitle.classList.add('visually-hidden');
  const viewportControls = canvas.querySelector('.viewport-controls');
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
    const container = byId('screen-create').closest('details');
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
    const clickedMenu = event.target.closest('details.editor-menu, .navigator-toolbar details');
    for (const details of document.querySelectorAll('details.editor-menu[open], .navigator-toolbar details[open]')) {
      if (details !== clickedMenu && !details.contains(event.target)) details.open = false;
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const opened = [...document.querySelectorAll('details.editor-menu[open], .navigator-toolbar details[open]')];
    if (!opened.length) return;
    opened[opened.length - 1].open = false;
    opened[opened.length - 1].querySelector('summary')?.focus();
    event.preventDefault();
  });
}
