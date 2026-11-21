import { token, navigationEpoch } from './session.js';

export function createScenarios({
  element, request, pageSize, workspace, findLayer, reloadPages, findRole, setDocumentRole, closeInaccessibleDocument
}) {
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
    if (!workspace.documentId || !workspace.selectedScreen || !workspace.layerSelection || !element('scenario-variant').options.length || !Number.isSafeInteger(workspace.revision)) { renderScenarioCreate(); return; }
    const current = capabilityGeneration, doc = workspace.documentId, screen = workspace.selectedScreen, node = workspace.layerSelection.id, atRevision = workspace.revision, target = element('scenario-target').value, variant = element('scenario-variant').value, dataset = element('scenario-dataset').value, demoNode = element('scenario-demo-node').value.trim().toLowerCase(), demoValue = element('scenario-demo-null').checked ? null : element('scenario-demo-value').value, requestToken = token, epoch = navigationEpoch;
    const valid = () => current === capabilityGeneration && doc === workspace.documentId && screen === workspace.selectedScreen && node === workspace.layerSelection?.id && atRevision === workspace.revision && target === element('scenario-target').value && variant === element('scenario-variant').value && dataset === element('scenario-dataset').value && demoNode === element('scenario-demo-node').value.trim().toLowerCase() && demoValue === (element('scenario-demo-null').checked ? null : element('scenario-demo-value').value) && requestToken === token && epoch === navigationEpoch && !element('editor-view').hidden;
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
    const doc = workspace.documentId, screen = workspace.selectedScreen, atRevision = workspace.revision, requestToken = token, epoch = navigationEpoch, offset = scenariosOffset;
    if (!doc || !screen || !Number.isSafeInteger(atRevision)) { resetScenarios(); return; }
    scenariosKey = `${doc}:${screen}:${atRevision}`;
    const valid = () => !controller.signal.aborted && current === scenariosGeneration && doc === workspace.documentId && screen === workspace.selectedScreen && atRevision === workspace.revision && token === requestToken && epoch === navigationEpoch && !element('editor-view').hidden;
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
        if (['Owner', 'Editor'].includes(workspace.documentRole)) {
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
    const op = scenarioOperations.get(scenarioKey(workspace.documentId, workspace.selectedScreen));
    const editable = ['Owner', 'Editor'].includes(workspace.documentRole);
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
    if (doc !== workspace.documentId || screen !== workspace.selectedScreen || !['Owner', 'Editor'].includes(workspace.documentRole) || scenarioOperations.has(key) || !Number.isSafeInteger(workspace.revision)) return;
    if (!confirm(`Удалить сценарий «${scenarioId}»?`)) return;
    const op = { body: { commandId: crypto.randomUUID(), scenarioId, expectedRevision: workspace.revision }, state: 'ready' };
    scenarioOperations.set(key, op); sendScenarioDeletion(doc, screen, op);
  }
  async function sendScenarioDeletion(doc, screen, op) {
    const key = scenarioKey(doc, screen), epoch = navigationEpoch, requestToken = token, context = scenariosGeneration;
    if (op.state === 'pending' || !['Owner', 'Editor'].includes(workspace.documentRole)) return;
    const active = () => doc === workspace.documentId && screen === workspace.selectedScreen && token === requestToken && epoch === navigationEpoch && context === scenariosGeneration && !element('editor-view').hidden;
    op.state = 'pending'; if (active()) renderScenarioCommand();
    try {
      const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/commands/delete-scenario`, { method: 'POST', body: JSON.stringify(op.body) });
      if (result.code !== 'ACCEPTED' || !Number.isSafeInteger(result.revision) || result.revision <= op.body.expectedRevision || result.documentId?.toLowerCase() !== doc.toLowerCase() || result.commandId?.toLowerCase() !== op.body.commandId.toLowerCase()) throw new TypeError('Некорректное подтверждение');
      if (scenarioOperations.get(key) !== op) return;
      if (!active()) { op.state = 'uncertain'; return; }
      scenarioOperations.delete(key);
      const target = Math.max(workspace.revision, result.revision);
      await reloadPages(target);
      if (doc === workspace.documentId && screen === workspace.selectedScreen && token === requestToken && epoch === navigationEpoch && !element('editor-view').hidden) element('scenario-command-status').textContent = 'Удаление сценария подтверждено.';
    } catch (error) {
      if (scenarioOperations.get(key) !== op) return;
      if (!active() || !error.status || error.status >= 500) op.state = 'uncertain';
      else {
        scenarioOperations.delete(key);
        renderScenarioCommand();
        element('scenario-command-error').textContent = error.code === 'REVISION_CONFLICT' ? 'Документ изменился. Обновите страницы и повторите удаление.' : error.status === 403 || error.status === 404 && error.code === 'DOCUMENT_NOT_FOUND' ? 'Доступ к документу утрачен или недостаточен.' : `Удаление отклонено: ${error.message}`;
      }
    } finally { if (doc === workspace.documentId && screen === workspace.selectedScreen && token === requestToken && !element('editor-view').hidden && scenarioOperations.get(key) === op) renderScenarioCommand(); }
  }
  element('scenario-command-retry').addEventListener('click', () => {
    const op = scenarioOperations.get(scenarioKey(workspace.documentId, workspace.selectedScreen));
    if (op?.state !== 'uncertain') return;
    const send = { create: sendScenarioCreation, update: sendScenarioUpdate, delete: sendScenarioDeletion };
    send[op.kind ?? 'delete'](workspace.documentId, workspace.selectedScreen, op);
  });


  let scenarioDraft = null;
  let scenarioView = null;
  const canEditScenarios = () => !!token && ['Owner', 'Editor'].includes(workspace.documentRole) && !element('editor-view').hidden;
  const scenarioDraftCurrent = draft => scenarioDraft === draft && draft.view === scenarioView &&
    draft.doc === workspace.documentId && draft.screen === workspace.selectedScreen && draft.revision === workspace.revision && canEditScenarios();

  function resetScenarioEditor(restoreFocus = false) {
    const draft = scenarioDraft;
    scenarioDraft = null;
    draft?.controller.abort();
    element('scenario-edit').hidden = true;
    element('scenario-action-editor').hidden = true;
    if (restoreFocus) draft?.opener.focus();
  }

  function bindScenarioView() {
    if (!scenarioView || scenarioView.doc !== workspace.documentId || scenarioView.screen !== workspace.selectedScreen || scenarioView.epoch !== navigationEpoch) {
      scenarioView?.controller.abort();
      scenarioView = { doc: workspace.documentId, screen: workspace.selectedScreen, epoch: navigationEpoch, controller: new AbortController() };
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
    element('scenario-edit-use-layer').disabled = !workspace.layerSelection || workspace.layerSelection.id === draft.scenario.nodeId;
    element('scenario-edit-demo-use-layer').disabled = !workspace.layerSelection;
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
    if (!scenarioDraft || !workspace.layerSelection) return;
    scenarioDraft.scenario.nodeId = workspace.layerSelection.id;
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
    if (!workspace.layerSelection) return;
    element('scenario-edit-demo-node').value = workspace.layerSelection.id;
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
    const current = () => view === scenarioView && doc === workspace.documentId && screen === workspace.selectedScreen && op.token === token && canEditScenarios();
    op.state = 'pending';
    renderScenarioCommand();
    try {
      const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/commands/update-scenario`, { method: 'POST', body: JSON.stringify(op.body) }, view.controller.signal);
      if (result.code !== 'ACCEPTED' || !Number.isSafeInteger(result.revision) || result.revision <= op.body.expectedRevision || result.documentId?.toLowerCase() !== doc.toLowerCase() || result.commandId?.toLowerCase() !== op.body.commandId.toLowerCase())
        throw new TypeError('Некорректное подтверждение');
      if (scenarioOperations.get(key) !== op) return;
      if (!current()) { op.state = 'uncertain'; return; }
      resetScenarioEditor();
      await reloadPages(null, current);
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
        await reloadPages(null, current);
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
          setDocumentRole(role);
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
      if (doc === workspace.documentId && screen === workspace.selectedScreen && op.token === token && canEditScenarios() && scenarioOperations.get(key) === op)
        renderScenarioCommand();
    }
  }


  function renderScenarioCreate() {
    const editable = !!workspace.selectedScreen && ['Owner', 'Editor'].includes(workspace.documentRole);
    const op = scenarioOperations.get(scenarioKey(workspace.documentId, workspace.selectedScreen));
    const needsTarget = ['navigate', 'openOverlay'].includes(element('scenario-action').value);
    element('scenario-create').hidden = !editable;
    element('scenario-source').textContent = workspace.layerSelection ? `Исходный слой: ${workspace.layerSelection.name?.trim() || 'Без имени'} — ${workspace.layerSelection.kind}` : (workspace.hasLayers ? 'Выберите исходный слой в дереве.' : 'На экране нет слоёв для сценария.');
    element('scenario-target-fields').hidden = !needsTarget;
    element('scenario-demo-value').disabled = !!op || element('scenario-demo-null').checked;
    element('scenario-demo-node').disabled = element('scenario-demo-null').disabled = !!op;
    element('scenario-demo-use-layer').disabled = !!op || !workspace.layerSelection;
    element('scenario-create-submit').disabled = !editable || !!op || !workspace.layerSelection || !scenarioCapabilities || !element('scenario-event').value || !element('scenario-action').value || (needsTarget && !element('scenario-target').value);
    element('scenario-event').disabled = element('scenario-action').disabled = element('scenario-target').disabled = element('scenario-variant').disabled = element('scenario-dataset').disabled = !!op;
  }
  element('scenario-action').addEventListener('change', renderScenarioCreate);
  element('scenario-target').addEventListener('change', loadScenarioCapabilities);
  element('scenario-variant').addEventListener('change', loadScenarioCapabilities);
  element('scenario-dataset').addEventListener('change', loadScenarioCapabilities);
  for (const id of ['scenario-demo-node', 'scenario-demo-value']) element(id).addEventListener('input', loadScenarioCapabilities);
  element('scenario-demo-use-layer').addEventListener('click', () => { if (workspace.layerSelection) { element('scenario-demo-node').value = workspace.layerSelection.id; loadScenarioCapabilities(); } });
  element('scenario-demo-null').addEventListener('change', loadScenarioCapabilities);
  element('scenario-dataset-retry').addEventListener('click', () => { if (workspace.documentId && workspace.selectedScreen) loadScenarios(); });
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
    const doc = workspace.documentId, screen = workspace.selectedScreen, key = scenarioKey(doc, screen), target = element('scenario-target').value, source = workspace.layerSelection?.id, eventValue = Number(element('scenario-event').value), actionType = element('scenario-action').value;
    const needsTarget = ['navigate', 'openOverlay'].includes(actionType);
    if (!['Owner', 'Editor'].includes(workspace.documentRole) || !screen || !source || !scenarioCapabilities || !scenarioCapabilities.actions.includes(actionType) || scenarioCapabilities.documentId !== doc || scenarioCapabilities.nodeId !== source || scenarioCapabilities.revision !== workspace.revision || scenarioCapabilities.screenId !== screen || (scenarioCapabilities.variantId || '') !== element('scenario-variant').value || (scenarioCapabilities.datasetId ?? '') !== element('scenario-dataset').value || (actionType === 'selectDataset' && !scenarioDatasetsReady) || (scenarioCapabilities.demoNodeId ?? '') !== element('scenario-demo-node').value.trim().toLowerCase() || scenarioCapabilities.demoValue !== (element('scenario-demo-null').checked ? null : element('scenario-demo-value').value) || (scenarioCapabilities.targetId || '') !== target || (needsTarget && !target) || !scenarioCapabilities.events.includes(eventValue) || scenarioOperations.has(key) || !Number.isSafeInteger(workspace.revision)) return;
    const action = actionType === 'setDemoValue' ? { type: actionType, nodeId: element('scenario-demo-node').value.trim(), value: element('scenario-demo-null').checked ? null : element('scenario-demo-value').value } : needsTarget ? { type: actionType, screenId: target } : actionType === 'showVariant' ? { type: actionType, variantId: element('scenario-variant').value || null } : actionType === 'selectDataset' ? { type: actionType, datasetId: element('scenario-dataset').value || null } : { type: actionType };
    const op = { kind: 'create', body: { commandId: crypto.randomUUID(), scenario: { id: crypto.randomUUID(), screenId: screen, nodeId: source, event: eventValue, actions: [action] } }, state: 'ready', revision: workspace.revision };
    scenarioOperations.set(key, op); sendScenarioCreation(doc, screen, op);
  });
  async function sendScenarioCreation(doc, screen, op) {
    const key = scenarioKey(doc, screen), epoch = navigationEpoch, requestToken = token, context = scenariosGeneration;
    if (op.state === 'pending' || !['Owner', 'Editor'].includes(workspace.documentRole)) return;
    const active = () => doc === workspace.documentId && screen === workspace.selectedScreen && token === requestToken && epoch === navigationEpoch && context === scenariosGeneration && !element('editor-view').hidden;
    op.state = 'pending'; if (active()) renderScenarioCommand();
    try {
      const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/commands/create-scenario`, { method: 'POST', body: JSON.stringify(op.body) });
      if (result.code !== 'ACCEPTED' || !Number.isSafeInteger(result.revision) || result.revision <= op.revision || result.documentId?.toLowerCase() !== doc.toLowerCase() || result.commandId?.toLowerCase() !== op.body.commandId.toLowerCase()) throw new TypeError('Некорректное подтверждение');
      if (scenarioOperations.get(key) !== op) return;
      if (!active()) { op.state = 'uncertain'; return; }
      scenarioOperations.delete(key);
      await reloadPages(Math.max(workspace.revision, result.revision));
      if (doc === workspace.documentId && screen === workspace.selectedScreen && token === requestToken && epoch === navigationEpoch && !element('editor-view').hidden) element('scenario-command-status').textContent = 'Создание сценария подтверждено.';
    } catch (error) {
      if (scenarioOperations.get(key) !== op) return;
      if (!active() || !error.status || error.status >= 500) op.state = 'uncertain';
      else {
        scenarioOperations.delete(key); renderScenarioCommand();
        element('scenario-command-error').textContent = error.status === 403 || error.status === 404 && error.code === 'DOCUMENT_NOT_FOUND' ? 'Доступ к документу утрачен или недостаточен.' : `Создание отклонено: ${error.message}`;
      }
    } finally { if (doc === workspace.documentId && screen === workspace.selectedScreen && token === requestToken && !element('editor-view').hidden && scenarioOperations.get(key) === op) renderScenarioCommand(); }
  }

  element('scenarios-retry').addEventListener('click', loadScenarios);
  element('scenarios-previous').addEventListener('click', () => { scenariosOffset = Math.max(0, scenariosOffset - pageSize); loadScenarios(); });
  element('scenarios-next').addEventListener('click', () => { if (scenariosOffset + pageSize < scenariosTotal) { scenariosOffset += pageSize; loadScenarios(); } });

  function refresh(screen) {
    const nextKey = screen ? `${workspace.documentId}:${screen}:${workspace.revision}` : null;
    if (scenariosKey === nextKey) return;
    const offset = screen === workspace.selectedScreen ? scenariosOffset : 0;
    resetScenarios();
    scenariosOffset = offset;
    if (screen) loadScenarios();
  }

  function clearLayerSelection() {
    clearScenarioCapabilities('Возможности сценария недоступны.');
    renderScenarioCreate();
  }

  function onLayerSelected() {
    loadScenarioCapabilities();
    renderScenarioEditor();
  }

  return {
    reset: resetScenarios, refresh, clearLayerSelection, onLayerSelected,
    clearCommands: () => scenarioOperations.clear()
  };
}
