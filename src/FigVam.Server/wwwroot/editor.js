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
let scenarioCapabilities = null, capabilityGeneration = 0, scenarioDatasetsReady = false;
const scenarioEvents = ['Click', 'Change', 'Hover', 'Leave'];
const scenarioActionLabels = { setDemoValue: 'SetDemoValue', selectDataset: 'SelectDataset', showVariant: 'ShowVariant', navigate: 'Navigate', openOverlay: 'OpenOverlay', closeOverlay: 'CloseOverlay', resetPreview: 'ResetPreview' };
const isScenarioNodeId = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

async function readScenarioCapabilities(doc, atRevision, node, screen, { target = '', variant = '', dataset = '', demoNode = '', demoValue = null } = {}, signal) {
  const q = new URLSearchParams({ revision: String(atRevision), nodeId: node, screenId: screen });
  if (variant) q.set('variantId', variant);
  if (target) q.set('targetId', target);
  if (dataset) q.set('datasetId', dataset);
  if (isScenarioNodeId(demoNode)) q.set('demoNodeId', demoNode);
  const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/scenario-capabilities?${q}`, { method: 'POST', body: JSON.stringify({ demoValue }) }, signal);
  if (result.documentId?.toLowerCase() !== doc.toLowerCase() || result.revision !== atRevision || result.nodeId?.toLowerCase() !== node.toLowerCase() || (result.targetId || '') !== target || (result.screenId || '') !== screen || (result.variantId || '') !== variant || !Object.hasOwn(result, 'demoNodeId') || (result.demoNodeId ?? '') !== demoNode || !Object.hasOwn(result, 'demoValue') || result.demoValue !== demoValue || !Object.hasOwn(result, 'datasetId') || (result.datasetId ?? '') !== dataset || typeof result.profile?.id !== 'string' || !result.profile.id || !Number.isInteger(result.profile.version) || result.profile.version < 1 || !Array.isArray(result.events) || !Array.isArray(result.actions) || result.events.some(e => !Number.isInteger(e) || !scenarioEvents[e]) || result.actions.some(a => !Object.hasOwn(scenarioActionLabels, a)) || (result.actions.includes('setDemoValue') && !demoNode) || new Set(result.events).size !== result.events.length || new Set(result.actions).size !== result.actions.length) throw new TypeError('Некорректный ответ');
  return result;
}
function clearScenarioCapabilities(message) {
  capabilityGeneration++; scenarioCapabilities = null;
  element('scenario-event').replaceChildren(); element('scenario-action').replaceChildren();
  element('scenario-capabilities-status').textContent = message;
}
async function loadScenarioCapabilities() {
  const previousAction = element('scenario-action').value, previousEvent = element('scenario-event').value;
  clearScenarioCapabilities('Возможности сценария недоступны.');
  if (!documentId || !selectedScreen || !layerSelection || !element('scenario-variant').options.length || !Number.isSafeInteger(revision)) { renderScenarioCreate(); return; }
  const current = capabilityGeneration, doc = documentId, screen = selectedScreen, node = layerSelection.id, atRevision = revision, target = element('scenario-target').value, variant = element('scenario-variant').value, dataset = element('scenario-dataset').value, demoNode = element('scenario-demo-node').value.trim().toLowerCase(), demoValue = element('scenario-demo-null').checked ? null : element('scenario-demo-value').value, requestToken = token, epoch = navigationEpoch;
  const valid = () => current === capabilityGeneration && doc === documentId && screen === selectedScreen && node === layerSelection?.id && atRevision === revision && target === element('scenario-target').value && variant === element('scenario-variant').value && dataset === element('scenario-dataset').value && demoNode === element('scenario-demo-node').value.trim().toLowerCase() && demoValue === (element('scenario-demo-null').checked ? null : element('scenario-demo-value').value) && requestToken === token && epoch === navigationEpoch && !element('editor-view').hidden;
  element('scenario-capabilities-status').textContent = 'Загрузка возможностей сценария…'; renderScenarioCreate();
  try {
    const result = await readScenarioCapabilities(doc, atRevision, node, screen, { target, variant, dataset, demoNode, demoValue });
    if (!valid()) return;
    for (const value of result.events) element('scenario-event').add(new Option(scenarioEvents[value], String(value)));
    for (const value of result.actions.filter(a => a !== 'selectDataset' || scenarioDatasetsReady)) element('scenario-action').add(new Option(scenarioActionLabels[value], value));
    if (result.actions.includes(previousAction)) element('scenario-action').value = previousAction;
    if (result.events.includes(Number(previousEvent)) && previousEvent !== '') element('scenario-event').value = previousEvent;
    scenarioCapabilities = result;
    element('scenario-capabilities-status').textContent = result.events.length && result.actions.length ? '' : 'Нет доступных событий или действий для сценария в текущем профиле.';
  } catch (error) { if (!valid()) return; element('scenario-capabilities-status').textContent = 'Не удалось загрузить возможности сценария.'; }
  if (valid()) renderScenarioCreate();
}
function resetScenarios() {
  scenariosController?.abort(); scenariosController = null; scenariosGeneration++;
  bindScenarioView();
  resetScenarioEditor();
  clearScenarioCapabilities('Возможности сценария недоступны.');
  scenarioDatasetsReady = false; element('scenario-dataset').replaceChildren(); element('scenario-dataset-status').textContent = ''; element('scenario-dataset-retry').hidden = true;
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
  scenarioDatasetsReady = false; element('scenario-dataset').replaceChildren();
  loadScenarioDatasets(doc, screen, atRevision, valid);
  loadScenarioTargets(doc, screen, atRevision, valid);
  loadScenarioVariants(doc, screen, atRevision, valid);
  try {
    const query = new URLSearchParams({ screenId: screen, revision: String(atRevision), offset: String(offset), limit: String(pageSize) });
    const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/scenarios?${query}`, {}, controller.signal);
    if (!valid()) return;
    if (result.documentId?.toLowerCase() !== doc.toLowerCase() || result.revision !== atRevision || result.offset !== offset || result.limit !== pageSize || !Number.isInteger(result.total) || result.total < 0 || !Array.isArray(result.items)) throw new TypeError('Некорректный ответ');
    if (offset && !result.items.length) { scenariosOffset = Math.max(0, offset - pageSize); return loadScenarios(); }
    const fragment = document.createDocumentFragment();
    for (const scenario of result.items) {
      if (scenario.screenId?.toLowerCase() !== screen.toLowerCase() || typeof scenario.id !== 'string' || typeof scenario.nodeId !== 'string' || !scenarioEvents[scenario.event] || !Array.isArray(scenario.actions)) throw new TypeError('Некорректный сценарий');
      const li = document.createElement('li'), title = document.createElement('p'), actions = document.createElement('ol');
      title.textContent = `Сценарий: ${scenario.id} · Исходный узел: ${scenario.nodeId} · Событие: ${scenarioEvents[scenario.event]}`;
      actions.setAttribute('aria-label', 'Действия по порядку');
      for (const action of scenario.actions) { const item = document.createElement('li'); item.textContent = scenarioActionText(action); actions.append(item); }
      li.append(title, actions);
      if (['Owner', 'Editor'].includes(documentRole)) {
        const edit = document.createElement('button');
        edit.type = 'button'; edit.textContent = `Изменить сценарий ${scenario.id}`;
        edit.addEventListener('click', () => { if (valid()) openScenarioEditor(doc, screen, atRevision, scenario, edit); });
        li.append(edit);
        const button = document.createElement('button'); button.type = 'button'; button.textContent = `Удалить сценарий ${scenario.id}`;
        button.disabled = scenarioOperations.has(scenarioKey(doc, screen));
        button.addEventListener('click', () => beginScenarioDeletion(doc, screen, scenario.id)); li.append(button);
      }
      fragment.append(li);
    }
    scenariosTotal = result.total; element('scenarios-list').append(fragment); renderScenarioCommand({ preserveNotice: true });
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

function renderScenarioCommand({ preserveNotice = false } = {}) {
  const op = scenarioOperations.get(scenarioKey(documentId, selectedScreen));
  const editable = ['Owner', 'Editor'].includes(documentRole);
  renderScenarioCreate();
  renderScenarioEditor();
  element('scenarios-list').querySelectorAll('button').forEach(button => button.disabled = !!op);
  const descriptions = {
    create: ['Создание сценария…', 'Результат создания неизвестен. Повторите ту же команду: сценарий мог быть создан.', 'Повторить создание сценария'],
    update: ['Сохранение сценария…', 'Результат сохранения неизвестен. Повторите ту же команду: сценарий мог быть изменён.', 'Повторить сохранение сценария'],
    delete: [`Удаление сценария «${op?.body.scenarioId}»…`, 'Результат удаления неизвестен. Повторите ту же команду: сценарий мог быть удалён.', 'Повторить удаление сценария']
  };
  const [pendingText, uncertainText, retryText] = descriptions[op?.kind ?? 'delete'];
  if (op || !preserveNotice) {
    element('scenario-command-status').textContent = op?.state === 'pending' ? pendingText : '';
    element('scenario-command-error').textContent = op?.state === 'uncertain' ? uncertainText : '';
  }
  element('scenario-command-retry').textContent = retryText;
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
element('scenario-command-retry').addEventListener('click', () => {
  const op = scenarioOperations.get(scenarioKey(documentId, selectedScreen));
  if (op?.state !== 'uncertain') return;
  const send = { create: sendScenarioCreation, update: sendScenarioUpdate, delete: sendScenarioDeletion };
  send[op.kind ?? 'delete'](documentId, selectedScreen, op);
});


let scenarioDraft = null;
let scenarioView = null;
const canEditScenarios = () => !!token && ['Owner', 'Editor'].includes(documentRole) && !element('editor-view').hidden;
const scenarioDraftCurrent = draft => scenarioDraft === draft && draft.view === scenarioView &&
  draft.doc === documentId && draft.screen === selectedScreen && draft.revision === revision && canEditScenarios();

function resetScenarioEditor(restoreFocus = false) {
  const draft = scenarioDraft;
  scenarioDraft = null;
  draft?.controller.abort();
  element('scenario-edit').hidden = true;
  element('scenario-action-editor').hidden = true;
  if (restoreFocus) draft?.opener.focus();
}

function bindScenarioView() {
  if (!scenarioView || scenarioView.doc !== documentId || scenarioView.screen !== selectedScreen || scenarioView.epoch !== navigationEpoch) {
    scenarioView?.controller.abort();
    scenarioView = { doc: documentId, screen: selectedScreen, epoch: navigationEpoch, controller: new AbortController() };
  }
  return scenarioView;
}

function openScenarioEditor(doc, screen, atRevision, scenario, opener) {
  if (!canEditScenarios() || scenarioOperations.has(scenarioKey(doc, screen))) return;
  resetScenarioEditor();
  scenarioDraft = {
    doc, screen, revision: atRevision, view: bindScenarioView(), opener, controller: new AbortController(),
    scenario: structuredClone(scenario), capabilities: new Map(), variants: new Map(),
    editor: null, validation: null, events: []
  };
  element('scenario-edit-id').textContent = scenario.id;
  element('scenario-edit-event').replaceChildren();
  element('scenario-edit').hidden = false;
  element('scenario-edit-title').focus();
  renderScenarioEditActions();
  validateScenarioDraft();
}

function renderScenarioEditor() {
  const draft = scenarioDraft;
  if (!draft) return;
  if (!scenarioDraftCurrent(draft)) { resetScenarioEditor(); return; }
  const op = scenarioOperations.get(scenarioKey(draft.doc, draft.screen));
  const source = findLayer(draft.scenario.nodeId);
  element('scenario-edit-source').textContent = 'Исходный узел: ' + (source?.name ? source.name + ' · ' : '') + draft.scenario.nodeId;
  element('scenario-edit-fields').disabled = !!op;
  element('scenario-edit-use-layer').disabled = !layerSelection || layerSelection.id === draft.scenario.nodeId;
  element('scenario-edit-demo-use-layer').disabled = !layerSelection;
  element('scenario-edit-add').disabled = draft.scenario.actions.length >= 32;
  element('scenario-edit-submit').disabled = !!op || !!draft.editor || !draft.validation?.valid || !draft.events.includes(draft.scenario.event);
}

function editScenarioButton(label, description, activate, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-label', description);
  button.disabled = disabled;
  button.addEventListener('click', activate);
  return button;
}

function renderScenarioEditActions(focusIndex, focusButton = 0) {
  const draft = scenarioDraft, actions = draft.scenario.actions;
  const list = element('scenario-edit-actions');
  list.replaceChildren();
  for (const [index, action] of actions.entries()) {
    const row = document.createElement('li');
    const text = document.createElement('div');
    text.textContent = scenarioActionText(action);
    const changeOrder = direction => {
      const destination = index + direction;
      [actions[index], actions[destination]] = [actions[destination], actions[index]];
      closeScenarioActionEditor();
      renderScenarioEditActions(destination, direction < 0 ? 1 : 2);
      validateScenarioDraft();
    };
    row.append(text,
      editScenarioButton('Изменить', 'Изменить действие ' + (index + 1), () => openScenarioActionEditor(index)),
      editScenarioButton('Вверх', 'Поднять действие ' + (index + 1), () => changeOrder(-1), index === 0),
      editScenarioButton('Вниз', 'Опустить действие ' + (index + 1), () => changeOrder(1), index === actions.length - 1),
      editScenarioButton('Удалить', 'Удалить действие ' + (index + 1), () => {
        actions.splice(index, 1);
        closeScenarioActionEditor();
        renderScenarioEditActions(Math.min(index, actions.length - 1), 3);
        validateScenarioDraft();
      })
    );
    list.append(row);
  }
  renderScenarioEditor();
  if (focusIndex === undefined) return;
  const buttons = list.children[focusIndex]?.querySelectorAll('button');
  (buttons ? (buttons[focusButton]?.disabled ? buttons[0] : buttons[focusButton]) : element('scenario-edit-add')).focus();
}

function scenarioActionScreens(draft, index) {
  let base = draft.screen;
  const overlays = [];
  for (const action of draft.scenario.actions.slice(0, index)) {
    switch (action.type) {
      case 'navigate': base = action.screenId; overlays.length = 0; break;
      case 'openOverlay': overlays.push(action.screenId); break;
      case 'closeOverlay': if (overlays.length) overlays.pop(); else base = null; break;
      case 'resetPreview': base = null; overlays.length = 0; break;
    }
  }
  return { variantScreen: base, demoScreen: overlays.at(-1) ?? base };
}

function getScenarioCapabilities(draft, screen, values = {}) {
  const { target = '', variant = '', dataset = '', demoNode = '', demoValue = null } = values;
  const key = JSON.stringify([draft.scenario.nodeId, screen, target, variant, dataset, demoNode, demoValue]);
  if (!draft.capabilities.has(key)) {
    const result = readScenarioCapabilities(draft.doc, draft.revision, draft.scenario.nodeId, screen, values, draft.controller.signal)
      .catch(error => {
        if (['SCREEN_VARIANT_NOT_FOUND', 'SCREEN_NOT_FOUND', 'DATASET_NOT_FOUND'].includes(error.code))
          return { actions: [], events: [] };
        draft.capabilities.delete(key);
        throw error;
      });
    draft.capabilities.set(key, result);
  }
  return draft.capabilities.get(key);
}

async function supportedScenarioActionScreen(draft, index, action, current) {
  const { variantScreen, demoScreen } = scenarioActionScreens(draft, index);
  const allScreens = () => [...new Set([draft.screen, ...Array.from(element('scenario-target').options, option => option.value)])];
  let screens = [draft.screen], values;
  switch (action.type) {
    case 'navigate':
    case 'openOverlay': values = { target: action.screenId }; break;
    case 'closeOverlay':
    case 'resetPreview': values = {}; break;
    case 'selectDataset': values = { dataset: action.datasetId ?? '' }; break;
    case 'showVariant':
      screens = variantScreen ? [variantScreen] : action.variantId ? allScreens() : [draft.screen];
      values = { variant: action.variantId ?? '' };
      break;
    case 'setDemoValue':
      if (!isScenarioNodeId(action.nodeId) || (typeof action.value !== 'string' && action.value !== null) || action.value?.length > 4096) return null;
      screens = demoScreen ? [demoScreen] : allScreens();
      values = { demoNode: action.nodeId.toLowerCase(), demoValue: action.value };
      break;
  }
  for (const screen of screens) {
    if (!current()) return null;
    const result = await getScenarioCapabilities(draft, screen, values);
    if (result.actions.includes(action.type)) return screen;
  }
  return null;
}

async function validateScenarioDraft() {
  const draft = scenarioDraft;
  if (!draft) return;
  const validation = { valid: false };
  draft.validation = validation;
  const current = () => scenarioDraftCurrent(draft) && draft.validation === validation;
  const status = element('scenario-edit-validation');
  element('scenario-edit-recheck').hidden = true;
  status.textContent = 'Проверка сценария…';
  renderScenarioEditor();
  try {
    const { actions } = draft.scenario;
    const [source, ...checks] = await Promise.all([
      getScenarioCapabilities(draft, draft.screen),
      ...actions.map((action, index) => supportedScenarioActionScreen(draft, index, action, current))
    ]);
    if (!current()) return;
    validation.actionScreens = checks;
    draft.events = source.events;
    const event = element('scenario-edit-event');
    event.replaceChildren(new Option('Выберите событие', ''), ...source.events.map(value => new Option(scenarioEvents[value], String(value))));
    event.value = source.events.includes(draft.scenario.event) ? String(draft.scenario.event) : '';
    const unsupported = checks.flatMap((allowed, index) => allowed ? [] : [index + 1]);
    validation.valid = actions.length > 0 && actions.length <= 32 && !unsupported.length;
    status.textContent = !actions.length ? 'Добавьте хотя бы одно действие.' :
      unsupported.length ? 'Действия не поддерживаются в текущем контексте: ' + unsupported.join(', ') + '.' :
      !source.events.length ? 'Нет доступных событий для исходного узла.' : '';
  } catch (error) {
    if (!current()) return;
    draft.events = [];
    element('scenario-edit-event').replaceChildren();
    status.textContent = error.status === 403 ? 'Доступ к возможностям сценария утрачен.' : 'Не удалось проверить возможности сценария.';
    element('scenario-edit-recheck').hidden = false;
  }
  if (current()) renderScenarioEditor();
}

function copyScenarioOptions(from, to, value) {
  const select = element(to);
  select.replaceChildren(...Array.from(element(from).options, option => new Option(option.text, option.value)));
  if (value !== undefined) select.value = value;
}

function refreshScenarioActionEditorOptions(kind) {
  const draft = scenarioDraft;
  if (!draft || !scenarioDraftCurrent(draft)) return;
  if (kind === 'target') validateScenarioDraft();
  if (!draft.editor) return;
  const { original } = draft.editor;
  if (kind === 'dataset') {
    copyScenarioOptions('scenario-dataset', 'scenario-edit-dataset', original?.datasetId ?? '');
  } else {
    copyScenarioOptions('scenario-target', 'scenario-edit-target', original?.screenId);
    if (!draft.editor.variantScreen && !element('scenario-edit-variant-screen').value) {
      copyScenarioOptions('scenario-target', 'scenario-edit-variant-screen', draft.screen);
      loadScenarioActionVariants(draft, original?.variantId ?? '');
      return;
    }
  }
  checkScenarioActionChoices(draft);
}

function openScenarioActionEditor(index) {
  const draft = scenarioDraft;
  if (!draft || !scenarioDraftCurrent(draft) || element('scenario-edit-fields').disabled) return;
  const action = draft.scenario.actions[index];
  const { variantScreen } = scenarioActionScreens(draft, index);
  draft.editor = { index, type: action?.type, variantScreen, original: action };
  element('scenario-action-editor-title').textContent = action ? 'Действие ' + (index + 1) : 'Новое действие';
  copyScenarioOptions('scenario-target', 'scenario-edit-target', action?.screenId);
  copyScenarioOptions('scenario-target', 'scenario-edit-variant-screen',
    action?.type === 'showVariant' ? draft.validation?.actionScreens?.[index] ?? draft.screen : draft.screen);
  copyScenarioOptions('scenario-dataset', 'scenario-edit-dataset', action?.datasetId ?? '');
  element('scenario-edit-variant-screen-fields').hidden = !!variantScreen;
  element('scenario-edit-demo-node').value = action?.nodeId ?? '';
  element('scenario-edit-demo-null').checked = action?.value == null;
  const demo = element('scenario-edit-demo-value');
  demo.value = action?.value ?? '';
  draft.editor.displayedDemoValue = demo.value;
  element('scenario-action-editor').hidden = false;
  element('scenario-edit-target').focus();
  loadScenarioActionVariants(draft, action?.variantId ?? '');
}

function closeScenarioActionEditor(restoreFocus = false) {
  const draft = scenarioDraft;
  const index = draft.editor?.index;
  clearTimeout(draft.editor?.timer);
  draft.editor = null;
  element('scenario-action-editor').hidden = true;
  renderScenarioEditor();
  if (restoreFocus) (element('scenario-edit-actions').children[index]?.querySelector('button') ?? element('scenario-edit-add')).focus();
}

async function loadScenarioActionVariants(draft, preferred) {
  const editor = draft.editor;
  const screen = editor.variantScreen ?? element('scenario-edit-variant-screen').value;
  const select = element('scenario-edit-variant');
  select.replaceChildren();
  checkScenarioActionChoices(draft);
  if (!screen) return;
  const current = () => scenarioDraftCurrent(draft) && draft.editor === editor && screen === (editor.variantScreen ?? element('scenario-edit-variant-screen').value);
  try {
    if (!draft.variants.has(screen)) {
      const items = readScenarioVariants(draft.doc, screen, draft.revision, draft.controller.signal).catch(error => {
        draft.variants.delete(screen);
        throw error;
      });
      draft.variants.set(screen, items);
    }
    const items = await draft.variants.get(screen);
    if (!current()) return;
    select.replaceChildren(new Option('Базовое состояние', ''), ...items.map(item => new Option(item.name, item.id)));
    select.value = preferred;
    if (select.selectedIndex < 0) select.selectedIndex = -1;
  } catch (error) {
    if (!current()) return;
    select.replaceChildren();
  }
  if (current()) checkScenarioActionChoices(draft);
}

function checkScenarioActionChoices(draft, delay = 0) {
  const editor = draft.editor;
  clearTimeout(editor.timer);
  const check = Symbol();
  editor.check = check;
  editor.choices = new Map();
  element('scenario-edit-apply-action').disabled = true;
  element('scenario-edit-action-type').replaceChildren();
  element('scenario-edit-demo-value').disabled = element('scenario-edit-demo-null').checked;
  element('scenario-edit-action-status').textContent = 'Проверка действий…';
  renderScenarioEditor();
  editor.timer = setTimeout(async () => {
    const current = () => scenarioDraftCurrent(draft) && draft.editor === editor && editor.check === check;
    if (!current()) return;
    const target = element('scenario-edit-target').value;
    const dataset = element('scenario-edit-dataset').value || null;
    const variant = element('scenario-edit-variant').value || null;
    const demoNode = element('scenario-edit-demo-node').value.trim().toLowerCase();
    const enteredValue = element('scenario-edit-demo-value').value;
    // A textarea normalizes line endings. Preserve the original value when the displayed text is unchanged.
    const value = element('scenario-edit-demo-null').checked ? null :
      enteredValue === editor.displayedDemoValue ? editor.original?.value ?? enteredValue : enteredValue;
    const variantScreen = editor.variantScreen ?? element('scenario-edit-variant-screen').value;
    try {
      const [general, variantOptions, demoOptions] = await Promise.all([
        getScenarioCapabilities(draft, draft.screen, { target, dataset: dataset ?? '' }),
        element('scenario-edit-variant').selectedIndex >= 0 && getScenarioCapabilities(draft, variantScreen, { variant: variant ?? '' }),
        isScenarioNodeId(demoNode) && (async () => {
          const action = { type: 'setDemoValue', nodeId: demoNode, value };
          return await supportedScenarioActionScreen(draft, editor.index, action, current) ? action : null;
        })()
      ]);
      if (!current()) return;
      const choices = editor.choices;
      for (const type of general.actions) {
        if (['navigate', 'openOverlay'].includes(type) && target) choices.set(type, { type, screenId: target });
        if (['closeOverlay', 'resetPreview'].includes(type)) choices.set(type, { type });
        if (type === 'selectDataset' && scenarioDatasetsReady && element('scenario-edit-dataset').selectedIndex >= 0) choices.set(type, { type, datasetId: dataset });
      }
      if (variantOptions?.actions?.includes('showVariant')) choices.set('showVariant', { type: 'showVariant', variantId: variant });
      if (demoOptions) choices.set('setDemoValue', demoOptions);
      const select = element('scenario-edit-action-type');
      for (const type of choices.keys()) select.add(new Option(scenarioActionLabels[type], type));
      if (choices.has(editor.type)) select.value = editor.type;
      else if (editor.type) select.selectedIndex = -1;
      element('scenario-edit-apply-action').disabled = !select.value;
      element('scenario-edit-action-status').textContent = choices.size ? '' : 'Нет доступных действий для выбранных значений.';
    } catch (error) {
      if (current()) element('scenario-edit-action-status').textContent = 'Не удалось проверить варианты действия.';
    }
  }, delay);
}

element('scenario-edit-use-layer').addEventListener('click', () => {
  if (!scenarioDraft || !layerSelection) return;
  scenarioDraft.scenario.nodeId = layerSelection.id;
  scenarioDraft.events = [];
  validateScenarioDraft();
  if (scenarioDraft.editor) checkScenarioActionChoices(scenarioDraft);
});
element('scenario-edit-event').addEventListener('change', event => {
  if (!scenarioDraft) return;
  scenarioDraft.scenario.event = event.target.value ? Number(event.target.value) : null;
  renderScenarioEditor();
});
element('scenario-edit-add').addEventListener('click', () => openScenarioActionEditor(scenarioDraft.scenario.actions.length));
element('scenario-edit-cancel').addEventListener('click', () => resetScenarioEditor(true));
element('scenario-edit-recheck').addEventListener('click', () => {
  validateScenarioDraft();
  if (scenarioDraft?.editor) checkScenarioActionChoices(scenarioDraft);
});
element('scenario-edit-cancel-action').addEventListener('click', () => closeScenarioActionEditor(true));
element('scenario-edit-action-type').addEventListener('change', event => {
  const editor = scenarioDraft?.editor;
  if (!editor) return;
  editor.type = event.target.value;
  element('scenario-edit-apply-action').disabled = !editor.choices.has(editor.type);
});
element('scenario-edit-variant-screen').addEventListener('change', () => loadScenarioActionVariants(scenarioDraft, ''));
for (const id of ['scenario-edit-target', 'scenario-edit-variant', 'scenario-edit-dataset', 'scenario-edit-demo-null'])
  element(id).addEventListener('change', () => checkScenarioActionChoices(scenarioDraft));
for (const id of ['scenario-edit-demo-node', 'scenario-edit-demo-value'])
  element(id).addEventListener('input', () => checkScenarioActionChoices(scenarioDraft, 250));
element('scenario-edit-demo-use-layer').addEventListener('click', () => {
  if (!layerSelection) return;
  element('scenario-edit-demo-node').value = layerSelection.id;
  checkScenarioActionChoices(scenarioDraft);
});
element('scenario-edit-apply-action').addEventListener('click', () => {
  const draft = scenarioDraft, editor = draft?.editor;
  const action = editor?.choices.get(element('scenario-edit-action-type').value);
  if (!action || !scenarioDraftCurrent(draft) || element('scenario-edit-fields').disabled) return;
  draft.scenario.actions[editor.index] = action;
  closeScenarioActionEditor();
  renderScenarioEditActions(editor.index);
  validateScenarioDraft();
});
element('scenario-edit').addEventListener('submit', event => {
  event.preventDefault();
  const draft = scenarioDraft;
  if (!draft || !scenarioDraftCurrent(draft) || draft.editor || !draft.validation?.valid || !draft.events.includes(draft.scenario.event)) return;
  const key = scenarioKey(draft.doc, draft.screen);
  if (scenarioOperations.has(key)) return;
  const op = {
    kind: 'update', state: 'ready', token,
    body: { commandId: crypto.randomUUID(), expectedRevision: draft.revision, scenario: structuredClone(draft.scenario) }
  };
  scenarioOperations.set(key, op);
  sendScenarioUpdate(draft.doc, draft.screen, op);
});

async function sendScenarioUpdate(doc, screen, op) {
  const key = scenarioKey(doc, screen);
  if (scenarioOperations.get(key) !== op || op.state === 'pending' || op.token !== token || !canEditScenarios()) return;
  const view = bindScenarioView();
  const current = () => view === scenarioView && doc === documentId && screen === selectedScreen && op.token === token && canEditScenarios();
  op.state = 'pending';
  renderScenarioCommand();
  try {
    const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/commands/update-scenario`, { method: 'POST', body: JSON.stringify(op.body) }, view.controller.signal);
    if (result.code !== 'ACCEPTED' || !Number.isSafeInteger(result.revision) || result.revision <= op.body.expectedRevision || result.documentId?.toLowerCase() !== doc.toLowerCase() || result.commandId?.toLowerCase() !== op.body.commandId.toLowerCase())
      throw new TypeError('Некорректное подтверждение');
    if (scenarioOperations.get(key) !== op) return;
    if (!current()) { op.state = 'uncertain'; return; }
    resetScenarioEditor();
    await run(() => refreshPages(), signal => readPages(signal, pagesOffset, null, current));
    if (scenarioOperations.get(key) === op) scenarioOperations.delete(key);
    if (current()) {
      renderScenarioCommand();
      element('scenario-command-status').textContent = 'Изменение сценария подтверждено.';
    }
  } catch (error) {
    if (scenarioOperations.get(key) !== op) return;
    if (!current() || !error.status || error.status === 408 || error.status >= 500) { op.state = 'uncertain'; return; }
    if (error.code === 'REVISION_CONFLICT') {
      resetScenarioEditor();
      await run(() => refreshPages(), signal => readPages(signal, pagesOffset, null, current));
      if (scenarioOperations.get(key) === op) scenarioOperations.delete(key);
      if (!current()) return;
      renderScenarioCommand();
      element('scenario-command-error').textContent = 'Документ изменился. Обновите страницы и снова откройте сценарий.';
      return;
    }
    if (error.status === 403 || error.code === 'DOCUMENT_NOT_FOUND') {
      resetScenarioEditor();
      element('scenario-command-error').textContent = 'Доступ к документу утрачен или недостаточен.';
      const role = error.code === 'DOCUMENT_NOT_FOUND' ? null : await findRole(doc, view.controller.signal).catch(() => null);
      if (scenarioOperations.get(key) === op) scenarioOperations.delete(key);
      if (!current()) return;
      if (role === 'Viewer') {
        documentRole = role;
        renderScenarioCommand({ preserveNotice: true });
        loadScenarios();
      } else if (role === null) {
        closeInaccessibleDocument(error.status);
      } else {
        renderScenarioCommand({ preserveNotice: true });
      }
      element('scenario-command-status').textContent = '';
      return;
    }
    scenarioOperations.delete(key);
    renderScenarioCommand();
    element('scenario-command-error').textContent = 'Изменение отклонено: ' + error.message;
  } finally {
    if (doc === documentId && screen === selectedScreen && op.token === token && canEditScenarios() && scenarioOperations.get(key) === op)
      renderScenarioCommand();
  }
}


function renderScenarioCreate() {
  const editable = !!selectedScreen && ['Owner', 'Editor'].includes(documentRole);
  const op = scenarioOperations.get(scenarioKey(documentId, selectedScreen));
  const needsTarget = ['navigate', 'openOverlay'].includes(element('scenario-action').value);
  element('scenario-create').hidden = !editable;
  element('scenario-source').textContent = layerSelection ? `Исходный слой: ${layerSelection.name?.trim() || 'Без имени'} — ${layerSelection.kind}` : (layerRoots.length ? 'Выберите исходный слой в дереве.' : 'На экране нет слоёв для сценария.');
  element('scenario-target-fields').hidden = !needsTarget;
  element('scenario-demo-value').disabled = !!op || element('scenario-demo-null').checked;
  element('scenario-demo-node').disabled = element('scenario-demo-null').disabled = !!op;
  element('scenario-demo-use-layer').disabled = !!op || !layerSelection;
  element('scenario-create-submit').disabled = !editable || !!op || !layerSelection || !scenarioCapabilities || !element('scenario-event').value || !element('scenario-action').value || (needsTarget && !element('scenario-target').value);
  element('scenario-event').disabled = element('scenario-action').disabled = element('scenario-target').disabled = element('scenario-variant').disabled = element('scenario-dataset').disabled = !!op;
}
element('scenario-action').addEventListener('change', renderScenarioCreate);
element('scenario-target').addEventListener('change', loadScenarioCapabilities);
element('scenario-variant').addEventListener('change', loadScenarioCapabilities);
element('scenario-dataset').addEventListener('change', loadScenarioCapabilities);
for (const id of ['scenario-demo-node', 'scenario-demo-value']) element(id).addEventListener('input', loadScenarioCapabilities);
element('scenario-demo-use-layer').addEventListener('click', () => { if (layerSelection) { element('scenario-demo-node').value = layerSelection.id; loadScenarioCapabilities(); } });
element('scenario-demo-null').addEventListener('change', loadScenarioCapabilities);
element('scenario-dataset-retry').addEventListener('click', () => { if (documentId && selectedScreen) loadScenarios(); });
async function loadScenarioDatasets(doc, screen, atRevision, valid) {
  const select = element('scenario-dataset'); select.replaceChildren(); scenarioDatasetsReady = false;
  element('scenario-dataset-status').textContent = 'Загрузка датасетов…'; element('scenario-dataset-retry').hidden = true;
  try {
    const items = []; let total;
    do {
      const q = new URLSearchParams({ revision: String(atRevision), offset: String(items.length), limit: '100' });
      const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/datasets?${q}`);
      if (!valid()) return;
      if (result.documentId?.toLowerCase() !== doc.toLowerCase() || result.revision !== atRevision || !Array.isArray(result.items) || !Number.isInteger(result.total) || result.total < 0 || (!result.items.length && items.length < result.total) || result.items.some(item => typeof item.id !== 'string' || typeof item.name !== 'string')) throw new TypeError('Некорректный ответ');
      items.push(...result.items); total = result.total;
    } while (items.length < total);
    select.add(new Option('Без датасета', ''));
    for (const item of items) select.add(new Option(item.name, item.id));
    scenarioDatasetsReady = true; element('scenario-dataset-status').textContent = items.length ? '' : 'Датасетов пока нет; доступен выбор без датасета.';
  } catch (error) { if (!valid()) return; element('scenario-dataset-status').textContent = 'Не удалось загрузить датасеты.'; element('scenario-dataset-retry').hidden = false; }
  if (valid()) { loadScenarioCapabilities(); refreshScenarioActionEditorOptions('dataset'); }
}

async function readScenarioVariants(doc, screen, atRevision, signal) {
  const items = [];
  let total;
  do {
    const q = new URLSearchParams({ revision: String(atRevision), offset: String(items.length), limit: '100' });
    const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/screens/${encodeURIComponent(screen)}/variants?${q}`, {}, signal);
    if (result.documentId?.toLowerCase() !== doc.toLowerCase() || result.screenId?.toLowerCase() !== screen.toLowerCase() || result.revision !== atRevision || !Array.isArray(result.items) || !Number.isInteger(result.total) || result.total < 0 || (!result.items.length && items.length < result.total) || result.items.some(item => typeof item.id !== 'string' || typeof item.name !== 'string')) throw new TypeError('Некорректный ответ');
    items.push(...result.items);
    total = result.total;
  } while (items.length < total);
  return items;
}

async function loadScenarioVariants(doc, screen, atRevision, valid) {
  const select = element('scenario-variant'); select.replaceChildren();
  element('scenario-variant-status').textContent = 'Загрузка вариантов…';
  try {
    const items = await readScenarioVariants(doc, screen, atRevision, scenariosController?.signal);
    if (!valid()) return;
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
  if (valid()) { renderScenarioCreate(); loadScenarioCapabilities(); refreshScenarioActionEditorOptions('target'); }
}
element('scenario-create').addEventListener('submit', event => {
  event.preventDefault();
  const doc = documentId, screen = selectedScreen, key = scenarioKey(doc, screen), target = element('scenario-target').value, source = layerSelection?.id, eventValue = Number(element('scenario-event').value), actionType = element('scenario-action').value;
  const needsTarget = ['navigate', 'openOverlay'].includes(actionType);
  if (!['Owner', 'Editor'].includes(documentRole) || !screen || !source || !scenarioCapabilities || !scenarioCapabilities.actions.includes(actionType) || scenarioCapabilities.documentId !== doc || scenarioCapabilities.nodeId !== source || scenarioCapabilities.revision !== revision || scenarioCapabilities.screenId !== screen || (scenarioCapabilities.variantId || '') !== element('scenario-variant').value || (scenarioCapabilities.datasetId ?? '') !== element('scenario-dataset').value || (actionType === 'selectDataset' && !scenarioDatasetsReady) || (scenarioCapabilities.demoNodeId ?? '') !== element('scenario-demo-node').value.trim().toLowerCase() || scenarioCapabilities.demoValue !== (element('scenario-demo-null').checked ? null : element('scenario-demo-value').value) || (scenarioCapabilities.targetId || '') !== target || (needsTarget && !target) || !scenarioCapabilities.events.includes(eventValue) || scenarioOperations.has(key) || !Number.isSafeInteger(revision)) return;
  const action = actionType === 'setDemoValue' ? { type: actionType, nodeId: element('scenario-demo-node').value.trim(), value: element('scenario-demo-null').checked ? null : element('scenario-demo-value').value } : needsTarget ? { type: actionType, screenId: target } : actionType === 'showVariant' ? { type: actionType, variantId: element('scenario-variant').value || null } : actionType === 'selectDataset' ? { type: actionType, datasetId: element('scenario-dataset').value || null } : { type: actionType };
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
let nodeReadGeneration = 0, nodeMetadata = null;
const nodeOperations = new Map();
const nodeDeletions = new Map();
const nodeMoves = new Map();
const nodeMoveNotices = new Map();
let nodeReparentDraft = null;
let layerSelectionEpoch = 0;
let screenContextEpoch = 0;
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
function closeInaccessibleDocument(status) {
  pending?.abort(); generation++; navigationEpoch++;
  resetDiagnostics(); resetScenarios(); resetLayers(); resetVersionHistory();
  resetMembers(); resetExport(); documentRole = null; revision = null; pagesItems = []; screensItems = []; selectedPage = selectedScreen = null;
  element('page-edit').inert = element('screen-create').inert = false;
  element('revision').textContent = ''; element('document-title').textContent = '';
  document.title = 'FigVam — доступ потерян';
  renderPages(); renderScreens(); element('editor-view').hidden = true;
  stopPresence(); stopLive(); message('', status === 404 ? 'Документ удалён или больше недоступен.' : 'Доступ к документу потерян. Запросите права у владельца и откройте документ снова.');
}
async function followDocument(id, controller) {
  const signal = controller.signal, base = `/api/v1/documents/${encodeURIComponent(id)}`;
  const active = () => !signal.aborted && liveController === controller && documentId === id;
  let delay = 1000;
  function denied(status) {
    if (active()) closeInaccessibleDocument(status);
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
  stopPresence(); navigationEpoch++; resetDiagnostics(); resetScenarios(); resetMembers(); resetExport(); historyActions.clear(); scenarioOperations.clear(); nodeOperations.clear(); nodeDeletions.clear(); nodeMoves.clear(); nodeMoveNotices.clear();
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

async function request(path, options, signal, isCurrent = () => true) {
  const requestToken = token;
  const response = await fetch(path, {
    ...options, signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, ...(options?.body ? { 'Content-Type': 'application/json' } : {}) }
  });
  if (signal?.aborted || requestToken !== token || !isCurrent()) throw new DOMException('Cancelled', 'AbortError');
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
    if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError');
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
    button.addEventListener('click', () => { if (selectedPage !== item.id) { screenContextEpoch++; selectedPage = item.id; selectedScreen = null; resetDiagnostics(); resetScenarios(); resetScreenVariants(); screensOffset = 0; resetLayers(); renderPages(); renderCanvas(); refreshPages(); } });
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
    button.addEventListener('click', () => { if (selectedScreen !== item.id) { screenContextEpoch++; selectedScreen = item.id; resetDiagnostics(); resetScenarios(); resetScreenVariants(); renderScreenSize(); refreshPages(); } for (const other of list.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button)); renderCanvas(); });
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
  closeNodeReparent();
  layerController?.abort(); layerController = null; layerGeneration++;
  layerSelection = null; layerRoots = []; layerExpanded = new Set(); layerChildren = new Map();
  clearScenarioCapabilities('Возможности сценария недоступны.'); renderScenarioCreate();
  element('layers').replaceChildren();
  element('layers-status').textContent = 'Выберите экран.';
  element('inspector-selection').textContent = 'Выберите слой.';
  nodeReadGeneration++; nodeMetadata = null; renderNodeMetadata();
}

function selectLayer(item) {
  if (layerSelection?.id !== item.id) { layerSelectionEpoch++; closeNodeReparent(); }
  layerSelection = item;
  loadNodeMetadata();
  loadScenarioCapabilities();
  renderScenarioEditor();
  element('inspector-selection').textContent = `Слой: ${item.name?.trim() || 'Без имени'} · ${item.kind} · ID: ${item.id}`;
  renderNodeOrder();
  for (const node of element('layers').querySelectorAll('[role=treeitem]'))
    node.setAttribute('aria-selected', String(node.dataset.id === item.id));
}

function nodeOperationKey(doc, node) { return `${doc}:${node}`; }
function renderNodeDeletion() {
  renderNodeOrder();
  let op = nodeDeletions.get(`${documentId}:${selectedScreen}`);
  const editable = ['Owner', 'Editor'].includes(documentRole);
  element('node-delete').hidden = !layerSelection || !editable;
  element('node-delete').disabled = !!op && op.state !== 'rejected' || !!(layerSelection && nodeOperations.get(nodeOperationKey(documentId, layerSelection.id)));
  element('node-delete-retry').hidden = !editable || op?.state !== 'uncertain';
  element('node-delete-status').textContent = op?.state === 'pending' ? 'Удаление слоя…' : op?.state === 'uncertain' ? `Результат удаления слоя «${op.name}» неизвестен. Повторите ту же команду.` : op?.error || '';
}
function renderNodeMetadata() {
  renderNodeDeletion();
  const selected = layerSelection, op = selected && nodeOperations.get(nodeOperationKey(documentId, selected.id));
  const visible = !!selected;
  element('node-metadata').hidden = !visible;
  if (!visible) return;
  const editable = ['Owner', 'Editor'].includes(documentRole);
  const ready = nodeMetadata?.id === selected.id;
  for (const id of ['node-name', 'node-key']) element(id).readOnly = !editable || !ready || !!op;
  for (const id of ['node-name-form', 'node-key-form']) element(id).querySelector('button').hidden = !editable;
  for (const id of ['node-name-form', 'node-key-form']) element(id).querySelector('button').disabled = !ready || !!op;
  if (ready) { element('node-name').value = nodeMetadata.name; element('node-key').value = nodeMetadata.semanticKey ?? ''; }
  else { element('node-name').value = ''; element('node-key').value = ''; }
  element('node-metadata-status').textContent = op?.state === 'pending' ? 'Ожидание подтверждения…' : (!ready ? 'Загрузка слоя…' : '');
  element('node-metadata-error').textContent = op?.state === 'uncertain' ? 'Результат неизвестен. Повторите ту же команду.' : (nodeMetadata?.error ?? '');
  element('node-metadata-retry').hidden = !editable || op?.state !== 'uncertain';
}
async function loadNodeMetadata() {
  const current = ++nodeReadGeneration, doc = documentId, screen = selectedScreen, node = layerSelection?.id, atRevision = revision, epoch = navigationEpoch, requestToken = token;
  nodeMetadata = null; renderNodeMetadata();
  if (!node || !Number.isSafeInteger(atRevision)) return;
  const active = () => current === nodeReadGeneration && doc === documentId && screen === selectedScreen && node === layerSelection?.id && atRevision === revision && epoch === navigationEpoch && requestToken === token && !element('editor-view').hidden;
  try {
    const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/nodes/${encodeURIComponent(node)}?fields=name,semanticKey&revision=${atRevision}`, {}, undefined, active);
    if (!active()) return;
    const item = result.items?.[0];
    if (result.revision !== atRevision || item?.id !== node || typeof item.name !== 'string') throw new TypeError('Некорректный ответ');
    nodeMetadata = { id: node, name: item.name, semanticKey: item.semanticKey ?? null };
    renderNodeMetadata();
  } catch (error) {
    if (!active()) return;
    if (error.status === 403) { closeInaccessibleDocument(error.status); return; }
    nodeMetadata = { error: error.message || 'Не удалось загрузить слой.' }; renderNodeMetadata();
    element('node-metadata-status').textContent = '';
    element('node-metadata-error').textContent = error.message || 'Не удалось загрузить слой.';
  }
}
function submitNodeMetadata(kind) {
  const doc = documentId, screen = selectedScreen, node = layerSelection?.id;
  if (!node || !nodeMetadata || !['Owner', 'Editor'].includes(documentRole)) return;
  const key = nodeOperationKey(doc, node); if (nodeOperations.has(key)) return;
  const value = element(kind === 'name' ? 'node-name' : 'node-key').value;
  if (value.length > 256 || /[\u0000-\u001f\u007f-\u009f]/.test(value) || (kind === 'key' && value !== '' && !value.trim())) {
    element('node-metadata-error').textContent = 'Проверьте значение: не более 256 символов, без управляющих символов; semantic key не может состоять из пробелов.'; return;
  }
  const op = { kind, body: { commandId: crypto.randomUUID(), nodeId: node, ...(kind === 'name' ? { name: value } : { semanticKey: value === '' ? null : value }) }, state: 'pending' };
  nodeOperations.set(key, op); sendNodeMetadata(doc, screen, node, op);
}
element('node-name-form').addEventListener('submit', e => { e.preventDefault(); submitNodeMetadata('name'); });
element('node-key-form').addEventListener('submit', e => { e.preventDefault(); submitNodeMetadata('key'); });
element('node-metadata-retry').addEventListener('click', () => {
  const op = layerSelection && nodeOperations.get(nodeOperationKey(documentId, layerSelection.id));
  if (op?.state === 'uncertain') sendNodeMetadata(documentId, selectedScreen, layerSelection.id, op);
});
async function sendNodeMetadata(doc, screen, node, op) {
  const key = nodeOperationKey(doc, node), epoch = navigationEpoch, requestToken = token, selectionGeneration = nodeReadGeneration;
  const active = () => nodeReadGeneration === selectionGeneration && nodeOperations.get(key) === op && documentId === doc && selectedScreen === screen && layerSelection?.id === node && navigationEpoch === epoch && token === requestToken && !element('editor-view').hidden;
  op.state = 'pending'; if (active()) renderNodeMetadata();
  try {
    const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/commands/set-node-${op.kind === 'name' ? 'name' : 'semantic-key'}`, { method: 'POST', body: JSON.stringify(op.body) }, undefined, active);
    if (nodeOperations.get(key) !== op) return;
    if (!Number.isSafeInteger(result.revision) || result.code !== 'ACCEPTED' || result.documentId?.toLowerCase() !== doc.toLowerCase() || result.commandId?.toLowerCase() !== op.body.commandId.toLowerCase()) throw new TypeError('Некорректное подтверждение');
    if (!active()) { op.state = 'uncertain'; return; }
    nodeOperations.delete(key);
    await run(() => refreshPages(), signal => readPages(signal, pagesOffset, null, activeAfterConfirmation));
    function activeAfterConfirmation() { return documentId === doc && selectedScreen === screen && layerSelection?.id === node && nodeReadGeneration === selectionGeneration && navigationEpoch === epoch && token === requestToken && !element('editor-view').hidden; }
  } catch (error) {
    if (nodeOperations.get(key) !== op) return;
    if (!active() || error instanceof TypeError || error.status >= 500 || error.name === 'AbortError') op.state = 'uncertain';
    else {
      nodeOperations.delete(key);
      if (error.status === 403) { closeInaccessibleDocument(error.status); return; }
      if (error.code === 'NODE_NOT_FOUND') {
        const currentContext = () => documentId === doc && selectedScreen === screen && layerSelection?.id === node && nodeReadGeneration === selectionGeneration && navigationEpoch === epoch && token === requestToken && !element('editor-view').hidden;
        await run(() => refreshPages(), signal => readPages(signal, pagesOffset, null, currentContext));
        if (documentId === doc && selectedScreen === screen && navigationEpoch === epoch && token === requestToken && !element('editor-view').hidden && !layerSelection) element('layers-status').textContent = 'Слой больше не существует.';
        return;
      }
      if (nodeMetadata) nodeMetadata.error = error.message;
      renderNodeMetadata(); return;
    }
  } finally { if (nodeOperations.get(key) === op && documentId === doc && selectedScreen === screen && layerSelection?.id === node && navigationEpoch === epoch && token === requestToken && !element('editor-view').hidden) renderNodeMetadata(); }
}

element('node-delete').addEventListener('click', () => {
  const node = layerSelection, doc = documentId, screen = selectedScreen, key = `${doc}:${screen}`;
  if (!node || !['Owner', 'Editor'].includes(documentRole) || (nodeDeletions.has(key) && nodeDeletions.get(key).state !== 'rejected') || nodeOperations.has(nodeOperationKey(doc, node.id))) return;
  const name = node.name?.trim() || 'Без имени';
  if (!confirm(`Удалить слой «${name}»? Будет удалено всё его поддерево.`)) return;
  const op = { doc, screen, name, body: { commandId: crypto.randomUUID(), nodeId: node.id }, state: 'ready' };
  nodeDeletions.set(key, op); sendNodeDeletion(op);
});
element('node-delete-retry').addEventListener('click', () => {
  const op = nodeDeletions.get(`${documentId}:${selectedScreen}`);
  if (op?.state === 'uncertain') sendNodeDeletion(op);
});
async function sendNodeDeletion(op) {
  const key = `${op.doc}:${op.screen}`;
  if (nodeDeletions.get(key) !== op || op.state === 'pending') return;
  const epoch = navigationEpoch, screenEpoch = screenContextEpoch, requestToken = token;
  const active = () => screenEpoch === screenContextEpoch && nodeDeletions.get(key) === op && documentId === op.doc && selectedScreen === op.screen && navigationEpoch === epoch && token === requestToken && !element('editor-view').hidden;
  op.state = 'pending'; renderNodeDeletion();
  try {
    const result = await request(`/api/v1/documents/${encodeURIComponent(op.doc)}/commands/delete-node`, { method: 'POST', body: JSON.stringify(op.body) }, undefined, active);
    if (!active()) { op.state = 'uncertain'; return; }
    if (result.code !== 'ACCEPTED' || !Number.isSafeInteger(result.revision) || result.documentId?.toLowerCase() !== op.doc.toLowerCase() || result.commandId?.toLowerCase() !== op.body.commandId.toLowerCase()) throw new TypeError('Некорректное подтверждение');
    let synced = false;
    await run(() => refreshPages(), async signal => { await readPages(signal, pagesOffset, null, active); synced = true; });
    if (active() && synced) { nodeDeletions.delete(key); renderNodeDeletion(); }
    else op.state = 'uncertain';
  } catch (error) {
    if (!active() || error instanceof TypeError || error.name === 'AbortError' || error.status === undefined || error.status >= 500) { op.state = 'uncertain'; return; }
    if (error.status === 403) { nodeDeletions.delete(key); closeInaccessibleDocument(403); return; }
    if (error.code === 'NODE_NOT_FOUND') {
      await run(() => refreshPages(), signal => readPages(signal, pagesOffset, null, active));
      if (!active()) { op.state = 'uncertain'; return; }
      op.error = 'Слой уже удалён другим участником.';
    } else op.error = ({ SCENARIO_IN_USE: 'Слой или его поддерево используется в сценариях. Сначала удалите ссылки сценариев.', SCREEN_VARIANT_IN_USE: 'Слой или его поддерево используется в вариантах. Сначала удалите ссылки вариантов.', INVALID_REPEATER: 'Слой используется повторителем. Сначала удалите зависимость.', INVALID_COMPONENT: 'Слой используется компонентом. Сначала удалите зависимость.' })[error.code] || error.message;
    op.state = 'rejected';
  } finally { if (nodeDeletions.get(key) === op && documentId === op.doc && selectedScreen === op.screen && token === requestToken && !element('editor-view').hidden) renderNodeDeletion(); }
}

function selectedSiblingContext() {
  function find(parent, items) {
    const index = items.findIndex(item => item.id === layerSelection?.id);
    if (index >= 0) return { parent, index, count: items.length };
    for (const item of items) {
      const found = find(item.id, layerChildren.get(item.id) || []);
      if (found) return found;
    }
    return null;
  }
  return selectedScreen && layerSelection ? find(selectedScreen, layerRoots) : null;
}
function renderNodeOrder() {
  const op = nodeMoves.get(`${documentId}:${selectedScreen}`), context = selectedSiblingContext();
  const editable = ['Owner', 'Editor'].includes(documentRole);
  element('node-order').hidden = !editable || !layerSelection;
  element('node-earlier').disabled = !context || context.index === 0 || !!op;
  element('node-later').disabled = !context || context.index === context.count - 1 || !!op;
  element('node-reparent').disabled = !context || !!op;
  element('node-order-retry').hidden = !editable || op?.state !== 'uncertain';
  element('node-order-status').textContent = !editable ? '' : op?.state === 'pending' ? 'Перемещение слоя…' : op?.state === 'uncertain' ? `Результат перемещения неизвестен. Повторите ту же команду для слоя «${op.name}».` : nodeMoveNotices.get(`${documentId}:${selectedScreen}`) || '';
}
function closeNodeReparent() {
  nodeReparentDraft?.controller.abort();
  nodeReparentDraft = null;
  element('node-reparent-form').hidden = true;
  element('node-reparent').setAttribute('aria-expanded', 'false');
}

async function loadNodeReparent() {
  const key = `${documentId}:${selectedScreen}`;
  if (!selectedSiblingContext() || !['Owner', 'Editor'].includes(documentRole) || nodeMoves.has(key)) return;
  closeNodeReparent();
  const doc = documentId, screen = selectedScreen, node = layerSelection.id;
  const epoch = navigationEpoch, screenEpoch = screenContextEpoch, selectionEpoch = layerSelectionEpoch, requestToken = token;
  const controller = new AbortController();
  const draft = { doc, screen, node, controller, targets: new Map() };
  const active = () => nodeReparentDraft === draft && doc === documentId && screen === selectedScreen &&
    node === layerSelection?.id && epoch === navigationEpoch && screenEpoch === screenContextEpoch &&
    selectionEpoch === layerSelectionEpoch && token === requestToken && !element('editor-view').hidden;
  nodeReparentDraft = draft;
  const target = element('node-reparent-target'), status = element('node-reparent-status');
  target.replaceChildren(new Option('Выберите родителя', ''));
  target.disabled = true;
  renderNodeReparentPosition();
  element('node-reparent-reload').hidden = true;
  element('node-reparent-form').hidden = false;
  element('node-reparent').setAttribute('aria-expanded', 'true');
  status.textContent = 'Загрузка родителей слоя…';
  status.focus();
  try {
    const base = `/api/v1/documents/${encodeURIComponent(doc)}/nodes`;
    const items = [];
    let atRevision, total;
    do {
      const query = new URLSearchParams({ screenId: screen, offset: String(items.length), limit: '100', fields: 'parentId,canContainChildren,childCount,name,kind' });
      if (atRevision !== undefined) query.set('revision', String(atRevision));
      const result = await request(`${base}?${query}`, {}, controller.signal, active);
      if (!active()) return;
      if (result.documentId?.toLowerCase() !== doc.toLowerCase() || !Array.isArray(result.items) || !Number.isSafeInteger(result.revision) || !Number.isSafeInteger(result.total) ||
          result.total < items.length || result.items.length > result.total - items.length || (!result.items.length && items.length < result.total) ||
          (atRevision !== undefined && (result.revision !== atRevision || total !== result.total))) throw new TypeError('Некорректный список слоёв.');
      atRevision = result.revision;
      total = result.total;
      items.push(...result.items);
    } while (items.length < total);
    const source = items.find(item => item.id === node);
    if (!source) {
      const notice = 'Слой больше не находится на этом экране.';
      status.textContent = 'Обновление дерева слоёв…';
      const synced = await refreshNodeMoveTree(active);
      if (synced) {
        nodeMoveNotices.set(key, notice + ' Дерево обновлено.');
        renderNodeOrder();
      } else if (active()) {
        status.textContent = notice;
        element('node-reparent-reload').hidden = false;
      }
      return;
    }
    draft.expectedParentId = source.parentId;
    const paths = new Map([[screen, []]]);
    if (source.parentId !== screen) {
      const count = items.filter(item => item.parentId === screen).length;
      draft.targets.set(screen, { label: 'Экран (корень)', count, reveal: [] });
    }
    for (const item of items) {
      const ancestors = paths.get(item.parentId);
      if (!ancestors || paths.has(item.id) || !Number.isSafeInteger(item.childCount) || item.childCount < 0 || typeof item.canContainChildren !== 'boolean') throw new TypeError('Некорректный список слоёв.');
      const path = [...ancestors, item];
      paths.set(item.id, path);
      if (item.canContainChildren && item.id !== source.parentId && !path.some(part => part.id === node)) {
        const label = path.map(part => part.name?.trim() || part.kind).join(' / ');
        draft.targets.set(item.id, { label, count: item.childCount, reveal: path.map(part => part.id) });
      }
    }
    const labels = new Map();
    for (const { label } of draft.targets.values()) labels.set(label, (labels.get(label) ?? 0) + 1);
    for (const [id, { label }] of draft.targets) target.add(new Option(labels.get(label) > 1 ? `${label} · ${id}` : label, id));
    target.disabled = !draft.targets.size;
    status.textContent = target.disabled ? 'На этом экране нет другого подходящего родителя.' : 'Выберите нового родителя и позицию слоя.';
    if (!target.disabled && document.activeElement === status) target.focus();
  } catch (error) {
    if (!active() || error.name === 'AbortError') return;
    if (error.status === 403 || error.code === 'DOCUMENT_NOT_FOUND') { closeInaccessibleDocument(error.status); return; }
    status.textContent = error instanceof TypeError || error instanceof SyntaxError ? 'Не удалось загрузить родителей слоя.' : error.message;
    element('node-reparent-reload').hidden = false;
  }
}

function renderNodeReparentPosition() {
  const target = nodeReparentDraft?.targets.get(element('node-reparent-target').value);
  const position = element('node-reparent-position');
  position.disabled = element('node-reparent-submit').disabled = !target;
  position.max = position.value = target ? String(target.count + 1) : '';
  element('node-reparent-range').textContent = target ? `Доступные позиции: от 1 до ${position.max}.` : '';
}

element('node-reparent').addEventListener('click', loadNodeReparent);
element('node-reparent-reload').addEventListener('click', loadNodeReparent);
element('node-reparent-target').addEventListener('change', renderNodeReparentPosition);
element('node-reparent-cancel').addEventListener('click', () => { closeNodeReparent(); element('node-reparent').focus(); });
element('node-reparent-form').addEventListener('submit', event => {
  event.preventDefault();
  const draft = nodeReparentDraft, targetId = element('node-reparent-target').value;
  const target = draft?.targets.get(targetId), position = element('node-reparent-position').valueAsNumber - 1;
  if (!target || draft.doc !== documentId || draft.screen !== selectedScreen || draft.node !== layerSelection?.id ||
      !Number.isInteger(position) || position < 0 || position > target.count) return;
  startNodeMove(draft.expectedParentId, targetId, position, target.reveal);
  element('node-order-status').focus();
});

function beginNodeMove(delta) {
  const context = selectedSiblingContext();
  if (!context) return;
  const position = context.index + delta;
  if (position < 0 || position >= context.count) return;
  startNodeMove(context.parent, context.parent, position);
}
function startNodeMove(expectedParentId, targetParentId, position, reveal = []) {
  const key = `${documentId}:${selectedScreen}`;
  if (!layerSelection || !['Owner', 'Editor'].includes(documentRole) || nodeMoves.has(key)) return;
  const body = { commandId: crypto.randomUUID(), nodeId: layerSelection.id, expectedParentId, targetParentId, position };
  const op = { doc: documentId, screen: selectedScreen, name: layerSelection.name?.trim() || layerSelection.kind, reveal, body, state: 'ready' };
  closeNodeReparent();
  nodeMoveNotices.delete(key);
  nodeMoves.set(key, op);
  sendNodeMove(op);
}
element('node-earlier').addEventListener('click', () => beginNodeMove(-1));
element('node-later').addEventListener('click', () => beginNodeMove(1));
element('node-order-retry').addEventListener('click', () => {
  const op = nodeMoves.get(`${documentId}:${selectedScreen}`);
  if (op?.state === 'uncertain') sendNodeMove(op);
});
async function refreshNodeMoveTree(active, reveal = []) {
  let synced = false;
  await run(() => refreshPages(), async (signal, current) => {
    try {
      synced = await readPages(signal, pagesOffset, null, active, reveal) === true;
    } catch (error) {
      if (active() && (error.status === 403 || error.code === 'DOCUMENT_NOT_FOUND')) closeInaccessibleDocument(error.status);
      else throw error;
    } finally {
      if (current()) message();
    }
  });
  return synced;
}

async function sendNodeMove(op) {
  const key = `${op.doc}:${op.screen}`;
  if (nodeMoves.get(key) !== op || op.state === 'pending' || !['Owner', 'Editor'].includes(documentRole)) return;
  const epoch = navigationEpoch, screenEpoch = screenContextEpoch, selectionEpoch = layerSelectionEpoch, requestToken = token;
  const context = () => nodeMoves.get(key) === op && documentId === op.doc && selectedScreen === op.screen && screenContextEpoch === screenEpoch && navigationEpoch === epoch && token === requestToken && !element('editor-view').hidden;
  const active = () => context() && layerSelectionEpoch === selectionEpoch;
  op.state = 'pending'; renderNodeOrder();
  try {
    const result = await request(`/api/v1/documents/${encodeURIComponent(op.doc)}/commands/move-node`, { method: 'POST', body: JSON.stringify(op.body) }, undefined, active);
    if (!active()) { op.state = 'uncertain'; return; }
    if (result.code !== 'ACCEPTED' || !Number.isSafeInteger(result.revision) || result.documentId?.toLowerCase() !== op.doc.toLowerCase() || result.commandId?.toLowerCase() !== op.body.commandId.toLowerCase()) throw new TypeError('Некорректное подтверждение');
    const reveal = layerSelection?.id === op.body.nodeId ? op.reveal : [];
    const synced = await refreshNodeMoveTree(active, reveal);
    if (context() && synced) {
      nodeMoves.delete(key);
      if (op.body.expectedParentId !== op.body.targetParentId) nodeMoveNotices.set(key, 'Слой перемещён к новому родителю.');
    } else op.state = 'uncertain';
  } catch (error) {
    if (!active() || error.status === undefined || error.status === 408 || error.status >= 500) { op.state = 'uncertain'; return; }
    if (error.status === 403 || error.code === 'DOCUMENT_NOT_FOUND') { nodeMoves.delete(key); closeInaccessibleDocument(error.status); return; }
    const explanations = {
      NODE_NOT_FOUND: 'Слой уже удалён другим участником.',
      PARENT_NOT_FOUND: 'Новый родитель уже удалён другим участником.',
      INVALID_LAYOUT_CONTEXT: 'Родитель слоя изменился.',
      INVALID_POSITION: 'Эта позиция больше недоступна.',
      CHILDREN_NOT_ALLOWED: 'Новый родитель не может содержать дочерние слои.',
      CYCLE_NOT_ALLOWED: 'Нельзя переместить слой внутрь его собственного поддерева.',
      INVALID_COMPONENT: 'Перемещение нарушит структуру компонента.',
      INVALID_REPEATER: 'Перемещение нарушит структуру повторителя.',
      SCENARIO_IN_USE: 'Перемещение нарушит ссылки сценария.',
      SCREEN_VARIANT_IN_USE: 'Перемещение нарушит ссылки варианта экрана.'
    };
    const notice = explanations[error.code] ?? error.message;
    const refresh = ['NODE_NOT_FOUND', 'PARENT_NOT_FOUND', 'INVALID_LAYOUT_CONTEXT', 'INVALID_POSITION', 'CYCLE_NOT_ALLOWED'].includes(error.code);
    const synced = refresh && await refreshNodeMoveTree(active);
    if ((synced && context()) || active())
      nodeMoveNotices.set(key, notice + (synced ? ' Дерево обновлено.' : ''));
    if (nodeMoves.get(key) === op) nodeMoves.delete(key);
  } finally {
    if (documentId === op.doc && selectedScreen === op.screen && token === requestToken && (navigationEpoch === epoch || nodeMoves.get(key) === op) && !element('editor-view').hidden)
      renderNodeOrder();
  }
}

function renderLayers(focusId) {
  renderNodeDeletion();
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

async function readLayerChildren(parentId, signal, currentRevision, isCurrent) {
  const items = []; let total;
  do {
    const query = new URLSearchParams({ offset: String(items.length), limit: '100', fields: 'name,kind,childCount', revision: String(currentRevision) });
    const result = await request(`/api/v1/documents/${encodeURIComponent(documentId)}/children/${encodeURIComponent(parentId)}?${query}`, {}, signal, isCurrent);
    total = result.total;
    if (!result.items.length && items.length < total) throw new Error('Не удалось загрузить все слои. Обновите страницы.');
    items.push(...result.items);
  } while (items.length < total);
  return items;
}

function layerFailure(error, current) {
  if (error.name === 'AbortError' || current !== layerGeneration) return;
  if (error.status === 403) { closeInaccessibleDocument(403); return; }
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

async function readPages(signal, offset = pagesOffset, targetRevision = null, isCurrent = () => true, reveal = []) {
  const id = documentId, current = generation;
  const valid = () => !signal.aborted && id === documentId && current === generation && isCurrent();
  const base = `/api/v1/documents/${encodeURIComponent(id)}`;
  const query = new URLSearchParams({ offset: String(offset), limit: String(pageSize), fields: 'name,childCount' });
  if (targetRevision !== null) query.set('revision', String(targetRevision));
  const result = await request(`${base}/pages?${query}`, {}, signal, valid);
  if (!valid()) return;
  if (offset && !result.items.length) return readPages(signal, Math.max(0, offset - pageSize), result.revision, isCurrent, reveal);
  const nextRevision = result.revision;
  const page = result.items.some(item => item.id === selectedPage) ? selectedPage : result.items[0]?.id ?? null;
  let screen = page === selectedPage ? selectedScreen : null;
  let screenOffset = page === selectedPage ? screensOffset : 0;
  let screens = { items: [], total: 0 };
  if (page) {
    do {
      screens = await request(`${base}/pages/${encodeURIComponent(page)}/screens?offset=${screenOffset}&limit=${pageSize}&fields=dimensions&revision=${nextRevision}`, {}, signal, valid);
      if (!valid()) return;
      if (!screenOffset || screens.items.length) break;
      screenOffset = Math.max(0, screenOffset - pageSize);
    } while (true);
  }
  if (!screens.items.some(item => item.id === screen)) screen = null;
  const children = new Map(), initialExpansion = new Set(layerExpanded);
  const expanded = new Set(screen === selectedScreen ? [...initialExpansion, ...reveal] : []);
  async function readBranch(parent) {
    const items = await readLayerChildren(parent, signal, nextRevision, valid);
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
  const tokenSnapshot = await readTokens(base, nextRevision, signal, valid);
  const header = await request(`${base}?fields=name&revision=${nextRevision}`, {}, signal, valid);
  if (!valid()) return;
  // An expansion can change while the pinned tree is loading. Stage it again
  // rather than discard that interaction or mix children from two revisions.
  if (initialExpansion.size !== layerExpanded.size || [...initialExpansion].some(id => !layerExpanded.has(id)))
    return readPages(signal, offset, nextRevision, isCurrent, reveal);
  const selection = layerSelection;
  resetLayers();
  pagesOffset = offset; pagesItems = result.items; pagesTotal = result.total; selectedPage = page;
  screensOffset = screenOffset; screensItems = screens.items; screensTotal = screens.total; selectedScreen = screen;
  layerRoots = roots; layerChildren = children; layerExpanded = expanded;
  layerController = new AbortController();
  renderPages(); renderScreens(); renderLayers();
  revision = nextRevision;
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
  return true;
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
async function readAllTokenPages(path, revision, signal, isCurrent) {
  let items = [], total;
  do {
    const result = await request(`${path}?revision=${revision}&offset=${items.length}&limit=100`, {}, signal, isCurrent);
    if (result.revision !== revision || !Array.isArray(result.items) || !Number.isInteger(result.total)) throw new Error('Некорректный ответ о токенах.');
    items.push(...result.items); total = result.total;
    if (!result.items.length && items.length < total) throw new Error('Неполный ответ о токенах.');
  } while (items.length < total);
  return items;
}
async function readTokens(base, atRevision, signal, isCurrent) {
  const items = await readAllTokenPages(`${base}/tokens`, atRevision, signal, isCurrent);
  const selection = selectedToken;
  const usages = selection && items.some(item => item.id === selection)
    ? await readAllTokenPages(`${base}/tokens/${encodeURIComponent(selection)}/usages`, atRevision, signal, isCurrent) : [];
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
