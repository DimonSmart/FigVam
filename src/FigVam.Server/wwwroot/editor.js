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
const historyActions = new Map();
let navigationEpoch = 0;
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
let memberController = null;
function resetMembers() {
  memberController?.abort(); memberController = null;
  element('member-management').hidden = true;
  element('member-form').reset();
  element('member-form').querySelectorAll('button, input, select').forEach(control => control.disabled = false);
  element('member-status').textContent = element('member-error').textContent = '';
}
let exportController = null;
let historyGeneration = 0, historyController = null, historyCursors = [null], historyIndex = 0, historyNext = null;
let selectedScreen = null, screensOffset = 0, screensTotal = 0, screensItems = [];
const scenarioOperations = new Map();
const scenarioKey = (doc, screen) => `${doc}/${screen}`;
let scenariosController = null, scenariosGeneration = 0, scenariosOffset = 0, scenariosTotal = 0, scenariosKey = null;
let scenarioCapabilities = null, capabilityGeneration = 0;
function clearScenarioCapabilities(message) {
  capabilityGeneration++; scenarioCapabilities = null;
  element('scenario-event').replaceChildren(); element('scenario-action').replaceChildren();
  element('scenario-capabilities-status').textContent = message;
}
async function loadScenarioCapabilities() {
  const previousAction = element('scenario-action').value, previousEvent = element('scenario-event').value;
  clearScenarioCapabilities('Возможности сценария недоступны.');
  if (!documentId || !selectedScreen || !layerSelection || !element('scenario-variant').options.length || !Number.isSafeInteger(revision)) { renderScenarioCreate(); return; }
  const current = capabilityGeneration, doc = documentId, screen = selectedScreen, node = layerSelection.id, atRevision = revision, target = element('scenario-target').value, variant = element('scenario-variant').value, requestToken = token, epoch = navigationEpoch;
  const valid = () => current === capabilityGeneration && doc === documentId && screen === selectedScreen && node === layerSelection?.id && atRevision === revision && target === element('scenario-target').value && variant === element('scenario-variant').value && requestToken === token && epoch === navigationEpoch && !element('editor-view').hidden;
  element('scenario-capabilities-status').textContent = 'Загрузка возможностей сценария…'; renderScenarioCreate();
  try {
    const q = new URLSearchParams({ revision: String(atRevision), nodeId: node, screenId: screen }); if (variant) q.set('variantId', variant); if (target) q.set('targetId', target);
    const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/scenario-capabilities?${q}`);
    if (!valid()) return;
    const labels = { showVariant: 'ShowVariant', navigate: 'Navigate', openOverlay: 'OpenOverlay', closeOverlay: 'CloseOverlay', resetPreview: 'ResetPreview' }, events = ['Click', 'Change', 'Hover', 'Leave'];
    if (result.documentId?.toLowerCase() !== doc.toLowerCase() || result.revision !== atRevision || result.nodeId?.toLowerCase() !== node.toLowerCase() || (result.targetId || '') !== target || (result.screenId || '') !== screen || (result.variantId || '') !== variant || typeof result.profile?.id !== 'string' || !result.profile.id || !Number.isInteger(result.profile.version) || result.profile.version < 1 || !Array.isArray(result.events) || !Array.isArray(result.actions) || result.events.some(e => !Number.isInteger(e) || !events[e]) || result.actions.some(a => !Object.hasOwn(labels, a)) || new Set(result.events).size !== result.events.length || new Set(result.actions).size !== result.actions.length) throw new TypeError('Некорректный ответ');
    for (const value of result.events) { const option = document.createElement('option'); option.value = String(value); option.textContent = events[value]; element('scenario-event').append(option); }
    for (const value of result.actions) { const option = document.createElement('option'); option.value = value; option.textContent = labels[value]; element('scenario-action').append(option); }
    if (result.actions.includes(previousAction)) element('scenario-action').value = previousAction;
    if (result.events.includes(Number(previousEvent)) && previousEvent !== '') element('scenario-event').value = previousEvent;
    scenarioCapabilities = result;
    element('scenario-capabilities-status').textContent = result.events.length && result.actions.length ? '' : 'Нет доступных событий или действий для сценария в текущем профиле.';
  } catch (error) { if (!valid()) return; element('scenario-capabilities-status').textContent = 'Не удалось загрузить возможности сценария.'; }
  if (valid()) renderScenarioCreate();
}
function resetScenarios() {
  scenariosController?.abort(); scenariosController = null; scenariosGeneration++;
  clearScenarioCapabilities('Возможности сценария недоступны.');
  scenariosOffset = scenariosTotal = 0; scenariosKey = null;
  element('scenarios-list').replaceChildren(); element('scenarios-status').textContent = 'Выберите экран.';
  element('scenarios-error').textContent = ''; element('scenarios-retry').hidden = true;
  element('scenario-command-status').textContent = ''; element('scenario-command-error').textContent = ''; element('scenario-command-retry').hidden = true;
  element('scenarios-number').textContent = '';
  element('scenarios-previous').disabled = element('scenarios-next').disabled = true;
  element('scenario-create').hidden = true; element('scenario-target').replaceChildren(); element('scenario-variant').replaceChildren();
}
function scenarioActionText(action) {
  const value = v => v === null ? 'не задано' : String(v);
  switch (action.type) {
    case 'navigate': return `Navigate · Экран: ${value(action.screenId)}`;
    case 'showVariant': return `ShowVariant · Вариант: ${value(action.variantId)}`;
    case 'setDemoValue': return `SetDemoValue · Узел: ${value(action.nodeId)} · Значение: ${value(action.value)}`;
    case 'selectDataset': return `SelectDataset · Датасет: ${value(action.datasetId)}`;
    case 'openOverlay': return `OpenOverlay · Экран: ${value(action.screenId)}`;
    case 'closeOverlay': return 'CloseOverlay';
    case 'resetPreview': return 'ResetPreview';
    default: throw new TypeError('Некорректное действие');
  }
}
async function loadScenarios() {
  scenariosController?.abort();
  const controller = new AbortController(), current = ++scenariosGeneration;
  scenariosController = controller;
  const doc = documentId, screen = selectedScreen, atRevision = revision, requestToken = token, epoch = navigationEpoch, offset = scenariosOffset;
  if (!doc || !screen || !Number.isSafeInteger(atRevision)) { resetScenarios(); return; }
  scenariosKey = `${doc}:${screen}:${atRevision}`;
  const valid = () => !controller.signal.aborted && current === scenariosGeneration && doc === documentId && screen === selectedScreen && atRevision === revision && token === requestToken && epoch === navigationEpoch && !element('editor-view').hidden;
  element('scenarios-list').replaceChildren(); element('scenarios-error').textContent = '';
  element('scenarios-retry').hidden = true; element('scenarios-number').textContent = '';
  element('scenarios-previous').disabled = element('scenarios-next').disabled = true;
  element('scenarios-status').textContent = 'Загрузка сценариев…';
  element('scenario-variant').replaceChildren();
  loadScenarioTargets(doc, screen, atRevision, valid);
  loadScenarioVariants(doc, screen, atRevision, valid);
  try {
    const query = new URLSearchParams({ screenId: screen, revision: String(atRevision), offset: String(offset), limit: String(pageSize) });
    const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/scenarios?${query}`, {}, controller.signal);
    if (!valid()) return;
    if (result.documentId?.toLowerCase() !== doc.toLowerCase() || result.revision !== atRevision || result.offset !== offset || result.limit !== pageSize || !Number.isInteger(result.total) || result.total < 0 || !Array.isArray(result.items)) throw new TypeError('Некорректный ответ');
    if (offset && !result.items.length) { scenariosOffset = Math.max(0, offset - pageSize); return loadScenarios(); }
    const fragment = document.createDocumentFragment(), events = ['Click', 'Change', 'Hover', 'Leave'];
    for (const scenario of result.items) {
      if (scenario.screenId?.toLowerCase() !== screen.toLowerCase() || typeof scenario.id !== 'string' || typeof scenario.nodeId !== 'string' || !events[scenario.event] || !Array.isArray(scenario.actions)) throw new TypeError('Некорректный сценарий');
      const li = document.createElement('li'), title = document.createElement('p'), actions = document.createElement('ol');
      title.textContent = `Сценарий: ${scenario.id} · Исходный узел: ${scenario.nodeId} · Событие: ${events[scenario.event]}`;
      actions.setAttribute('aria-label', 'Действия по порядку');
      for (const action of scenario.actions) { const item = document.createElement('li'); item.textContent = scenarioActionText(action); actions.append(item); }
      li.append(title, actions);
      if (['Owner', 'Editor'].includes(documentRole)) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = `Удалить сценарий ${scenario.id}`;
        button.disabled = scenarioOperations.has(scenarioKey(doc, screen));
        button.addEventListener('click', () => beginScenarioDeletion(doc, screen, scenario.id)); li.append(button);
      }
      fragment.append(li);
    }
    scenariosTotal = result.total; element('scenarios-list').append(fragment); renderScenarioCommand();
    element('scenarios-status').textContent = result.total ? 'Сценарии выбранного экрана.' : 'Сценариев для выбранного экрана нет.';
    element('scenarios-number').textContent = result.total ? `${offset + 1}–${offset + result.items.length} из ${result.total}` : '';
    element('scenarios-previous').disabled = offset === 0;
    element('scenarios-next').disabled = offset + result.items.length >= result.total || !result.items.length;
  } catch (error) {
    if (!valid()) return;
    element('scenarios-status').textContent = 'Не удалось загрузить сценарии.';
    element('scenarios-error').textContent = error instanceof TypeError ? 'Не удалось получить корректный ответ сервера.' : error.message;
    element('scenarios-retry').hidden = false;
  }
}

function renderScenarioCommand() {
  const op = scenarioOperations.get(scenarioKey(documentId, selectedScreen));
  const editable = ['Owner', 'Editor'].includes(documentRole);
  renderScenarioCreate();
  element('scenarios-list').querySelectorAll('button').forEach(button => button.disabled = !!op);
  element('scenario-command-status').textContent = op?.state === 'pending' ? (op.kind === 'create' ? 'Создание сценария…' : `Удаление сценария «${op.body.scenarioId}»…`) : '';
  element('scenario-command-error').textContent = op?.state === 'uncertain' ? (op.kind === 'create' ? 'Результат создания неизвестен. Повторите ту же команду: сценарий мог быть создан.' : 'Результат удаления неизвестен. Повторите ту же команду: сценарий мог быть удалён.') : '';
  element('scenario-command-retry').textContent = op?.kind === 'create' ? 'Повторить создание сценария' : 'Повторить удаление сценария';
  element('scenario-command-retry').hidden = !editable || op?.state !== 'uncertain';
}
function beginScenarioDeletion(doc, screen, scenarioId) {
  const key = scenarioKey(doc, screen);
  if (doc !== documentId || screen !== selectedScreen || !['Owner', 'Editor'].includes(documentRole) || scenarioOperations.has(key) || !Number.isSafeInteger(revision)) return;
  if (!confirm(`Удалить сценарий «${scenarioId}»?`)) return;
  const op = { body: { commandId: crypto.randomUUID(), scenarioId, expectedRevision: revision }, state: 'ready' };
  scenarioOperations.set(key, op); sendScenarioDeletion(doc, screen, op);
}
async function sendScenarioDeletion(doc, screen, op) {
  const key = scenarioKey(doc, screen), epoch = navigationEpoch, requestToken = token, context = scenariosGeneration;
  if (op.state === 'pending' || !['Owner', 'Editor'].includes(documentRole)) return;
  const active = () => doc === documentId && screen === selectedScreen && token === requestToken && epoch === navigationEpoch && context === scenariosGeneration && !element('editor-view').hidden;
  op.state = 'pending'; if (active()) renderScenarioCommand();
  try {
    const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/commands/delete-scenario`, { method: 'POST', body: JSON.stringify(op.body) });
    if (result.code !== 'ACCEPTED' || !Number.isSafeInteger(result.revision) || result.revision <= op.body.expectedRevision || result.documentId?.toLowerCase() !== doc.toLowerCase() || result.commandId?.toLowerCase() !== op.body.commandId.toLowerCase()) throw new TypeError('Некорректное подтверждение');
    if (scenarioOperations.get(key) !== op) return;
    if (!active()) { op.state = 'uncertain'; return; }
    scenarioOperations.delete(key);
    const target = Math.max(revision, result.revision);
    await run(() => refreshPages(), signal => readPages(signal, pagesOffset, target));
    if (doc === documentId && screen === selectedScreen && token === requestToken && epoch === navigationEpoch && !element('editor-view').hidden) element('scenario-command-status').textContent = 'Удаление сценария подтверждено.';
  } catch (error) {
    if (scenarioOperations.get(key) !== op) return;
    if (!active() || !error.status || error.status >= 500) op.state = 'uncertain';
    else {
      scenarioOperations.delete(key);
      renderScenarioCommand();
      element('scenario-command-error').textContent = error.code === 'REVISION_CONFLICT' ? 'Документ изменился. Обновите страницы и повторите удаление.' : error.status === 403 || error.status === 404 && error.code === 'DOCUMENT_NOT_FOUND' ? 'Доступ к документу утрачен или недостаточен.' : `Удаление отклонено: ${error.message}`;
    }
  } finally { if (doc === documentId && screen === selectedScreen && token === requestToken && !element('editor-view').hidden && scenarioOperations.get(key) === op) renderScenarioCommand(); }
}
element('scenario-command-retry').addEventListener('click', () => { const op = scenarioOperations.get(scenarioKey(documentId, selectedScreen)); if (op?.state === 'uncertain') (op.kind === 'create' ? sendScenarioCreation : sendScenarioDeletion)(documentId, selectedScreen, op); });

function renderScenarioCreate() {
  const editable = !!selectedScreen && ['Owner', 'Editor'].includes(documentRole);
  const op = scenarioOperations.get(scenarioKey(documentId, selectedScreen));
  const needsTarget = ['navigate', 'openOverlay'].includes(element('scenario-action').value);
  element('scenario-create').hidden = !editable;
  element('scenario-source').textContent = layerSelection ? `Исходный слой: ${layerSelection.name?.trim() || 'Без имени'} — ${layerSelection.kind}` : (layerRoots.length ? 'Выберите исходный слой в дереве.' : 'На экране нет слоёв для сценария.');
  element('scenario-target-fields').hidden = !needsTarget;
  element('scenario-create-submit').disabled = !editable || !!op || !layerSelection || !scenarioCapabilities || !element('scenario-event').value || !element('scenario-action').value || (needsTarget && !element('scenario-target').value);
  element('scenario-event').disabled = element('scenario-action').disabled = element('scenario-target').disabled = element('scenario-variant').disabled = !!op;
}
element('scenario-action').addEventListener('change', renderScenarioCreate);
element('scenario-target').addEventListener('change', loadScenarioCapabilities);
element('scenario-variant').addEventListener('change', loadScenarioCapabilities);
async function loadScenarioVariants(doc, screen, atRevision, valid) {
  const select = element('scenario-variant'); select.replaceChildren();
  element('scenario-variant-status').textContent = 'Загрузка вариантов…';
  try {
    const items = []; let total;
    do {
      const q = new URLSearchParams({ revision: String(atRevision), offset: String(items.length), limit: '100' });
      const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/screens/${encodeURIComponent(screen)}/variants?${q}`);
      if (!valid()) return;
      if (result.documentId?.toLowerCase() !== doc.toLowerCase() || result.screenId?.toLowerCase() !== screen.toLowerCase() || result.revision !== atRevision || !Array.isArray(result.items) || !Number.isInteger(result.total) || result.total < 0 || (!result.items.length && items.length < result.total) || result.items.some(item => typeof item.id !== 'string' || typeof item.name !== 'string')) throw new TypeError('Некорректный ответ');
      items.push(...result.items); total = result.total;
    } while (items.length < total);
    select.add(new Option('Базовое состояние', ''));
    for (const item of items) select.add(new Option(item.name, item.id));
    element('scenario-variant-status').textContent = '';
  } catch (error) { if (!valid()) return; element('scenario-variant-status').textContent = 'Не удалось загрузить варианты экрана.'; }
  if (valid()) loadScenarioCapabilities();
}
async function loadScenarioTargets(doc, screen, atRevision, valid) {
  clearScenarioCapabilities('Загрузка возможностей сценария…');
  const target = element('scenario-target'); target.replaceChildren();
  element('scenario-target-status').textContent = 'Загрузка экранов…'; renderScenarioCreate();
  try {
    const base = `/api/v1/documents/${encodeURIComponent(doc)}`;
    async function all(path) {
      const items = []; let total;
      do {
        const query = new URLSearchParams({ offset: String(items.length), limit: '100', revision: String(atRevision), fields: 'name' });
        const result = await request(`${base}/${path}?${query}`);
        if (!valid()) return [];
        if (!Array.isArray(result.items) || !Number.isInteger(result.total) || (!result.items.length && items.length < result.total)) throw new TypeError('Некорректный ответ');
        items.push(...result.items); total = result.total;
      } while (items.length < total);
      return items;
    }
    const pages = await all('pages'), screens = [];
    for (const page of pages) screens.push(...await all(`pages/${encodeURIComponent(page.id)}/screens`));
    if (!valid()) return;
    for (const item of screens) {
      const option = document.createElement('option'); option.value = item.id; option.textContent = item.name?.trim() || `Экран ${item.id}`; target.append(option);
    }
    element('scenario-target-status').textContent = screens.length ? '' : 'Нет доступных экранов.';
  } catch (error) {
    if (!valid()) return;
    element('scenario-target-status').textContent = `Не удалось загрузить экраны: ${error.message}`;
  }
  if (valid()) { renderScenarioCreate(); loadScenarioCapabilities(); }
}
element('scenario-create').addEventListener('submit', event => {
  event.preventDefault();
  const doc = documentId, screen = selectedScreen, key = scenarioKey(doc, screen), target = element('scenario-target').value, source = layerSelection?.id, eventValue = Number(element('scenario-event').value), actionType = element('scenario-action').value;
  const needsTarget = ['navigate', 'openOverlay'].includes(actionType);
  if (!['Owner', 'Editor'].includes(documentRole) || !screen || !source || !scenarioCapabilities || !scenarioCapabilities.actions.includes(actionType) || scenarioCapabilities.screenId !== screen || (scenarioCapabilities.variantId || '') !== element('scenario-variant').value || (scenarioCapabilities.targetId || '') !== target || (needsTarget && !target) || !scenarioCapabilities.events.includes(eventValue) || scenarioOperations.has(key) || !Number.isSafeInteger(revision)) return;
  const action = needsTarget ? { type: actionType, screenId: target } : actionType === 'showVariant' ? { type: actionType, variantId: element('scenario-variant').value || null } : { type: actionType };
  const op = { kind: 'create', body: { commandId: crypto.randomUUID(), scenario: { id: crypto.randomUUID(), screenId: screen, nodeId: source, event: eventValue, actions: [action] } }, state: 'ready', revision };
  scenarioOperations.set(key, op); sendScenarioCreation(doc, screen, op);
});
async function sendScenarioCreation(doc, screen, op) {
  const key = scenarioKey(doc, screen), epoch = navigationEpoch, requestToken = token, context = scenariosGeneration;
  if (op.state === 'pending' || !['Owner', 'Editor'].includes(documentRole)) return;
  const active = () => doc === documentId && screen === selectedScreen && token === requestToken && epoch === navigationEpoch && context === scenariosGeneration && !element('editor-view').hidden;
  op.state = 'pending'; if (active()) renderScenarioCommand();
  try {
    const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/commands/create-scenario`, { method: 'POST', body: JSON.stringify(op.body) });
    if (result.code !== 'ACCEPTED' || !Number.isSafeInteger(result.revision) || result.revision <= op.revision || result.documentId?.toLowerCase() !== doc.toLowerCase() || result.commandId?.toLowerCase() !== op.body.commandId.toLowerCase()) throw new TypeError('Некорректное подтверждение');
    if (scenarioOperations.get(key) !== op) return;
    if (!active()) { op.state = 'uncertain'; return; }
    scenarioOperations.delete(key);
    await run(() => refreshPages(), signal => readPages(signal, pagesOffset, Math.max(revision, result.revision)));
    if (doc === documentId && screen === selectedScreen && token === requestToken && epoch === navigationEpoch && !element('editor-view').hidden) element('scenario-command-status').textContent = 'Создание сценария подтверждено.';
  } catch (error) {
    if (scenarioOperations.get(key) !== op) return;
    if (!active() || !error.status || error.status >= 500) op.state = 'uncertain';
    else {
      scenarioOperations.delete(key); renderScenarioCommand();
      element('scenario-command-error').textContent = error.status === 403 || error.status === 404 && error.code === 'DOCUMENT_NOT_FOUND' ? 'Доступ к документу утрачен или недостаточен.' : `Создание отклонено: ${error.message}`;
    }
  } finally { if (doc === documentId && screen === selectedScreen && token === requestToken && !element('editor-view').hidden && scenarioOperations.get(key) === op) renderScenarioCommand(); }
}

element('scenarios-retry').addEventListener('click', loadScenarios);
element('scenarios-previous').addEventListener('click', () => { scenariosOffset = Math.max(0, scenariosOffset - pageSize); loadScenarios(); });
element('scenarios-next').addEventListener('click', () => { if (scenariosOffset + pageSize < scenariosTotal) { scenariosOffset += pageSize; loadScenarios(); } });
let diagnosticsController = null, diagnosticsGeneration = 0, diagnosticsOffset = 0, diagnosticsTotal = 0, diagnosticsKey = null;
function resetDiagnostics() {
  diagnosticsController?.abort(); diagnosticsController = null; diagnosticsGeneration++;
  diagnosticsOffset = diagnosticsTotal = 0; diagnosticsKey = null;
  element('diagnostics-list').replaceChildren(); element('diagnostics-status').textContent = 'Выберите экран.';
  element('diagnostics-error').textContent = ''; element('diagnostics-retry').hidden = true;
  element('diagnostics-number').textContent = '';
  element('diagnostics-previous').disabled = element('diagnostics-next').disabled = true;
}
async function loadDiagnostics() {
  diagnosticsController?.abort();
  const controller = new AbortController(), current = ++diagnosticsGeneration;
  diagnosticsController = controller;
  const doc = documentId, screen = selectedScreen, atRevision = revision, requestToken = token, epoch = navigationEpoch, offset = diagnosticsOffset;
  if (!doc || !screen || !Number.isSafeInteger(atRevision)) { resetDiagnostics(); return; }
  diagnosticsKey = `${doc}:${screen}:${atRevision}`;
  const valid = () => !controller.signal.aborted && current === diagnosticsGeneration && doc === documentId && screen === selectedScreen && atRevision === revision && token === requestToken && epoch === navigationEpoch && !element('editor-view').hidden;
  element('diagnostics-list').replaceChildren(); element('diagnostics-error').textContent = '';
  element('diagnostics-retry').hidden = true; element('diagnostics-number').textContent = '';
  element('diagnostics-previous').disabled = element('diagnostics-next').disabled = true;
  element('diagnostics-status').textContent = 'Загрузка диагностики…';
  try {
    const query = new URLSearchParams({ screenId: screen, revision: String(atRevision), offset: String(offset), limit: String(pageSize) });
    const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/diagnostics?${query}`, {}, controller.signal);
    if (!valid()) return;
    if (result.documentId?.toLowerCase() !== doc.toLowerCase() || result.screenId?.toLowerCase() !== screen.toLowerCase() || result.revision !== atRevision || result.offset !== offset || result.limit !== pageSize || !Number.isInteger(result.total) || result.total < 0 || !Array.isArray(result.items)) throw new TypeError('Некорректный ответ');
    diagnosticsTotal = result.total;
    for (const item of result.items) {
      const li = document.createElement('li');
      li.textContent = [item.code, item.path, item.message, item.referenceId ? `ID ссылки: ${item.referenceId}` : null, item.property ? `Свойство: ${item.property}` : null].filter(Boolean).join(' — ');
      element('diagnostics-list').append(li);
    }
    element('diagnostics-status').textContent = result.total ? 'Диагностика выбранного экрана.' : 'Диагностик для выбранного экрана нет.';
    element('diagnostics-number').textContent = result.total ? `${offset + 1}–${offset + result.items.length} из ${result.total}` : '';
    element('diagnostics-previous').disabled = offset === 0;
    element('diagnostics-next').disabled = offset + result.items.length >= result.total || !result.items.length;
  } catch (error) {
    if (!valid() || error.name === 'AbortError') return;
    element('diagnostics-status').textContent = 'Не удалось загрузить диагностику.';
    element('diagnostics-error').textContent = error instanceof TypeError ? 'Не удалось получить корректный ответ сервера.' : error.message;
    element('diagnostics-retry').hidden = false;
  }
}
element('diagnostics-retry').addEventListener('click', loadDiagnostics);
element('diagnostics-previous').addEventListener('click', () => { diagnosticsOffset = Math.max(0, diagnosticsOffset - pageSize); loadDiagnostics(); });
element('diagnostics-next').addEventListener('click', () => { if (diagnosticsOffset + pageSize < diagnosticsTotal) { diagnosticsOffset += pageSize; loadDiagnostics(); } });
const resizeOperations = new Map();
let resizeDraftScreen = null, resizeDirty = false, resizeError = null;
let viewport = { scale: 1, x: 0, y: 0 };
let displayedScreen = null;
let layerController = null, layerGeneration = 0, layerSelection = null;
let layerRoots = [], layerExpanded = new Set(), layerChildren = new Map();

let tokenItems = [], selectedToken = null, tokenUsages = [], tokenLoad = 0;
let componentGeneration = 0, componentSelection = null, componentOffset = 0, usageOffset = 0;
let componentTotal = 0, usageTotal = 0, componentSearch = '';
let variantGeneration = 0, variantOffset = 0, variantTotal = 0, variantScreen = null;
const variantOperations = new Map();
let datasetGeneration = 0, datasetOffset = 0, datasetTotal = 0, datasetSelection = null;
const datasetOperations = new Map();
let presenceController = null, presenceTimer = null, presenceParticipants = [], presenceCursor = null, presenceCursorScreen = null, presenceLastRead = 0;
function stopPresence() {
  presenceController?.abort(); presenceController = null; clearTimeout(presenceTimer); presenceTimer = null;
  presenceParticipants = []; presenceCursor = presenceCursorScreen = null; presenceLastRead = 0;
  element('presence-list').replaceChildren(); element('presence-markers').replaceChildren(); element('presence-status').textContent = '';
}
function renderPresence() {
  const list = element('presence-list'), markers = element('presence-markers');
  list.replaceChildren(); markers.replaceChildren();
  for (const participant of presenceParticipants) {
    const li = document.createElement('li');
    const cursor = participant.cursor ? `курсор: ${participant.cursor.x}, ${participant.cursor.y}` : 'курсор недоступен';
    li.textContent = `${participant.name} · цвет ${participant.color} · экран: ${participant.screenId || 'не выбран'} · выбранные ID: ${participant.selectedIds.length ? participant.selectedIds.join(', ') : 'нет'} · ${cursor}`;
    list.append(li);
    if (participant.screenId === selectedScreen && participant.cursor && selectedScreen) {
      const x = viewport.x + participant.cursor.x * viewport.scale, y = viewport.y + participant.cursor.y * viewport.scale;
      const area = element('viewport');
      if (x >= 0 && y >= 0 && x < area.clientWidth && y < area.clientHeight) {
        const marker = document.createElement('span'); marker.className = 'presence-marker'; marker.textContent = `◆ ${participant.name}`;
        marker.style.left = `${x}px`; marker.style.top = `${y}px`; marker.style.borderColor = participant.color; markers.append(marker);
      }
    }
  }
}
function startPresence() {
  if (presenceController || !token || !documentId || element('editor-view').hidden) return;
  const controller = new AbortController(), doc = documentId, requestToken = token, epoch = navigationEpoch;
  presenceController = controller;
  const active = () => presenceController === controller && !controller.signal.aborted && doc === documentId && token === requestToken && epoch === navigationEpoch && !element('editor-view').hidden;
  const path = `/api/v1/documents/${encodeURIComponent(doc)}/presence`;
  async function exchange(method, body) {
    const response = await fetch(path, { method, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]), cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { Authorization: `Bearer ${requestToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!active()) throw new DOMException('Cancelled', 'AbortError');
    if (!response.ok) { const error = new Error('Presence unavailable'); error.status = response.status; throw error; }
    return response.json();
  }
  async function cycle() {
    if (!active()) return;
    try {
      const name = element('presence-name').value.trim().slice(0, 128) || 'Участник';
      const body = { name, color: element('presence-color').value, cursor: presenceCursorScreen === selectedScreen ? presenceCursor : null, selectedIds: layerSelection ? [layerSelection.id] : [], screenId: selectedScreen };
      await exchange('PUT', body);
      const result = await exchange('GET');
      if (!active()) return;
      if (result.code !== 'PRESENCE' || !Array.isArray(result.participants) || result.participants.some(p => typeof p.name !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(p.color) || !Array.isArray(p.selectedIds) || (p.cursor && (!Number.isFinite(p.cursor.x) || !Number.isFinite(p.cursor.y))))) throw new Error('Invalid presence');
      presenceParticipants = result.participants; presenceLastRead = Date.now(); renderPresence();
      element('presence-status').textContent = presenceParticipants.length ? 'Присутствующие участники обновлены.' : 'Сейчас участников нет.';
    } catch (error) {
      if (!active() || error.name === 'AbortError') return;
      if ([401, 403, 404].includes(error.status)) { presenceParticipants = []; renderPresence(); element('presence-status').textContent = 'Присутствие недоступно: доступ к документу потерян.'; return; }
      if (Date.now() - presenceLastRead >= 60000) { presenceParticipants = []; renderPresence(); }
      element('presence-status').textContent = 'Не удалось обновить присутствие. Повторная попытка автоматически.';
    }
    if (active()) presenceTimer = setTimeout(cycle, 10000);
  }
  element('presence-status').textContent = 'Загрузка участников…'; cycle();
}
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
  function denied(status) {
    if (!active()) return;
    pending?.abort(); generation++; resetDiagnostics(); resetScenarios(); resetLayers(); resetVersionHistory();
    resetMembers(); resetExport(); documentRole = null; revision = null; pagesItems = []; screensItems = []; selectedPage = selectedScreen = null;
    element('page-edit').inert = element('screen-create').inert = false;
    element('revision').textContent = ''; element('document-title').textContent = '';
    document.title = 'FigVam — доступ потерян';
    renderPages(); renderScreens(); element('editor-view').hidden = true;
    stopPresence(); stopLive(); message('', status === 404 ? 'Документ удалён или больше недоступен.' : 'Доступ к документу потерян. Запросите права у владельца и откройте документ снова.');
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
      if (recovery.revision < revision) throw new Error('Устаревший ответ восстановления');
      // Render the recovered revision through the same bounded, revision-pinned queries as initial loading.
      if (recovery.revision > revision) await readPages(signal, pagesOffset, recovery.revision);
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
      if ([403, 404].includes(error.status)) { denied(error.status); return; }
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
  importOperation = null;
  element('import-form').reset();
  element('import-form').querySelector('button').disabled = false;
  element('import-status').textContent = element('import-error').textContent = '';
  element('import-diagnostics').replaceChildren();
  resetDeletion();
  stopPresence(); navigationEpoch++; resetDiagnostics(); resetScenarios(); resetMembers(); resetExport(); historyActions.clear(); scenarioOperations.clear();
  stopLive();
  token = '';
  versionOperations.clear(); restoreOperations.clear(); resizeOperations.clear(); resizeDraftScreen = null; resizeDirty = false; resizeError = null; resetVersionHistory();
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
  resetTokens(); resetComponents(); resetDatasets(); resetScreenVariants();
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

async function request(path, options, signal) {
  const requestToken = token;
  const response = await fetch(path, {
    ...options, signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, ...(options?.body ? { 'Content-Type': 'application/json' } : {}) }
  });
  if (signal?.aborted || requestToken !== token) throw new DOMException('Cancelled', 'AbortError');
  if (response.status === 401) {
    clearSession();
    message('', 'Токен отсутствует, истёк или отклонён. Введите действующий токен.');
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
  leaveDeletion();
  if (!token) return;
  stopPresence(); navigationEpoch++; resetDiagnostics(); resetScenarios(); resetMembers(); resetExport();
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
    button.addEventListener('click', () => { if (selectedPage !== item.id) { selectedPage = item.id; selectedScreen = null; resetDiagnostics(); resetScenarios(); resetScreenVariants(); screensOffset = 0; resetLayers(); renderPages(); renderCanvas(); refreshPages(); } });
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
    button.addEventListener('click', () => { if (selectedScreen !== item.id) { selectedScreen = item.id; resetDiagnostics(); resetScenarios(); resetScreenVariants(); renderScreenSize(); refreshPages(); } for (const other of list.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button)); renderCanvas(); });
    row.append(button); list.append(row);
  }
  renderCanvas(); renderScreenSize();
  element('screens-previous').disabled = !selectedPage || screensOffset === 0;
  element('screens-next').disabled = !selectedPage || screensOffset + screensItems.length >= screensTotal;
  element('screens-number').textContent = selectedPage ? `Страница списка ${Math.floor(screensOffset / pageSize) + 1}` : 'Выберите страницу';
  element('screen-create').querySelectorAll('input, button').forEach(control => { control.disabled = !selectedPage; });
}


function resizeKey(id, screen) { return `${id}:${screen}`; }
function renderScreenSize() {
  const screen = screensItems.find(item => item.id === selectedScreen);
  const form = element('screen-resize'), operation = screen && resizeOperations.get(resizeKey(documentId, screen.id));
  element('screen-size-saved').textContent = screen ? `Подтверждённый размер: ${screen.dimensions.width} × ${screen.dimensions.height} uiUnit` : 'Выберите экран.';
  form.hidden = !screen || !['Owner', 'Editor'].includes(documentRole);
  if (resizeDraftScreen !== screen?.id) { resizeDraftScreen = screen?.id ?? null; resizeDirty = false; resizeError = null; }
  if (screen && !resizeDirty && !operation) {
    element('resize-width').value = screen.dimensions.width;
    element('resize-height').value = screen.dimensions.height;
  }
  if (operation) {
    element('resize-width').value = operation.body.dimensions.width;
    element('resize-height').value = operation.body.dimensions.height;
  }
  for (const id of ['resize-width', 'resize-height']) element(id).readOnly = !!operation;
  form.querySelector('button[type=submit]').disabled = !!operation;
  element('resize-retry').hidden = operation?.state !== 'uncertain';
  element('screen-size-status').textContent = operation?.state === 'pending' ? 'Ожидание подтверждения…' : '';
  element('screen-size-error').textContent = operation?.state === 'uncertain' ? 'Результат неизвестен. Повторите ту же команду.' : resizeError ?? '';
}
for (const id of ['resize-width', 'resize-height']) element(id).addEventListener('input', () => { resizeDirty = true; resizeError = null; element('screen-size-error').textContent = ''; });
element('screen-resize').addEventListener('submit', event => {
  event.preventDefault();
  if (!selectedScreen || !['Owner', 'Editor'].includes(documentRole)) return;
  const width = element('resize-width').valueAsNumber, height = element('resize-height').valueAsNumber;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
    resizeError = 'Введите конечные неотрицательные ширину и высоту.'; renderScreenSize(); return;
  }
  const key = resizeKey(documentId, selectedScreen);
  if (resizeOperations.has(key)) return;
  const operation = { body: { commandId: crypto.randomUUID(), screenId: selectedScreen, dimensions: { width, height } }, state: 'pending' };
  resizeError = null; resizeOperations.set(key, operation); sendResize(documentId, selectedScreen, operation);
});
element('resize-retry').addEventListener('click', () => {
  const operation = resizeOperations.get(resizeKey(documentId, selectedScreen));
  if (operation?.state === 'uncertain') sendResize(documentId, selectedScreen, operation);
});
async function sendResize(id, screen, operation) {
  const key = resizeKey(id, screen), current = generation, requestToken = token;
  const active = () => current === generation && documentId === id && token === requestToken && !element('editor-view').hidden;
  operation.state = 'pending'; renderScreenSize();
  try {
    await request(`/api/v1/documents/${encodeURIComponent(id)}/commands/resize-screen`, { method: 'POST', body: JSON.stringify(operation.body) });
    if (resizeOperations.get(key) !== operation) return;
    if (!active()) { operation.state = 'uncertain'; return; }
    resizeOperations.delete(key); resizeDirty = false;
    await refreshPages();
    if (active() && selectedScreen === screen) element('screen-size-status').textContent = 'Размер подтверждён.';
  } catch (error) {
    if (resizeOperations.get(key) !== operation) return;
    if (!active() || error instanceof TypeError || error.status >= 500 || error.name === 'AbortError') operation.state = 'uncertain';
    else { resizeOperations.delete(key); if (selectedScreen === screen) { resizeDirty = false; resizeError = error.message; } }
  } finally { if (active() || (token === requestToken && documentId === id && selectedScreen === screen && resizeOperations.get(key) === operation && !element('editor-view').hidden)) { renderScreenSize(); } }
}



function resetLayers() {
  layerController?.abort(); layerController = null; layerGeneration++;
  layerSelection = null; layerRoots = []; layerExpanded = new Set(); layerChildren = new Map();
  clearScenarioCapabilities('Возможности сценария недоступны.'); renderScenarioCreate();
  element('layers').replaceChildren();
  element('layers-status').textContent = 'Выберите экран.';
  element('inspector-selection').textContent = 'Выберите слой.';
}

function selectLayer(item) {
  layerSelection = item;
  loadScenarioCapabilities();
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
  layerExpanded.add(item.id);
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
    renderLayers(item.id);
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
  renderPresence();
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
  if (selectedScreen) { const rect = canvasArea.getBoundingClientRect(); const x = (event.clientX - rect.left - viewport.x) / viewport.scale, y = (event.clientY - rect.top - viewport.y) / viewport.scale; presenceCursor = Math.abs(x) <= 10000000 && Math.abs(y) <= 10000000 ? { x, y } : null; presenceCursorScreen = selectedScreen; }
  if (!drag || event.pointerId !== drag.id) return;
  viewport.x += event.clientX - drag.x; viewport.y += event.clientY - drag.y;
  drag.x = event.clientX; drag.y = event.clientY; paintViewport();
});
canvasArea.addEventListener('pointerleave', () => { presenceCursor = presenceCursorScreen = null; });
function endDrag(event) { if (drag?.id === event.pointerId) drag = null; }
canvasArea.addEventListener('pointerup', endDrag);
canvasArea.addEventListener('pointercancel', endDrag);
canvasArea.addEventListener('lostpointercapture', endDrag);

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
  const children = new Map(), expanded = new Set(layerExpanded);
  async function readBranch(parent) {
    const items = await readLayerChildren(parent, signal, nextRevision);
    if (!valid()) return [];
    for (const item of items) if (expanded.has(item.id)) children.set(item.id, await readBranch(item.id));
    return items;
  }
  let roots;
  try { roots = screen ? await readBranch(screen) : []; }
  catch (error) {
    if (valid() && signal === pending?.signal) layerFailure(error, layerGeneration);
    throw error;
  }
  const tokenSnapshot = await readTokens(base, nextRevision, signal);
  const header = await request(`${base}?fields=name&revision=${nextRevision}`, {}, signal);
  if (!valid()) return;
  // An expansion can change while the pinned tree is loading. Stage it again
  // rather than discard that interaction or mix children from two revisions.
  if (expanded.size !== layerExpanded.size || [...expanded].some(id => !layerExpanded.has(id)))
    return readPages(signal, offset, nextRevision);
  const selection = layerSelection;
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
  element('token-create').inert = element('token-edit').inert = false;
  applyTokens(tokenSnapshot);
  loadComponents(); loadDatasets(); loadScreenVariants();
  const nextDiagnosticsKey = screen ? `${documentId}:${screen}:${revision}` : null;
  if (diagnosticsKey !== nextDiagnosticsKey) { resetDiagnostics(); if (screen) loadDiagnostics(); }
  const nextScenariosKey = screen ? `${documentId}:${screen}:${revision}` : null;
  if (scenariosKey !== nextScenariosKey) { const offset = screen === selectedScreen ? scenariosOffset : 0; resetScenarios(); scenariosOffset = offset; if (screen) loadScenarios(); }
  element('revision').textContent = `Общий черновик · ревизия ${revision}`;
  renderExport();
}

function resetExport() {
  exportController?.abort(); exportController = null;
  element('export-status').textContent = ''; element('export-error').textContent = '';
  renderExport();
}
function renderExport() {
  const permitted = ['Owner', 'Editor'].includes(documentRole);
  element('export-access').textContent = documentRole === 'Viewer'
    ? 'Скачивание экспорта недоступно для роли просмотра по текущей политике.'
    : permitted && Number.isSafeInteger(revision) ? `Файл содержит показанную ревизию ${revision}. JSON не включает содержимое ассетов; для них используйте контейнер.` : 'Экспорт недоступен.';
  for (const id of ['export-json', 'export-container']) element(id).disabled = !permitted || !Number.isSafeInteger(revision) || !!exportController;
}
async function exportDocument(format) {
  if (exportController || !token || !documentId || !Number.isSafeInteger(revision) || !['Owner', 'Editor'].includes(documentRole) || element('editor-view').hidden) return;
  const controller = new AbortController(), id = documentId, requestToken = token, epoch = navigationEpoch, atRevision = revision;
  exportController = controller; renderExport();
  const active = () => exportController === controller && !controller.signal.aborted && epoch === navigationEpoch && documentId === id && token === requestToken && !element('editor-view').hidden;
  element('export-error').textContent = ''; element('export-status').textContent = `Подготовка ревизии ${atRevision}…`;
  try {
    const response = await fetch(`/api/v1/documents/${encodeURIComponent(id)}/${format}?revision=${atRevision}`, {
      signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { Authorization: `Bearer ${requestToken}` }
    });
    if (!active()) return;
    if (response.status === 401) { clearSession(); message('', 'Токен отсутствует, истёк или отклонён. Введите действующий токен.'); return; }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (!active()) return;
      const codes = { REVISION_UNAVAILABLE: 'Эта ревизия больше недоступна. Обновите документ и повторите экспорт.', EXPORT_DEPENDENCY_UNAVAILABLE: 'Экспорт невозможен: отсутствует или повреждён необходимый ассет.', EXPORT_TOO_LARGE: 'Документ превышает допустимый размер экспорта.' };
      throw new Error(codes[body.code] ?? (response.status === 403 ? 'Нет прав на экспорт. Обратитесь к владельцу документа.' : response.status === 404 ? 'Документ или ревизия недоступны. Обновите документ.' : response.status === 413 ? 'Документ превышает допустимый размер экспорта.' : 'Не удалось экспортировать документ. Повторите позже.'));
    }
    const blob = await response.blob();
    if (!active()) return;
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = format === 'document.json' ? 'document.json' : 'document.figvam';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    element('export-status').textContent = `Скачана ревизия ${atRevision}.`;
  } catch (error) {
    if (!active() || error.name === 'AbortError') return;
    element('export-status').textContent = '';
    element('export-error').textContent = error instanceof TypeError ? 'Не удалось связаться с сервером. Проверьте соединение.' : error.message;
  } finally {
    if (exportController === controller) { exportController = null; renderExport(); }
  }
}
element('export-json').addEventListener('click', () => exportDocument('document.json'));
element('export-container').addEventListener('click', () => exportDocument('container.figvam'));

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
  stopPresence(); navigationEpoch++; resetDiagnostics(); resetScenarios(); resetMembers(); resetExport();
  stopLive();
  resetDocumentRename();
  element('documents-view').hidden = true;
  element('editor-view').hidden = true;
  document.title = 'FigVam — открытие документа';
  resetVersionHistory(); resetTokens(); resetComponents(); resetDatasets(); resetScreenVariants(); resizeError = null; resizeDraftScreen = null; documentId = id; documentRole = null; element('version-save').hidden = true; selectedPage = null; selectedScreen = null; screensItems = []; displayedScreen = null; pagesOffset = 0; resetLayers(); renderCanvas();
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
    element('member-management').hidden = role !== 'Owner';
    document.title = `${name} — FigVam`;
    element('page-access').textContent = role === 'Viewer' ? 'Только просмотр страниц.' : role ? 'Управление страницами' : 'Права на редактирование не определены. Обновите страницу.';
    element('page-edit').hidden = !['Owner', 'Editor'].includes(role);
    element('screen-create').hidden = !['Owner', 'Editor'].includes(role);
    element('version-save').hidden = !['Owner', 'Editor'].includes(role);
    element('token-create').hidden = !['Owner', 'Editor'].includes(role);
    element('dataset-edit').hidden = !['Owner', 'Editor'].includes(role);
    renderVersionSave();
    await readPages(signal, 0);
    if (!current()) return;
    element('editor-view').hidden = false;
    startPresence();
    renderRestore(); renderHistoryAction(); loadVersionHistory();
    if (selectedScreen) requestAnimationFrame(fitScreen);
    message();
  });
}

async function changeMember(remove) {
  if (memberController || documentRole !== 'Owner' || !token || !documentId || element('editor-view').hidden) return;
  const memberId = element('member-id').value;
  const role = element('member-role').value;
  element('member-status').textContent = element('member-error').textContent = '';
  if (!memberId.trim() || memberId.length > 256 || (remove && memberId.includes('/'))) {
    element('member-error').textContent = 'Укажите корректный ID участника (от 1 до 256 символов; для удаления без /).';
    element('member-id').focus(); return;
  }
  if (!remove && !['Owner', 'Editor', 'Viewer'].includes(role)) {
    element('member-error').textContent = 'Выберите допустимую роль.'; return;
  }
  if (remove && !confirm(`Удалить участника «${memberId}» из документа?`)) return;
  const controller = new AbortController(), id = documentId, epoch = navigationEpoch, requestToken = token;
  memberController = controller;
  stopLive();
  const active = () => memberController === controller && !controller.signal.aborted && epoch === navigationEpoch && token === requestToken && id === documentId && !element('editor-view').hidden;
  element('member-form').querySelectorAll('button, input, select').forEach(control => control.disabled = true);
  element('member-status').textContent = 'Сохранение…';
  let accepted = false;
  try {
    const path = `/api/v1/documents/${encodeURIComponent(id)}/members${remove ? `/${encodeURIComponent(memberId)}` : ''}`;
    const result = await request(path, remove ? { method: 'DELETE' } : { method: 'PUT', body: JSON.stringify({ memberId, role }) }, controller.signal);
    if (!active()) return;
    if (result.code !== 'ACCEPTED' || result.documentId?.toLowerCase() !== id.toLowerCase()) throw new TypeError('Некорректное подтверждение');
    accepted = true;
    const currentRole = await findRole(id, controller.signal);
    if (!active()) return;
    const success = remove ? 'Участник удалён.' : `Роль участника назначена: ${role}.`;
    if (currentRole !== 'Owner') {
      if (currentRole) {
        const reopening = openDocument(id), nextEpoch = navigationEpoch;
        await reopening;
        if (nextEpoch === navigationEpoch && token && documentId === id && !element('editor-view').hidden) message(success + ' Ваши права изменились.');
      } else {
        const loading = loadList(), nextEpoch = navigationEpoch;
        await loading;
        if (nextEpoch === navigationEpoch && token) message(success + ' Доступ к документу больше не предоставлен.');
      }
      return;
    }
    element('member-status').textContent = success;
  } catch (error) {
    if (!active() || error.name === 'AbortError') return;
    if (accepted || error instanceof TypeError) {
      const loading = loadList(), nextEpoch = navigationEpoch;
      await loading;
      if (nextEpoch === navigationEpoch && token) message('', accepted
        ? 'Изменение сохранено, но не удалось проверить ваши права. Откройте документ снова.'
        : 'Не удалось подтвердить результат. Проверьте доступ и повторите запрос при необходимости.');
      return;
    }
    element('member-status').textContent = '';
    element('member-error').textContent = error.code === 'LAST_OWNER' ? 'Нельзя удалить последнего Owner или изменить его роль.'
      : error.status === 400 || error.code === 'INVALID_MEMBER' ? 'Некорректный ID участника или роль. Проверьте введённые данные.'
      : error.status === 403 ? 'Нет прав управлять участниками документа.'
      : error instanceof TypeError ? 'Не удалось подтвердить результат. Проверьте доступ и повторите запрос при необходимости.' : error.message;
  } finally {
    if (active()) {
      memberController = null;
      element('member-form').querySelectorAll('button, input, select').forEach(control => control.disabled = false);
      startLive();
    }
  }
}
element('member-form').addEventListener('submit', event => { event.preventDefault(); changeMember(false); });
element('member-remove').addEventListener('click', () => changeMember(true));

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
  stopLive(); pending?.abort(); pending = new AbortController();
  const signal = pending.signal;
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
  stopLive(); pending?.abort(); pending = new AbortController();
  const signal = pending.signal, current = ++generation, id = documentId;
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


function renderHistoryAction() {
  const operation = historyActions.get(documentId);
  const writable = ['Owner', 'Editor'].includes(documentRole);
  const blocked = ['pending', 'uncertain'].includes(operation?.state);
  element('undo').disabled = element('redo').disabled = !writable || blocked;
  element('history-access').textContent = writable ? 'Сочетания: Ctrl/⌘+Z, Ctrl/⌘+Shift+Z или Ctrl+Y.' : 'Только просмотр: отмена и повтор недоступны.';
  element('history-action-status').textContent = operation?.state === 'pending' ? 'Ожидание подтверждения…' : operation?.state === 'success' ? 'Действие подтверждено.' : '';
  element('history-action-error').textContent = operation?.error ?? '';
  element('history-action-retry').hidden = !writable || operation?.state !== 'uncertain';
}
function beginHistoryAction(action) {
  if (!documentId || element('editor-view').hidden || !['Owner', 'Editor'].includes(documentRole)) return;
  if (['pending', 'uncertain'].includes(historyActions.get(documentId)?.state)) return;
  const operation = { action, commandId: crypto.randomUUID(), state: 'pending' };
  historyActions.set(documentId, operation); sendHistoryAction(documentId, operation);
}
async function sendHistoryAction(id, operation) {
  if (operation.state === 'pending' && operation.sending) return;
  const epoch = navigationEpoch, requestToken = token;
  const active = () => navigationEpoch === epoch && documentId === id && token === requestToken && !element('editor-view').hidden;
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
    if (historyActions.get(id) === operation && documentId === id && token && !element('editor-view').hidden) renderHistoryAction();
  }
}
element('undo').addEventListener('click', () => beginHistoryAction('undo'));
element('redo').addEventListener('click', () => beginHistoryAction('redo'));
element('history-action-retry').addEventListener('click', () => {
  const operation = historyActions.get(documentId);
  if (operation?.state === 'uncertain' && ['Owner', 'Editor'].includes(documentRole)) sendHistoryAction(documentId, operation);
});
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
  const target = event.target;
  if (target instanceof Element && (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || target.isContentEditable)) return;
  const key = event.key.toLowerCase();
  const action = key === 'z' ? (event.shiftKey ? 'redo' : 'undo') : key === 'y' && !event.shiftKey ? 'redo' : null;
  if (!action || !documentId || element('editor-view').hidden || !['Owner', 'Editor'].includes(documentRole)) return;
  event.preventDefault(); beginHistoryAction(action);
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
      method: 'POST', body: file, cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { Authorization: `Bearer ${operation.token}`, 'Content-Type': format === 'document.json' ? 'application/json' : 'application/zip' }
    });
    if (!active()) return;
    if (response.status === 401) { clearSession(); message('', 'Токен отсутствует, истёк или отклонён. Введите действующий токен.'); return; }
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


function resetTokens() {
  tokenLoad++; tokenItems = []; tokenUsages = []; selectedToken = null;
  element('token-create').inert = element('token-edit').inert = false;
  element('tokens-list').replaceChildren(); element('token-usages').replaceChildren();
  element('token-detail').hidden = true; element('token-create').hidden = true;
  element('tokens-error').textContent = ''; element('tokens-status').textContent = '';
  element('token-create').reset(); element('token-rename').reset(); element('token-set').reset();
}
async function readAllTokenPages(path, revision, signal) {
  let items = [], total;
  do {
    const result = await request(`${path}?revision=${revision}&offset=${items.length}&limit=100`, {}, signal);
    if (result.revision !== revision || !Array.isArray(result.items) || !Number.isInteger(result.total)) throw new Error('Некорректный ответ о токенах.');
    items.push(...result.items); total = result.total;
    if (!result.items.length && items.length < total) throw new Error('Неполный ответ о токенах.');
  } while (items.length < total);
  return items;
}
async function readTokens(base, atRevision, signal) {
  const items = await readAllTokenPages(`${base}/tokens`, atRevision, signal);
  const selection = selectedToken;
  const usages = selection && items.some(item => item.id === selection)
    ? await readAllTokenPages(`${base}/tokens/${encodeURIComponent(selection)}/usages`, atRevision, signal) : [];
  return { items, selection, usages };
}
function applyTokens(snapshot) {
  tokenItems = snapshot.items;
  if (selectedToken !== snapshot.selection) { selectToken(selectedToken); return; }
  if (!tokenItems.some(item => item.id === selectedToken)) selectedToken = null;
  tokenUsages = snapshot.usages; renderTokens();
}
function describeExpression(expression) {
  if (expression?.expression === 'alias') return `Ссылка на токен ${expression.tokenId}`;
  const value = expression?.value;
  if (value?.type === 'spacing') return String(value.value);
  if (value?.type === 'color') return '#' + [value.red, value.green, value.blue, value.alpha].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  return JSON.stringify(expression);
}
function renderTokens() {
  const list = element('tokens-list'); list.replaceChildren();
  for (const item of tokenItems) {
    const li = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.textContent = `${item.name} (${({0: "Цвет", 1: "Отступ", 2: "Типографика", 3: "Геометрия", Color: "Цвет", Spacing: "Отступ"})[item.type] ?? item.type})`;
    button.setAttribute('aria-pressed', String(item.id === selectedToken));
    button.addEventListener('click', () => selectToken(item.id)); li.append(button); list.append(li);
  }
  element('tokens-status').textContent = tokenItems.length ? `Токенов: ${tokenItems.length}` : 'Токенов пока нет.';
  const item = tokenItems.find(t => t.id === selectedToken);
  element('token-detail').hidden = !item;
  if (!item) return;
  element('token-detail-title').textContent = item.name;
  element('token-values').textContent = `Light: ${describeExpression(item.values.Light)}; Dark: ${describeExpression(item.values.Dark)}`;
  element('token-edit').hidden = !['Owner', 'Editor'].includes(documentRole);
  element('token-set').hidden = !['Color', 'Spacing', 0, 1].includes(item.type);
  element('token-name').value = item.name;
  const usages = element('token-usages'); usages.replaceChildren();
  for (const usage of tokenUsages) {
    const li = document.createElement('li');
    li.textContent = [usage.kind, usage.ownerId, usage.property, usage.theme == null ? null : `тема ${usage.theme}`, usage.parameterId].filter(x => x != null).join(' · '); usages.append(li);
  }
  if (!tokenUsages.length) { const li = document.createElement('li'); li.textContent = 'Прямых использований нет.'; usages.append(li); }
}
async function selectToken(id) {
  selectedToken = id; tokenUsages = []; const current = ++tokenLoad, doc = documentId, atRevision = revision;
  renderTokens();
  if (!id || !Number.isSafeInteger(atRevision)) return;
  try {
    const items = await readAllTokenPages(`/api/v1/documents/${encodeURIComponent(doc)}/tokens/${encodeURIComponent(id)}/usages`, atRevision);
    if (current !== tokenLoad || doc !== documentId || atRevision !== revision) return;
    tokenUsages = items; element('tokens-error').textContent = ''; renderTokens();
  } catch (error) { if (current === tokenLoad && doc === documentId) element('tokens-error').textContent = error.message; }
}
function tokenExpression(type, raw) {
  if (type === 'Color' || type === 0) {
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(raw)) throw new Error('Введите цвет в формате #RRGGBB или #RRGGBBAA.');
    const hex = raw.slice(1) + (raw.length === 7 ? 'FF' : '');
    const [red, green, blue, alpha] = [0, 2, 4, 6].map(i => parseInt(hex.slice(i, i + 2), 16));
    return { expression: 'literal', value: { type: 'color', red, green, blue, alpha } };
  }
  if (!raw.trim() || !Number.isFinite(Number(raw))) throw new Error('Введите числовое значение отступа.');
  return { expression: 'literal', value: { type: 'spacing', value: Number(raw) } };
}
async function tokenCommand(command, data, selection) {
  if (!['Owner', 'Editor'].includes(documentRole)) return;
  stopLive(); pending?.abort(); pending = new AbortController(); const signal = pending.signal, current = ++generation;
  element('token-create').inert = element('token-edit').inert = true;
  element('tokens-error').textContent = ''; element('tokens-status').textContent = 'Сохранение…';
  try {
    await request(`/api/v1/documents/${encodeURIComponent(documentId)}/commands/${command}`, { method: 'POST', body: JSON.stringify({ commandId: crypto.randomUUID(), ...data }) }, signal);
    if (signal.aborted || current !== generation) return;
    if (selection) selectedToken = selection;
    await readPages(signal);
    if (current === generation) element('tokens-status').textContent = 'Изменение сохранено.';
  } catch (error) {
    if (error.name !== 'AbortError' && current === generation) element('tokens-error').textContent = error instanceof TypeError || error.status >= 500 ? 'Результат неизвестен. Обновите документ перед повтором.' : error.message;
  } finally { if (current === generation) { element('token-create').inert = element('token-edit').inert = false; startLive(); } }
}
element('token-create').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const type = element('new-token-type').value, id = crypto.randomUUID();
    const values = { Light: tokenExpression(type, element('new-token-light').value.trim()), Dark: tokenExpression(type, element('new-token-dark').value.trim()) };
    tokenCommand('add-token', { tokenId: id, name: element('new-token-name').value, type: type === 'Color' ? 0 : 1, values }, id);
  } catch (error) { element('tokens-error').textContent = error.message; }
});
element('token-rename').addEventListener('submit', event => { event.preventDefault(); tokenCommand('rename-token', { tokenId: selectedToken, name: element('token-name').value }); });
element('token-set').addEventListener('submit', event => {
  event.preventDefault();
  try { const item = tokenItems.find(t => t.id === selectedToken); tokenCommand('set-token-value', { tokenId: selectedToken, theme: element('token-theme').value === 'Light' ? 0 : 1, value: tokenExpression(item.type, element('token-value').value.trim()) }); }
  catch (error) { element('tokens-error').textContent = error.message; }
});

// Catalog reads are pinned to the editor revision and never issue commands.
function resetComponents() {
  componentGeneration++; componentSelection = null; componentOffset = usageOffset = 0;
  componentTotal = usageTotal = 0; componentSearch = '';
  element('components-search').reset(); element('components-list').replaceChildren();
  element('component-detail').hidden = true; element('components-status').textContent = '';
  element('components-error').textContent = ''; element('components-retry').hidden = true;
  componentPagination();
}
function componentPagination() {
  element('components-previous').disabled = componentOffset === 0;
  element('components-next').disabled = componentOffset + pageSize >= componentTotal;
  element('components-number').textContent = componentTotal ? `${componentOffset + 1}–${Math.min(componentOffset + pageSize, componentTotal)} из ${componentTotal}` : '';
  element('usages-previous').disabled = usageOffset === 0;
  element('usages-next').disabled = usageOffset + pageSize >= usageTotal;
  element('usages-number').textContent = usageTotal ? `${usageOffset + 1}–${Math.min(usageOffset + pageSize, usageTotal)} из ${usageTotal}` : '';
}
function componentList(id, items, describe, empty) {
  const list = element(id); list.replaceChildren();
  for (const item of items) { const li = document.createElement('li'); li.textContent = describe(item); list.append(li); }
  if (!items.length) { const li = document.createElement('li'); li.textContent = empty; list.append(li); }
}
async function loadComponents() {
  if (!documentId || !Number.isSafeInteger(revision)) return;
  const current = ++componentGeneration, doc = documentId, atRevision = revision;
  const valid = () => current === componentGeneration && doc === documentId && atRevision === revision;
  const base = `/api/v1/documents/${encodeURIComponent(doc)}/components`;
  element('components-status').textContent = 'Загрузка компонентов…'; element('components-error').textContent = '';
  element('components-retry').hidden = true; element('components-list').replaceChildren(); element('component-detail').hidden = true;
  componentTotal = usageTotal = 0; componentPagination();
  try {
    const query = new URLSearchParams({ revision: String(atRevision), offset: String(componentOffset), limit: String(pageSize), search: componentSearch });
    let result = await request(`${base}?${query}`);
    if (!valid()) return;
    if (componentOffset && !result.items.length) { componentOffset = Math.max(0, componentOffset - pageSize); return loadComponents(); }
    componentTotal = result.total; componentPagination();
    const list = element('components-list');
    for (const item of result.items) {
      const li = document.createElement('li'), button = document.createElement('button'); button.type = 'button'; button.textContent = item.name;
      button.setAttribute('aria-pressed', String(item.id === componentSelection));
      button.addEventListener('click', () => { componentSelection = item.id; usageOffset = 0; loadComponents(); }); li.append(button); list.append(li);
    }
    element('components-status').textContent = result.total ? `Компонентов: ${result.total} · ревизия ${atRevision}` : 'Компоненты не найдены.';
    if (componentSelection) await loadComponentDetail(current, doc, atRevision);
  } catch (error) {
    if (!valid() || error.name === 'AbortError') return;
    element('components-status').textContent = ''; element('components-error').textContent = error.message; element('components-retry').hidden = false;
  }
}
async function loadComponentDetail(current, doc, atRevision) {
  const id = componentSelection, valid = () => current === componentGeneration && doc === documentId && atRevision === revision && id === componentSelection;
  const base = `/api/v1/documents/${encodeURIComponent(doc)}/components/${encodeURIComponent(id)}`;
  element('component-detail').hidden = false; element('component-title').textContent = 'Загрузка…';
  element('component-description').textContent = ''; for (const name of ['component-parameters', 'component-slots', 'component-variants', 'component-usages']) element(name).replaceChildren();
  element('component-usages-status').textContent = 'Загрузка компонента и использований…'; element('component-usages-error').textContent = ''; element('component-usages-retry').hidden = true;
  try {
    const query = new URLSearchParams({ revision: String(atRevision), offset: String(usageOffset), limit: String(pageSize) });
    const [detail, usages] = await Promise.all([request(`${base}?revision=${atRevision}`), request(`${base}/usages?${query}`)]);
    if (!valid()) return;
    if (usageOffset && !usages.items.length) { usageOffset = Math.max(0, usageOffset - pageSize); return loadComponentDetail(current, doc, atRevision); }
    const item = detail.component; element('component-title').textContent = item.name;
    element('component-description').textContent = item.description || 'Описание отсутствует.';
    const types = ['Text', 'Asset', 'Bool', 'Number', 'TokenReference', 'Enum'], kinds = ['Default', 'Hover', 'Disabled', 'Selected', 'Custom'];
    componentList('component-parameters', item.parameters, p => `${p.name} · ${types[p.type] ?? p.type} · ${JSON.stringify(p.defaultValue)}${p.enumValues ? ` · ${p.enumValues.join(', ')}` : ''}`, 'Параметров нет.');
    componentList('component-slots', item.slots, s => `${s.name} · контейнер ${s.containerNodeId}`, 'Слотов нет.');
    componentList('component-variants', item.variants, v => `${v.name} · ${kinds[v.kind] ?? v.kind}${v.baseVariantId ? ` · базовый вариант ${v.baseVariantId}` : ''}`, 'Вариантов нет.');
    usageTotal = usages.total; componentPagination();
    componentList('component-usages', usages.items, u => `Узел ${u.nodeId}${u.variantId ? ` · вариант ${u.variantId}` : ''}`, 'Использований нет.');
    element('component-usages-status').textContent = `Использований: ${usageTotal} · ревизия ${atRevision}`;
  } catch (error) {
    if (!valid() || error.name === 'AbortError') return;
    element('component-title').textContent = 'Компонент недоступен'; element('component-usages-status').textContent = '';
    element('component-usages-error').textContent = error.message; element('component-usages-retry').hidden = false;
  }
}
element('components-search').addEventListener('submit', event => { event.preventDefault(); componentSearch = element('components-query').value.trim(); componentOffset = 0; componentSelection = null; usageOffset = 0; loadComponents(); });
element('components-previous').addEventListener('click', () => { componentOffset = Math.max(0, componentOffset - pageSize); loadComponents(); });
element('components-next').addEventListener('click', () => { componentOffset += pageSize; loadComponents(); });
element('components-retry').addEventListener('click', loadComponents);
element('component-usages-retry').addEventListener('click', loadComponents);
element('usages-previous').addEventListener('click', () => { usageOffset = Math.max(0, usageOffset - pageSize); loadComponents(); });
element('usages-next').addEventListener('click', () => { usageOffset += pageSize; loadComponents(); });

// Dataset reads follow the same authoritative revision as the editor.
function resetDatasets() {
  datasetGeneration++; datasetOffset = datasetTotal = 0; datasetSelection = null;
  element('datasets-list').replaceChildren(); element('dataset-detail').hidden = true;
  element('dataset-edit').hidden = true; element('dataset-create').reset(); element('dataset-replace').reset();
  element('datasets-status').textContent = ''; element('datasets-error').textContent = '';
  element('datasets-retry').hidden = true; element('dataset-command-retry').hidden = true;
}
function datasetControls() {
  const op = datasetOperations.get(documentId);
  element('dataset-edit').inert = !!op;
  element('dataset-command-retry').hidden = !op || op.busy;
  element('datasets-previous').disabled = datasetOffset === 0;
  element('datasets-next').disabled = datasetOffset + pageSize >= datasetTotal;
  element('datasets-number').textContent = datasetTotal ? `${datasetOffset + 1}–${Math.min(datasetOffset + pageSize, datasetTotal)} из ${datasetTotal}` : '';
}
async function loadDatasets() {
  if (!documentId || !Number.isSafeInteger(revision)) return;
  const current = ++datasetGeneration, doc = documentId, atRevision = revision;
  const valid = () => current === datasetGeneration && doc === documentId && atRevision === revision;
  const base = `/api/v1/documents/${encodeURIComponent(doc)}/datasets`;
  element('datasets-status').textContent = 'Загрузка датасетов…'; element('datasets-error').textContent = '';
  element('datasets-retry').hidden = true; element('datasets-list').replaceChildren(); element('dataset-detail').hidden = true;
  try {
    const result = await request(`${base}?revision=${atRevision}&offset=${datasetOffset}&limit=${pageSize}`);
    if (!valid()) return;
    if (datasetOffset && !result.items.length) { datasetOffset = Math.max(0, datasetOffset - pageSize); return loadDatasets(); }
    datasetTotal = result.total; datasetControls();
    for (const item of result.items) {
      const li = document.createElement('li'), button = document.createElement('button'); button.type = 'button'; button.textContent = item.name;
      button.setAttribute('aria-pressed', String(item.id === datasetSelection));
      button.addEventListener('click', () => { datasetSelection = item.id; loadDatasets(); }); li.append(button); element('datasets-list').append(li);
    }
    element('datasets-status').textContent = result.total ? `Датасетов: ${result.total} · ревизия ${atRevision}` : 'Датасетов пока нет.';
    if (datasetSelection) {
      const [detail, fixture] = await Promise.all([request(`${base}/${encodeURIComponent(datasetSelection)}?revision=${atRevision}`), request(`${base}/${encodeURIComponent(datasetSelection)}/fixture?revision=${atRevision}`)]);
      if (!valid()) return;
      element('dataset-title').textContent = detail.dataset.name; element('dataset-fixture').textContent = fixture.fixtureJson;
      element('dataset-detail').hidden = false; element('dataset-replace').hidden = false; element('dataset-delete').hidden = false;
    } else { element('dataset-replace').hidden = true; element('dataset-delete').hidden = true; }
    if (datasetOperations.has(doc) && !datasetOperations.get(doc).busy) element('datasets-error').textContent = 'Результат операции неизвестен или обновление не завершено. Повторите операцию.';
  } catch (error) {
    if (!valid() || error.name === 'AbortError') return;
    element('datasets-status').textContent = ''; element('datasets-error').textContent = error.message; element('datasets-retry').hidden = false;
  }
}
async function datasetCommand(op) {
  const doc = documentId;
  if (!doc || !['Owner', 'Editor'].includes(documentRole) || op.busy) return;
  op.busy = true; datasetOperations.set(doc, op); datasetControls();
  element('datasets-error').textContent = ''; element('datasets-status').textContent = 'Сохранение датасета…';
  try {
    if (!op.accepted) {
      await request(`/api/v1/documents/${encodeURIComponent(doc)}/commands/${op.command}`, { method: 'POST', body: JSON.stringify(op.body) });
      op.accepted = true;
    }
    if (doc !== documentId || !token) return;
    stopLive(); pending?.abort(); pending = new AbortController(); const signal = pending.signal, current = ++generation;
    if (op.selection !== undefined) datasetSelection = op.selection;
    await readPages(signal);
    if (current !== generation || doc !== documentId || signal.aborted) return;
    datasetOperations.delete(doc); datasetControls(); element('datasets-status').textContent = 'Изменение сохранено.'; startLive();
  } catch (error) {
    if (!op.accepted && error.status && error.status < 500) datasetOperations.delete(doc);
    if (doc !== documentId || !token) return;
    if (error.code === 'REVISION_CONFLICT') {
      element('datasets-error').textContent = 'Документ изменился. Обновите датасеты перед повтором.';
      element('datasets-retry').hidden = false;
    } else if (error.code === 'DATASET_IN_USE') element('datasets-error').textContent = 'Датасет используется. Удалите ссылки перед удалением.';
    else if (datasetOperations.has(doc)) element('datasets-error').textContent = 'Результат операции неизвестен или обновление не завершено. Повторите операцию с тем же идентификатором.';
    else element('datasets-error').textContent = error.message;
    startLive();
  } finally { op.busy = false; if (doc === documentId) datasetControls(); }
}
function newDatasetCommand(command, body, selection) {
  if (datasetOperations.has(documentId)) return;
  datasetCommand({ command, body: { commandId: crypto.randomUUID(), ...body }, selection, busy: false, accepted: false });
}
element('dataset-create').addEventListener('submit', event => {
  event.preventDefault(); const csv = element('dataset-create-format').value === 'csv', id = crypto.randomUUID();
  newDatasetCommand(csv ? 'add-csv-dataset' : 'add-dataset', { datasetId: id, name: element('dataset-name').value, [csv ? 'csv' : 'fixtureJson']: element('dataset-create-content').value }, id);
});
element('dataset-replace').addEventListener('submit', event => {
  event.preventDefault(); const csv = element('dataset-replace-format').value === 'csv';
  newDatasetCommand(csv ? 'replace-dataset-fixture-from-csv' : 'replace-dataset-fixture', { datasetId: datasetSelection, expectedRevision: revision, [csv ? 'csv' : 'fixtureJson']: element('dataset-replace-content').value }, datasetSelection);
});
element('dataset-delete').addEventListener('click', () => {
  if (datasetSelection && confirm(`Удалить датасет «${element('dataset-title').textContent}»?`)) newDatasetCommand('delete-dataset', { datasetId: datasetSelection, expectedRevision: revision }, null);
});
element('dataset-command-retry').addEventListener('click', () => { const op = datasetOperations.get(documentId); if (op) datasetCommand(op); });
element('datasets-previous').addEventListener('click', () => { datasetOffset = Math.max(0, datasetOffset - pageSize); loadDatasets(); });
element('datasets-next').addEventListener('click', () => { datasetOffset += pageSize; loadDatasets(); });
element('datasets-retry').addEventListener('click', () => { if (documentId) run(loadDatasets, signal => readPages(signal)); });

function variantKey(doc, screen) { return `${doc}/${screen}`; }
function resetScreenVariants() {
  variantGeneration++; variantOffset = variantTotal = 0; variantScreen = null;
  element('screen-variants-list').replaceChildren(); element('screen-variants-status').textContent = 'Выберите экран.';
  element('screen-variants-error').textContent = ''; element('screen-variants-retry').hidden = true;
  element('screen-variant-create').reset(); renderScreenVariants();
}
function renderScreenVariants() {
  const op = variantOperations.get(variantKey(documentId, selectedScreen));
  const editable = !!selectedScreen && ['Owner', 'Editor'].includes(documentRole);
  element('screen-variant-create').hidden = !editable;
  element('screen-variant-create').querySelector('button').disabled = !!op;
  element('screen-variant-name').readOnly = !!op;
  element('screen-variant-command-retry').hidden = !editable || op?.state !== 'uncertain';
  element('screen-variants-previous').disabled = !selectedScreen || variantOffset === 0;
  element('screen-variants-next').disabled = !selectedScreen || variantOffset + pageSize >= variantTotal;
  element('screen-variants-number').textContent = variantTotal ? `${variantOffset + 1}–${Math.min(variantOffset + pageSize, variantTotal)} из ${variantTotal}` : '';
  if (op?.state === 'uncertain') element('screen-variants-error').textContent = 'Результат создания неизвестен. Повторите ту же команду.';
}
async function loadScreenVariants() {
  const screen = selectedScreen, doc = documentId, atRevision = revision, current = ++variantGeneration;
  if (variantScreen !== screen) { variantOffset = variantTotal = 0; variantScreen = screen; }
  element('screen-variants-list').replaceChildren(); element('screen-variants-error').textContent = '';
  element('screen-variants-retry').hidden = true; renderScreenVariants();
  if (!screen || !doc || !Number.isSafeInteger(atRevision)) { element('screen-variants-status').textContent = 'Выберите экран.'; return; }
  const valid = () => current === variantGeneration && doc === documentId && screen === selectedScreen && atRevision === revision;
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
  const key = variantKey(doc, screen), requestToken = token, epoch = navigationEpoch;
  if (op.state === 'pending' || !['Owner', 'Editor'].includes(documentRole)) return;
  const active = () => doc === documentId && screen === selectedScreen && token === requestToken && epoch === navigationEpoch && !element('editor-view').hidden;
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
  event.preventDefault(); const doc = documentId, screen = selectedScreen, key = variantKey(doc, screen);
  if (!screen || !['Owner', 'Editor'].includes(documentRole) || variantOperations.has(key)) return;
  const op = { body: { commandId: crypto.randomUUID(), screenId: screen, variantId: crypto.randomUUID(), name: element('screen-variant-name').value }, state: 'ready' };
  variantOperations.set(key, op); sendScreenVariant(doc, screen, op);
});
element('screen-variant-command-retry').addEventListener('click', () => { const op = variantOperations.get(variantKey(documentId, selectedScreen)); if (op?.state === 'uncertain') sendScreenVariant(documentId, selectedScreen, op); });
element('screen-variants-previous').addEventListener('click', () => { variantOffset = Math.max(0, variantOffset - pageSize); loadScreenVariants(); });
element('screen-variants-next').addEventListener('click', () => { variantOffset += pageSize; loadScreenVariants(); });
element('screen-variants-retry').addEventListener('click', loadScreenVariants);
