const element = id => document.getElementById(id);
let token = '';
let generation = 0;
let pending = null;
let cursors = [null];
let pageIndex = 0;
let nextCursor = null;
let retry = null;
const pageSize = 20;
let documentId = null, documentRole = null, revision = null, selectedPage = null, pagesOffset = 0, pagesTotal = 0;
let pagesItems = [];
const versionOperations = new Map();
const restoreOperations = new Map();
let historyGeneration = 0, historyController = null, historyCursors = [null], historyIndex = 0, historyNext = null;
let selectedScreen = null, screensOffset = 0, screensTotal = 0, screensItems = [];
let viewport = { scale: 1, x: 0, y: 0 };
let displayedScreen = null;
let layerController = null, layerGeneration = 0, layerSelection = null;
let layerRoots = [], layerExpanded = new Set(), layerChildren = new Map();

let liveController = null;
function stopLive() {
  liveController?.abort(); liveController = null;
  element('connection-status').textContent = '';
}
function startLive() {
  if (liveController || !token || !documentId || element('editor-view').hidden || !Number.isSafeInteger(revision)) return;
  const controller = new AbortController(); liveController = controller;
  followDocument(documentId, controller);
}
async function followDocument(id, controller) {
  const signal = controller.signal, base = `/api/v1/documents/${encodeURIComponent(id)}`;
  const active = () => !signal.aborted && liveController === controller && documentId === id;
  let delay = 1000;
  function denied() {
    if (!active()) return;
    pending?.abort(); generation++; resetLayers(); resetVersionHistory();
    documentRole = null; revision = null; pagesItems = []; screensItems = []; selectedPage = selectedScreen = null;
    renderPages(); renderScreens(); element('editor-view').hidden = true;
    stopLive(); message('', 'Доступ к документу потерян. Запросите права у владельца и откройте документ снова.');
  }
  async function frame(raw) {
    const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || !active()) return;
    const event = JSON.parse(data);
    if (event.code === 'FORBIDDEN') { const error = new Error('Доступ потерян'); error.status = 403; throw error; }
    if (event.code === 'RECONNECT_REQUIRED') throw new Error('Требуется восстановление');
    if (event.code !== 'CHANGE') return;
    if (!Number.isSafeInteger(event.revision) || event.change?.documentId?.toLowerCase() !== id.toLowerCase()) throw new Error('Некорректное событие');
    if (event.revision <= revision) return;
    if (event.revision !== revision + 1) throw new Error('Пропуск ревизии');
    await readPages(signal, pagesOffset, event.revision);
    if (active()) element('connection-status').textContent = 'Подключено · изменения участников получаются автоматически.';
  }
  while (active()) {
    let reader;
    try {
      element('connection-status').textContent = 'Восстановление соединения…';
      const recovery = await request(`${base}/reconnect?lastSeenRevision=${revision}`, {}, signal);
      if (!active()) return;
      if (!['EVENTS', 'SNAPSHOT'].includes(recovery.code) || !Number.isSafeInteger(recovery.revision)) throw new Error('Некорректный ответ восстановления');
      // Render the recovered revision through the same bounded, revision-pinned queries as initial loading.
      await readPages(signal, pagesOffset, recovery.revision);
      if (!active()) return;
      const response = await fetch(`${base}/events?lastSeenRevision=${revision}`, {
        signal, cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { Authorization: `Bearer ${token}` }
      });
      if (!active()) return;
      if (response.status === 401) { clearSession(); message('', 'Токен истёк или отклонён. Введите действующий токен.'); return; }
      if (!response.ok) { const error = new Error('Соединение прервано'); error.status = response.status; throw error; }
      if (!response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('Некорректный поток');
      reader = response.body.getReader();
      const decoder = new TextDecoder(); let buffer = '';
      element('connection-status').textContent = 'Подключено · изменения участников получаются автоматически.';
      delay = 1000;
      while (active()) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); await frame(raw);
        }
        if (buffer.length > 1048576) throw new Error('Слишком большое событие');
      }
    } catch (error) {
      if (!active() || error.name === 'AbortError') return;
      if ([403, 404].includes(error.status)) { denied(); return; }
      if (error.status === 429) delay = 30000;
    } finally {
      if (reader) await reader.cancel().catch(() => {});
    }
    if (!active()) return;
    element('connection-status').textContent = 'Связь прервана · повторное подключение автоматически. Показана последняя полученная ревизия.';
    await new Promise(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, delay); signal.addEventListener('abort', done, { once: true });
    });
    delay = Math.min(delay * 2, 30000);
  }
}

function message(status = '', error = '') {
  element('status').textContent = status;
  element('error').textContent = error;
  element('retry').hidden = !error || !retry;
}

function clearSession() {
  stopLive();
  token = '';
  versionOperations.clear(); restoreOperations.clear(); resetVersionHistory();
  pending?.abort();
  generation++;
  element('token').value = '';
  element('document-name').value = '';
  element('document-list').replaceChildren();
  documentId = documentRole = revision = selectedPage = null; pagesOffset = pagesTotal = 0; pagesItems = [];
  element('pages').replaceChildren();
  selectedScreen = null; screensOffset = screensTotal = 0; screensItems = [];
  element('screens').replaceChildren();
  resetLayers();
  renderCanvas();
  element('screen-create').reset();
  element('page-edit').inert = false;
  element('document-title').textContent = '';
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

async function request(path, options, signal) {
  const requestToken = token;
  const response = await fetch(path, {
    ...options, signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, ...(options?.body ? { 'Content-Type': 'application/json' } : {}) }
  });
  if (signal?.aborted || requestToken !== token) throw new DOMException('Cancelled', 'AbortError');
  if (response.status === 401) {
    clearSession();
    throw new Error('Токен отсутствует, истёк или отклонён. Введите действующий токен.');
  }
  if (!response.ok) {
    const errors = {
      400: 'Сервер отклонил запрос. Проверьте введённые значения.',
      403: 'Нет доступа к документу. Запросите права у владельца.',
      404: 'Документ не найден или больше недоступен.',
      409: 'Документ с таким идентификатором уже существует. Обновите список перед повторной попыткой.',
      429: 'Слишком много запросов. Повторите позже.'
    };
    const body = await response.json().catch(() => ({}));
    const codes = { REVISION_CONFLICT: 'Документ изменился. Обновите страницы и повторите действие.', PAGE_IN_USE: 'Страница используется другими объектами. Удалите ссылки на неё и её содержимое перед удалением.', PAGE_NOT_FOUND: 'Страница больше не существует. Обновите страницы.', PARENT_NOT_FOUND: 'Экран или слой больше не существует.', REVISION_UNAVAILABLE: 'Ревизия больше недоступна.', INVALID_PAGE: 'Не удалось сохранить страницу: проверьте имя и ограничения документа.' };
    const error = new Error(codes[body.code] ?? errors[response.status] ?? 'Сервер не смог выполнить запрос. Повторите позже.');
    error.status = response.status; error.code = body.code; throw error;
  }
  return response.json();
}

async function run(action, work, { create = false } = {}) {
  stopLive();
  pending?.abort();
  pending = new AbortController();
  const signal = pending.signal;
  const current = ++generation;
  retry = create ? null : action;
  message(create ? 'Создание документа…' : 'Загрузка…');
  element('content').setAttribute('aria-busy', 'true');
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
      element('content').setAttribute('aria-busy', 'false');
      element('create-form').querySelector('button').disabled = false;
      element('previous').disabled = pageIndex === 0;
      element('next').disabled = !nextCursor;
      startLive();
    }
  }
}

async function loadList(index = 0, cursor = null) {
  if (!token) return;
  stopLive();
  resetLayers();
  resetVersionHistory(); documentId = documentRole = null;
  element('documents-view').hidden = false;
  element('editor-view').hidden = true;
  element('document-list').replaceChildren();
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
      const link = document.createElement('a');
      link.href = `/documents/${encodeURIComponent(item.documentId)}`;
      link.dataset.navigation = '';
      link.textContent = item.name;
      const role = document.createElement('span');
      role.textContent = { Owner: 'Владелец', Editor: 'Редактор', Viewer: 'Просмотр' }[item.role] ?? item.role;
      row.append(link, role);
      element('document-list').append(row);
    }
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
  const list = element('pages'); list.replaceChildren();
  for (const item of pagesItems) {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = item.name;
    button.setAttribute('aria-pressed', String(item.id === selectedPage));
    button.addEventListener('click', () => { if (selectedPage !== item.id) { selectedPage = item.id; selectedScreen = null; screensOffset = 0; resetLayers(); renderPages(); renderCanvas(); refreshPages(); } });
    row.append(button); list.append(row);
  }
  const selected = pagesItems.find(item => item.id === selectedPage);
  element('page-name').value = selected?.name ?? '';
  element('page-rename').querySelector('button').disabled = !selected;
  element('page-name').disabled = !selected;
  element('page-delete').disabled = !selected;
  element('pages-previous').disabled = pagesOffset === 0;
  element('pages-next').disabled = pagesOffset + pagesItems.length >= pagesTotal;
  element('pages-number').textContent = `Страница списка ${Math.floor(pagesOffset / pageSize) + 1}`;
}

function renderScreens() {
  const list = element('screens'); list.replaceChildren();
  for (const item of screensItems) {
    const row = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.textContent = `Экран ${item.id} — ${item.dimensions.width} × ${item.dimensions.height}`;
    button.setAttribute('aria-pressed', String(item.id === selectedScreen));
    button.addEventListener('click', () => { if (selectedScreen !== item.id) { selectedScreen = item.id; refreshPages(); } for (const other of list.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button)); renderCanvas(); });
    row.append(button); list.append(row);
  }
  renderCanvas();
  element('screens-previous').disabled = !selectedPage || screensOffset === 0;
  element('screens-next').disabled = !selectedPage || screensOffset + screensItems.length >= screensTotal;
  element('screens-number').textContent = selectedPage ? `Страница списка ${Math.floor(screensOffset / pageSize) + 1}` : 'Выберите страницу';
  element('screen-create').querySelectorAll('input, button').forEach(control => { control.disabled = !selectedPage; });
}



function resetLayers() {
  layerController?.abort(); layerController = null; layerGeneration++;
  layerSelection = null; layerRoots = []; layerExpanded = new Set(); layerChildren = new Map();
  element('layers').replaceChildren();
  element('layers-status').textContent = 'Выберите экран.';
  element('inspector-selection').textContent = 'Выберите слой.';
}

function selectLayer(item) {
  layerSelection = item;
  element('inspector-selection').textContent = `Слой: ${item.name?.trim() || 'Без имени'} · ${item.kind} · ID: ${item.id}`;
  for (const node of element('layers').querySelectorAll('[role=treeitem]'))
    node.setAttribute('aria-selected', String(node.dataset.id === item.id));
}

function renderLayers(focusId) {
  const tree = element('layers'); tree.replaceChildren();
  function append(items, parent) {
    for (const item of items) {
      const row = document.createElement('div'); row.setAttribute('role', 'treeitem');
      row.dataset.id = item.id; row.tabIndex = -1;
      row.setAttribute('aria-selected', String(layerSelection?.id === item.id));
      if (item.childCount) row.setAttribute('aria-expanded', String(layerExpanded.has(item.id)));
      const label = document.createElement('span'); label.className = 'layer-label';
      label.textContent = `${item.childCount ? (layerExpanded.has(item.id) ? '▾ ' : '▸ ') : '• '}${item.name?.trim() || 'Без имени'} — ${item.kind}`;
      row.append(label);
      label.addEventListener('click', () => { selectLayer(item); row.focus(); if (item.childCount) toggleLayer(item); });
      if (layerExpanded.has(item.id)) {
        const group = document.createElement('div'); group.setAttribute('role', 'group');
        append(layerChildren.get(item.id) || [], group); row.append(group);
      }
      parent.append(row);
    }
  }
  append(layerRoots, tree);
  const rows = [...tree.querySelectorAll('[role=treeitem]')];
  const focused = rows.find(row => row.dataset.id === focusId) || rows.find(row => row.dataset.id === layerSelection?.id) || rows[0];
  if (focused) { focused.tabIndex = 0; if (focusId) focused.focus(); }
}

async function readLayerChildren(parentId, signal, currentRevision) {
  const items = []; let total;
  do {
    const query = new URLSearchParams({ offset: String(items.length), limit: '100', fields: 'name,kind,childCount', revision: String(currentRevision) });
    const result = await request(`/api/v1/documents/${encodeURIComponent(documentId)}/children/${encodeURIComponent(parentId)}?${query}`, {}, signal);
    total = result.total;
    if (!result.items.length && items.length < total) throw new Error('Не удалось загрузить все слои. Обновите страницы.');
    items.push(...result.items);
  } while (items.length < total);
  return items;
}

async function loadLayers() {
  resetLayers();
  if (!selectedScreen) return;
  const current = layerGeneration, screen = selectedScreen, currentRevision = revision;
  layerController = new AbortController();
  element('layers-status').textContent = 'Загрузка слоёв…';
  try {
    const items = await readLayerChildren(screen, layerController.signal, currentRevision);
    if (current !== layerGeneration) return;
    layerRoots = items; renderLayers();
    element('layers-status').textContent = items.length ? 'Стрелки перемещают выбор, Enter выбирает слой.' : 'На экране нет слоёв.';
  } catch (error) { layerFailure(error, current); }
}

function layerFailure(error, current) {
  if (error.name === 'AbortError' || current !== layerGeneration) return;
  resetLayers();
  element('layers-status').textContent = error instanceof TypeError ? 'Не удалось загрузить слои. Проверьте соединение и обновите страницы.' : `${error.message} Обновите страницы.`;
}

function findLayer(id, items = layerRoots) {
  for (const item of items) {
    if (item.id === id) return item;
    const found = findLayer(id, layerChildren.get(item.id) || []);
    if (found) return found;
  }
}

async function toggleLayer(item) {
  if (layerExpanded.has(item.id)) {
    layerExpanded.delete(item.id); renderLayers(item.id); return;
  }
  const current = layerGeneration;
  try {
    if (!layerChildren.has(item.id)) {
      element('layers-status').textContent = 'Загрузка слоёв…';
      const latest = await request(`/api/v1/documents/${encodeURIComponent(documentId)}/pages?limit=1&fields=name`, {}, layerController.signal);
      if (current !== layerGeneration) return;
      if (latest.revision !== revision) { await refreshPages(); return; }
      const items = await readLayerChildren(item.id, layerController.signal, revision);
      if (current !== layerGeneration) return;
      layerChildren.set(item.id, items);
    }
    layerExpanded.add(item.id); renderLayers(item.id);
    element('layers-status').textContent = 'Стрелки перемещают выбор, Enter выбирает слой.';
  } catch (error) { layerFailure(error, current); }
}

element('layers').addEventListener('keydown', event => {
  const row = event.target.closest('[role=treeitem]');
  if (!row) return;
  const rows = [...element('layers').querySelectorAll('[role=treeitem]')], index = rows.indexOf(row);
  let target;
  if (event.key === 'ArrowDown') target = rows[index + 1];
  else if (event.key === 'ArrowUp') target = rows[index - 1];
  else if (event.key === 'Home') target = rows[0];
  else if (event.key === 'End') target = rows.at(-1);
  else if (event.key === 'ArrowLeft') {
    if (row.getAttribute('aria-expanded') === 'true') { layerExpanded.delete(row.dataset.id); renderLayers(row.dataset.id); }
    else target = row.parentElement.closest('[role=treeitem]');
  } else if (event.key === 'ArrowRight') {
    if (row.getAttribute('aria-expanded') === 'false') toggleLayer(findLayer(row.dataset.id));
    else if (row.getAttribute('aria-expanded') === 'true') target = row.querySelector('[role=treeitem]');
  } else if (event.key === 'Enter' || event.key === ' ') {
    const item = findLayer(row.dataset.id); if (item) selectLayer(item);
  } else return;
  event.preventDefault();
  if (target) { row.tabIndex = -1; target.tabIndex = 0; target.focus(); }
});

function paintViewport() {
  const boundary = element('screen-boundary');
  boundary.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
  element('zoom-level').textContent = `${Math.round(viewport.scale * 100)}%`;
  const grid = element('viewport');
  const spacing = 20 * viewport.scale;
  grid.style.backgroundSize = `${spacing}px ${spacing}px`;
  grid.style.backgroundPosition = `${viewport.x}px ${viewport.y}px`;
}

function fitScreen() {
  const screen = screensItems.find(item => item.id === selectedScreen);
  if (!screen) return;
  const area = element('viewport'), { width, height } = screen.dimensions;
  if (!area.clientWidth || !area.clientHeight) return;
  const scale = Math.min(width ? (area.clientWidth - 48) / width : 4, height ? (area.clientHeight - 48) / height : 4, 4);
  viewport.scale = Math.max(0.05, scale);
  viewport.x = (area.clientWidth - width * viewport.scale) / 2;
  viewport.y = (area.clientHeight - height * viewport.scale) / 2;
  paintViewport();
}

function renderCanvas() {
  const screen = screensItems.find(item => item.id === selectedScreen);
  const boundary = element('screen-boundary');
  boundary.hidden = !screen;
  for (const id of ['zoom-out', 'zoom-in', 'fit-screen', 'actual-size']) element(id).disabled = !screen;
  if (!screen) {
    displayedScreen = null;
    element('canvas-selection').textContent = 'Выберите экран, чтобы показать его на холсте.';
    viewport = { scale: 1, x: 0, y: 0 }; paintViewport(); return;
  }
  const { width, height } = screen.dimensions;
  element('canvas-selection').textContent = `Экран: ${width} × ${height} uiUnit`;
  boundary.style.width = `${width}px`; boundary.style.height = `${height}px`;
  if (displayedScreen !== screen.id) { displayedScreen = screen.id; requestAnimationFrame(fitScreen); }
  paintViewport();
}

function zoomAt(scale, x, y) {
  if (!selectedScreen) return;
  const next = Math.max(0.05, Math.min(4, scale));
  const factor = next / viewport.scale;
  viewport.x = x - (x - viewport.x) * factor;
  viewport.y = y - (y - viewport.y) * factor;
  viewport.scale = next; paintViewport();
}
function zoomCenter(scale) {
  const area = element('viewport'); zoomAt(scale, area.clientWidth / 2, area.clientHeight / 2);
}
element('zoom-in').addEventListener('click', () => zoomCenter(viewport.scale * 1.25));
element('zoom-out').addEventListener('click', () => zoomCenter(viewport.scale / 1.25));
element('actual-size').addEventListener('click', () => zoomCenter(1));
element('fit-screen').addEventListener('click', fitScreen);
const canvasArea = element('viewport');
canvasArea.addEventListener('wheel', event => {
  if (!selectedScreen) return;
  event.preventDefault();
  const rect = canvasArea.getBoundingClientRect();
  zoomAt(viewport.scale * Math.exp(-event.deltaY * 0.001), event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });
canvasArea.addEventListener('keydown', event => {
  if (!selectedScreen) return;
  const moves = { ArrowLeft: [30, 0], ArrowRight: [-30, 0], ArrowUp: [0, 30], ArrowDown: [0, -30] };
  if (!moves[event.key]) return;
  event.preventDefault(); viewport.x += moves[event.key][0]; viewport.y += moves[event.key][1]; paintViewport();
});
let drag = null;
canvasArea.addEventListener('pointerdown', event => {
  if (!selectedScreen || event.button !== 0) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY }; canvasArea.setPointerCapture(event.pointerId);
});
canvasArea.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.id) return;
  viewport.x += event.clientX - drag.x; viewport.y += event.clientY - drag.y;
  drag.x = event.clientX; drag.y = event.clientY; paintViewport();
});
function endDrag(event) { if (drag?.id === event.pointerId) drag = null; }
canvasArea.addEventListener('pointerup', endDrag);
canvasArea.addEventListener('pointercancel', endDrag);
canvasArea.addEventListener('lostpointercapture', endDrag);

async function readScreens(signal, offset = screensOffset) {
  if (!selectedPage) { screensItems = []; screensTotal = screensOffset = 0; selectedScreen = null; renderScreens(); return; }
  const query = new URLSearchParams({ offset: String(offset), limit: String(pageSize), fields: 'dimensions', revision: String(revision) });
  const result = await request(`/api/v1/documents/${encodeURIComponent(documentId)}/pages/${encodeURIComponent(selectedPage)}/screens?${query}`, {}, signal);
  if (offset && !result.items.length) return readScreens(signal, Math.max(0, offset - pageSize));
  screensOffset = offset; screensTotal = result.total; screensItems = result.items;
  if (!screensItems.some(item => item.id === selectedScreen)) selectedScreen = null;
  renderScreens();
  await loadLayers();
}

async function readPages(signal, offset = pagesOffset, targetRevision = null) {
  const id = documentId, current = generation;
  const valid = () => !signal.aborted && id === documentId && current === generation;
  const base = `/api/v1/documents/${encodeURIComponent(id)}`;
  const query = new URLSearchParams({ offset: String(offset), limit: String(pageSize), fields: 'name,childCount' });
  if (targetRevision !== null) query.set('revision', String(targetRevision));
  const result = await request(`${base}/pages?${query}`, {}, signal);
  if (!valid()) return;
  if (offset && !result.items.length) return readPages(signal, Math.max(0, offset - pageSize), result.revision);
  const nextRevision = result.revision;
  const page = result.items.some(item => item.id === selectedPage) ? selectedPage : result.items[0]?.id ?? null;
  let screen = page === selectedPage ? selectedScreen : null;
  let screenOffset = page === selectedPage ? screensOffset : 0;
  let screens = { items: [], total: 0 };
  if (page) {
    do {
      screens = await request(`${base}/pages/${encodeURIComponent(page)}/screens?offset=${screenOffset}&limit=${pageSize}&fields=dimensions&revision=${nextRevision}`, {}, signal);
      if (!valid()) return;
      if (!screenOffset || screens.items.length) break;
      screenOffset = Math.max(0, screenOffset - pageSize);
    } while (true);
  }
  if (!screens.items.some(item => item.id === screen)) screen = null;
  const children = new Map(), expanded = new Set(layerExpanded), selection = layerSelection;
  async function readBranch(parent) {
    const items = await readLayerChildren(parent, signal, nextRevision);
    if (!valid()) return [];
    for (const item of items) if (expanded.has(item.id)) children.set(item.id, await readBranch(item.id));
    return items;
  }
  const roots = screen ? await readBranch(screen) : [];
  const header = await request(`${base}?fields=name&revision=${nextRevision}`, {}, signal);
  if (!valid()) return;
  resetLayers();
  pagesOffset = offset; pagesItems = result.items; pagesTotal = result.total; selectedPage = page;
  screensOffset = screenOffset; screensItems = screens.items; screensTotal = screens.total; selectedScreen = screen;
  layerRoots = roots; layerChildren = children; layerExpanded = expanded;
  layerController = new AbortController();
  renderPages(); renderScreens(); renderLayers();
  if (selection) { const item = findLayer(selection.id); if (item) selectLayer(item); }
  element('layers-status').textContent = screen ? (roots.length ? 'Стрелки перемещают выбор, Enter выбирает слой.' : 'На экране нет слоёв.') : 'Выберите экран.';
  const name = header.items[0].name;
  element('document-title').textContent = name; document.title = `${name} — FigVam`;
  revision = nextRevision;
  element('revision').textContent = `Общий черновик · ревизия ${revision}`;
}

async function openDocument(id) {
  stopLive();
  element('documents-view').hidden = true;
  element('editor-view').hidden = true;
  document.title = 'FigVam — открытие документа';
  resetVersionHistory(); documentId = id; documentRole = null; element('version-save').hidden = true; selectedPage = null; selectedScreen = null; screensItems = []; displayedScreen = null; pagesOffset = 0; resetLayers(); renderCanvas();
  await run(() => openDocument(id), async (signal, current) => {
    const result = await request(`/api/v1/documents/${encodeURIComponent(id)}?fields=name`, {}, signal);
    const role = await findRole(id, signal);
    if (!current()) return;
    documentRole = role;
    const name = result.items[0].name;
    element('document-title').textContent = name;
    document.title = `${name} — FigVam`;
    element('page-access').textContent = role === 'Viewer' ? 'Только просмотр страниц.' : role ? 'Управление страницами' : 'Права на редактирование не определены. Обновите страницу.';
    element('page-edit').hidden = !['Owner', 'Editor'].includes(role);
    element('screen-create').hidden = !['Owner', 'Editor'].includes(role);
    element('version-save').hidden = !['Owner', 'Editor'].includes(role);
    renderVersionSave();
    await readPages(signal, 0);
    if (!current()) return;
    element('editor-view').hidden = false;
    renderRestore(); loadVersionHistory();
    if (selectedScreen) requestAnimationFrame(fitScreen);
    message();
  });
}

async function refreshPages(offset = pagesOffset) {
  resetLayers();
  await run(() => refreshPages(offset), async (signal, current) => {
    await readPages(signal, offset);
    if (current()) message('Страницы обновлены.');
  });
}

async function pageCommand(command, data, selection, screenSelection) {
  stopLive();
  if (!['Owner', 'Editor'].includes(documentRole)) return;
  resetLayers();
  pending?.abort(); pending = new AbortController();
  const signal = pending.signal, current = ++generation;
  retry = null; message('Отправка изменений в общий черновик…');
  element('page-edit').inert = true;
  element('screen-create').inert = true;
  try {
    await request(`/api/v1/documents/${encodeURIComponent(documentId)}/commands/${command}`, {
      method: 'POST', body: JSON.stringify({ commandId: crypto.randomUUID(), ...data })
    }, signal);
    if (signal.aborted || current !== generation) return;
    if (selection !== undefined) selectedPage = selection;
    if (screenSelection) { selectedScreen = screenSelection; screensOffset = Math.floor(screensTotal / pageSize) * pageSize; }
    await readPages(signal);
    if (current === generation) message('Изменения подтверждены в общем черновике.');
  } catch (error) {
    if (error.name === 'AbortError' || current !== generation) return;
    const uncertain = error instanceof TypeError || error.status >= 500;
    message('', uncertain ? 'Не удалось подтвердить результат команды. Обновите страницы перед повторным действием: команда могла выполниться.' : error.message);
  } finally {
    if (current === generation) { element('page-edit').inert = false; element('screen-create').inert = false; startLive(); }
  }
}

function renderVersionSave() {
  const operation = versionOperations.get(documentId);
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
  if (!['Owner', 'Editor'].includes(documentRole)) return;
  const id = documentId;
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
  if (versionOperations.get(id) === operation && documentId === id && token) { renderVersionSave(); if (operation.state === 'success') loadVersionHistory(); }
});


function resetVersionHistory() {
  historyController?.abort(); historyController = null; historyGeneration++;
  historyCursors = [null]; historyIndex = 0; historyNext = null;
  element('versions-list').replaceChildren();
  element('versions-status').textContent = ''; element('versions-error').textContent = '';
  element('versions-number').textContent = '';
  element('versions-previous').disabled = true; element('versions-next').disabled = true;
  element('restore-status').textContent = ''; element('restore-error').textContent = '';
  element('restore-retry').hidden = true;
}

async function loadVersionHistory(index = 0, cursor = null) {
  if (!documentId || !token) return;
  historyController?.abort(); historyController = new AbortController();
  const current = ++historyGeneration, id = documentId;
  element('versions-status').textContent = 'Загрузка истории…';
  element('versions-error').textContent = '';
  element('versions-previous').disabled = element('versions-next').disabled = true;
  try {
    const query = new URLSearchParams({ limit: String(pageSize) });
    if (cursor !== null) query.set('beforeRevision', String(cursor));
    const result = await request(`/api/v1/documents/${encodeURIComponent(id)}/versions?${query}`, {}, historyController.signal);
    if (current !== historyGeneration || documentId !== id) return;
    historyIndex = index; historyCursors[index] = cursor; historyCursors.length = index + 1; historyNext = result.nextBeforeRevision;
    const list = element('versions-list'); list.replaceChildren();
    for (const version of result.versions) {
      const row = document.createElement('li'), description = document.createElement('span');
      const date = new Date(version.timestamp);
      description.textContent = `${version.name?.trim() || 'Без имени'} · Автор: ${version.authorId} · ${Number.isNaN(date.valueOf()) ? version.timestamp : date.toLocaleString()} · Ревизия ${version.revision}`;
      row.append(description);
      if (['Owner', 'Editor'].includes(documentRole)) {
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
    if (error.name === 'AbortError' || current !== historyGeneration || documentId !== id) return;
    element('versions-list').replaceChildren(); element('versions-status').textContent = '';
    element('versions-error').textContent = error instanceof TypeError ? 'Не удалось загрузить историю. Проверьте соединение и обновите историю.' : error.message;
  }
}

function renderRestore() {
  const operation = restoreOperations.get(documentId);
  element('restore-status').textContent = operation?.state === 'pending' ? 'Восстановление версии…' : operation?.state === 'success' ? 'Версия восстановлена в общий черновик.' : '';
  element('restore-error').textContent = operation?.error ?? '';
  element('restore-retry').hidden = operation?.state !== 'uncertain';
  for (const button of element('versions-list').querySelectorAll('button')) button.disabled = ['pending', 'uncertain'].includes(operation?.state);
}
function beginRestore(version) {
  if (!['Owner', 'Editor'].includes(documentRole) || ['pending', 'uncertain'].includes(restoreOperations.get(documentId)?.state)) return;
  if (!confirm(`Восстановить версию «${version.name?.trim() || 'Без имени'}» (ревизия ${version.revision})? Будет создана новая ревизия общего черновика; история сохранённых версий не удалится.`)) return;
  const operation = { versionId: version.id, commandId: crypto.randomUUID() };
  restoreOperations.set(documentId, operation); submitRestore(documentId, operation);
}
async function submitRestore(id, operation) {
  operation.state = 'pending'; operation.error = ''; if (documentId === id) renderRestore();
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
  if (restoreOperations.get(id) !== operation || documentId !== id || !token) return;
  renderRestore();
  if (operation.state === 'success' && !element('editor-view').hidden) { await refreshPages(); if (documentId === id && !element('editor-view').hidden) loadVersionHistory(); }
}
element('versions-refresh').addEventListener('click', () => loadVersionHistory());
element('versions-previous').addEventListener('click', () => loadVersionHistory(historyIndex - 1, historyCursors[historyIndex - 1]));
element('versions-next').addEventListener('click', () => loadVersionHistory(historyIndex + 1, historyNext));
element('restore-retry').addEventListener('click', () => {
  const operation = restoreOperations.get(documentId);
  if (operation?.state === 'uncertain' && ['Owner', 'Editor'].includes(documentRole)) submitRestore(documentId, operation);
});

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
  token = supplied;
  element('token').value = '';
  element('authentication').hidden = true;
  element('disconnect').hidden = false;
  element('content').hidden = false;
  route();
  element('content').focus();
});
element('disconnect').addEventListener('click', () => { clearSession(); element('token').focus(); });
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
element('screens-previous').addEventListener('click', () => refreshScreens(Math.max(0, screensOffset - pageSize)));
element('screens-next').addEventListener('click', () => refreshScreens(screensOffset + pageSize));
async function refreshScreens(offset) {
  resetLayers();
  await run(() => refreshScreens(offset), async (signal, current) => {
    screensOffset = offset; await readPages(signal); if (current()) message('Экраны обновлены.');
  });
}
element('screen-create').addEventListener('submit', event => {
  event.preventDefault();
  const width = element('screen-width').valueAsNumber, height = element('screen-height').valueAsNumber;
  if (!Number.isFinite(width) || width < 0 || !Number.isFinite(height) || height < 0) { message('', 'Укажите конечные неотрицательные ширину и высоту.'); return; }
  if (!selectedPage) return;
  const screenId = crypto.randomUUID();
  pageCommand('add-screen', { pageId: selectedPage, screenId, dimensions: { width, height } }, undefined, screenId);
});
element('page-refresh').addEventListener('click', () => refreshPages());
element('pages-previous').addEventListener('click', () => refreshPages(Math.max(0, pagesOffset - pageSize)));
element('pages-next').addEventListener('click', () => refreshPages(pagesOffset + pageSize));
element('page-create').addEventListener('click', () => {
  const pageId = crypto.randomUUID();
  pagesOffset = Math.floor(pagesTotal / pageSize) * pageSize;
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
clearSession();

