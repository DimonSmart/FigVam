import { token, navigationEpoch } from './session.js';
import { layerDisplayName } from './layers.js';
import { readInteractionCatalog, interactionObjectName } from './interaction-catalog.js';
import { createInteractionEditor, eventLabels, actionLabels } from './interaction-editor.js';

export function createScenarios({
  element, request, pageSize, workspace, findLayer, setInteractiveNodes, selectSource,
  reloadPages, findRole, setDocumentRole, closeInaccessibleDocument
}) {
  let controller = null, generation = 0, offset = 0, catalog = null, scenarios = null, key = null;
  let loadState = 'empty', notice = '', errorNotice = '', leave = null;
  const operations = new Map();
  const context = () => ({
    doc: workspace.documentId, screen: workspace.selectedScreen, node: workspace.layerSelection?.id ?? null,
    revision: workspace.revision, token, epoch: navigationEpoch,
    editable: !!token && ['Owner', 'Editor'].includes(workspace.documentRole) && !element('editor-view').hidden
  });
  const operationKey = c => c.doc + '/' + c.screen;
  const currentOperation = () => operations.get(operationKey(context()));
  const opPending = () => ['pending', 'uncertain'].includes(currentOperation()?.state);
  const sameScreen = c => c.doc === workspace.documentId && c.screen === workspace.selectedScreen && c.token === token &&
    c.epoch === navigationEpoch && !element('editor-view').hidden;
  const name = (kind, id) => interactionObjectName(catalog, kind, id);
  function sourceName(id) {
    const node = catalog?.nodes.find(n => n.id === id) ?? findLayer(id);
    if (!node) return 'Элемент недоступен';
    const display = layerDisplayName(node);
    return display.source === 'missing' ? node.kind : display.text;
  }
  const description = scenario => sourceName(scenario.nodeId) + ' · ' + (eventLabels[scenario.event] ?? 'Неизвестное событие');
  function actionText(action) {
    const label = actionLabels[action.type] ?? 'Неизвестное действие';
    switch (action.type) {
      case 'navigate': case 'openOverlay': return label + ' · ' + name('screens', action.screenId);
      case 'showVariant': return label + ' · ' + (action.variantId === null ? 'Базовое состояние' : name('variants', action.variantId));
      case 'selectDataset': return label + ' · ' + (action.datasetId === null ? 'Без датасета' : name('datasets', action.datasetId));
      case 'setDemoValue': return label + ' · ' + name('nodes', action.nodeId) + ' · ' + (action.value === null ? 'null' : action.value === '' ? 'Пустая строка' : 'Значение задано');
      default: return label;
    }
  }
  const editor = createInteractionEditor({
    element, request, current: context, catalog: () => catalog, sourceName,
    submit: (draft, scenario) => begin(draft.creating ? 'create' : 'update', scenario, draft.revision),
    pending: opPending, onClose: () => render()
  });
  const dialog = element('scenario-leave-dialog');
  function closeDialog() { if (dialog.open) dialog.close(); }
  function requestLeave(next) {
    if (!editor.draft) return true;
    if (opPending()) {
      // The immutable command is kept independently of the inspector and may be retried on return.
      editor.close(); return true;
    }
    if (!editor.dirty()) { editor.close(); return true; }
    leave = next;
    element('scenario-leave-save').disabled = !editor.canSave();
    if (!dialog.open) dialog.showModal();
    return false;
  }
  element('scenario-leave-stay').addEventListener('click', () => { leave = null; closeDialog(); });
  dialog.addEventListener('cancel', () => { leave = null; });
  element('scenario-leave-discard').addEventListener('click', () => {
    const next = leave; leave = null; closeDialog(); editor.close(); next?.();
  });
  element('scenario-leave-save').addEventListener('click', () => {
    if (editor.save()) closeDialog();
  });

  function render() {
    const c = context(), op = currentOperation(), selected = workspace.layerSelection;
    const list = element('scenarios-list');
    element('scenarios-title').textContent = selected ? sourceName(selected.id) + ' · ' + selected.kind :
      c.screen ? 'Взаимодействия · ' + (catalog?.screens.find(s => s.id === c.screen)?.name || 'Экран') : 'Взаимодействия';
    element('scenario-create').hidden = !c.editable || !c.node || loadState !== 'ready' || !!editor.draft;
    element('scenario-create').disabled = opPending();
    element('scenario-command-status').textContent = op?.state === 'pending' ? 'Сохранение изменений…' : notice;
    element('scenario-command-error').textContent = op?.state === 'uncertain' ? 'Результат команды неизвестен. Повторите ту же команду.' : errorNotice;
    element('scenario-command-retry').hidden = !c.editable || op?.state !== 'uncertain';
    element('scenario-command-retry').textContent = op?.kind === 'delete' ? 'Повторить удаление сценария' : 'Повторить сохранение взаимодействия';
    element('scenarios-retry').hidden = loadState !== 'error';
    element('scenarios-error').textContent = loadState === 'error' ? 'Не удалось загрузить взаимодействия. Повторите запрос.' : '';
    element('scenarios-number').textContent = '';
    element('scenarios-previous').disabled = element('scenarios-next').disabled = true;
    list.replaceChildren();
    if (loadState !== 'ready') {
      element('scenarios-status').textContent = loadState === 'loading' ? 'Загрузка сценариев…' :
        loadState === 'error' ? 'Не удалось загрузить сценарии.' : 'Выберите экран.';
      editor.refreshControls(); return;
    }
    const visible = c.node ? scenarios.filter(s => s.nodeId === c.node) : scenarios;
    if (offset >= visible.length) offset = Math.max(0, Math.floor((visible.length - 1) / pageSize) * pageSize);
    const items = visible.slice(offset, offset + pageSize);
    element('scenarios-status').textContent = visible.length ? 'Взаимодействия: ' + visible.length :
      c.node ? 'Нет взаимодействий. Добавьте взаимодействие, чтобы определить поведение элемента.' : 'Сценариев для выбранного экрана нет.';
    element('scenarios-number').textContent = visible.length ? (offset + 1) + '–' + (offset + items.length) + ' из ' + visible.length : '';
    element('scenarios-previous').disabled = offset === 0;
    element('scenarios-next').disabled = offset + items.length >= visible.length;
    for (const scenario of items) {
      const card = document.createElement('li'), title = document.createElement('p'), actions = document.createElement('ol');
      card.dataset.scenarioId = scenario.id;
      title.textContent = c.node ? eventLabels[scenario.event] : description(scenario);
      if (!c.node) {
        const source = catalog.nodes.find(n => n.id === scenario.nodeId && n.screenId === c.screen);
        if (source) {
          const select = document.createElement('button'); select.type = 'button'; select.textContent = description(scenario);
          select.addEventListener('click', () => selectSource(source, catalog.nodes.filter(n => n.screenId === c.screen)));
          title.replaceChildren(select);
        }
      }
      actions.setAttribute('aria-label', 'Действия по порядку');
      for (const action of scenario.actions) {
        const item = document.createElement('li'); item.textContent = actionText(action); actions.append(item);
      }
      card.append(title, actions);
      if (c.editable && c.node) {
        const edit = document.createElement('button'), remove = document.createElement('button');
        edit.type = remove.type = 'button'; edit.textContent = 'Изменить'; remove.textContent = 'Удалить';
        edit.setAttribute('aria-label', 'Изменить сценарий ' + description(scenario));
        remove.setAttribute('aria-label', 'Удалить сценарий ' + description(scenario));
        edit.disabled = remove.disabled = opPending() || !!editor.draft;
        edit.addEventListener('click', () => { editor.open(scenario, edit); render(); });
        remove.addEventListener('click', () => {
          if (confirm('Удалить взаимодействие «' + description(scenario) + '»?')) begin('delete', scenario, c.revision);
        });
        card.append(edit, remove);
      }
      list.append(card);
    }
    editor.refreshControls();
  }

  async function readAll(c, signal) {
    const items = [];
    let total;
    do {
      const query = new URLSearchParams({ screenId: c.screen, revision: String(c.revision), offset: String(items.length), limit: String(pageSize) });
      const result = await request('/api/v1/documents/' + encodeURIComponent(c.doc) + '/scenarios?' + query, {}, signal);
      if (result.documentId !== c.doc || result.revision !== c.revision || result.offset !== items.length ||
          result.limit !== pageSize || !Number.isSafeInteger(result.total) || !Array.isArray(result.items) ||
          result.total < items.length + result.items.length || (!result.items.length && items.length < result.total) ||
          (total !== undefined && total !== result.total)) throw new TypeError('Некорректный ответ о сценариях');
      for (const s of result.items) {
        if (s.screenId !== c.screen || typeof s.id !== 'string' || typeof s.nodeId !== 'string' ||
            !Number.isInteger(s.event) || !eventLabels[s.event] || !Array.isArray(s.actions))
          throw new TypeError('Некорректное взаимодействие');
      }
      items.push(...result.items); total = result.total;
    } while (items.length < total);
    return items;
  }

  async function load() {
    controller?.abort(); controller = new AbortController();
    const c = context(), version = ++generation, signal = controller.signal;
    if (!c.doc || !c.screen || !Number.isSafeInteger(c.revision)) { reset(); return; }
    key = c.doc + ':' + c.screen + ':' + c.revision;
    const valid = () => version === generation && !signal.aborted && sameScreen(c) && workspace.revision === c.revision;
    scenarios = catalog = null; loadState = 'loading';
    setInteractiveNodes([]); render();
    try {
      const [items, objects] = await Promise.all([readAll(c, signal), readInteractionCatalog(request, c.doc, c.revision, signal)]);
      if (!valid()) return;
      scenarios = items; catalog = objects; loadState = 'ready';
      setInteractiveNodes(items.map(s => s.nodeId)); render();
    } catch (error) {
      if (!valid()) return;
      if (error.status === 403 || error.code === 'DOCUMENT_NOT_FOUND') {
        const role = await findRole(c.doc, signal).catch(() => undefined);
        if (!valid()) return;
        if (role === null || error.code === 'DOCUMENT_NOT_FOUND') { closeInaccessibleDocument(error.status); return; }
      }
      loadState = 'error'; render();
    }
  }

  function reset() {
    controller?.abort(); generation++; controller = null;
    key = null; catalog = scenarios = null; offset = 0; loadState = 'empty'; notice = errorNotice = '';
    leave = null; closeDialog(); editor.close(); setInteractiveNodes([]); render();
  }
  function refresh(screen) {
    if (!screen) { reset(); return; }
    const next = workspace.documentId + ':' + screen + ':' + workspace.revision;
    if (next === key) { editor.revisionChanged(); render(); return; }
    notice = errorNotice = '';
    editor.revisionChanged();
    load();
  }
  function onSelectionChanged() {
    offset = 0;
    if (editor.draft && editor.draft.scenario.nodeId !== context().node) editor.revisionChanged();
    render();
  }
  element('scenario-create').addEventListener('click', () => {
    const c = context();
    if (!c.editable || !c.node || loadState !== 'ready' || opPending()) return;
    editor.open({ id: crypto.randomUUID(), screenId: c.screen, nodeId: c.node, event: null, actions: [] }, element('scenario-create'), true);
    render();
  });
  element('scenario-edit-reload').addEventListener('click', () => {
    const old = editor.draft;
    if (!old || loadState !== 'ready') return;
    const latest = scenarios.find(s => s.id === old.scenario.id);
    editor.close();
    if (latest && context().node === latest.nodeId && context().editable) editor.open(latest, null);
    else if (!old.creating) errorNotice = 'Взаимодействие больше недоступно.';
    render();
  });
  element('scenarios-retry').addEventListener('click', load);
  element('scenarios-previous').addEventListener('click', () => { offset = Math.max(0, offset - pageSize); render(); });
  element('scenarios-next').addEventListener('click', () => { offset += pageSize; render(); });

  function begin(kind, scenario, revision) {
    const c = context(), k = operationKey(c);
    if (!c.editable || c.revision !== revision || operations.has(k)) return;
    const body = { commandId: crypto.randomUUID(), expectedRevision: revision,
      ...(kind === 'delete' ? { scenarioId: scenario.id } : { scenario: structuredClone(scenario) }) };
    const op = { kind, body, state: 'ready', token: c.token, doc: c.doc, screen: c.screen };
    operations.set(k, op); notice = errorNotice = ''; send(op);
  }
  const commandMessages = { create: 'Создание сценария подтверждено.', update: 'Изменение сценария подтверждено.', delete: 'Удаление сценария подтверждено.' };
  const sanitize = value => String(value ?? '').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'объект');
  async function send(op) {
    const c = context(), k = operationKey(op);
    if (!c.editable || op.token !== token || op.doc !== c.doc || op.screen !== c.screen || operations.get(k) !== op || op.state === 'pending') return;
    const active = () => sameScreen(c) && operations.get(k) === op;
    op.state = 'pending'; render();
    try {
      const result = await request('/api/v1/documents/' + encodeURIComponent(op.doc) + '/commands/' + op.kind + '-scenario',
        { method: 'POST', body: JSON.stringify(op.body) });
      if (result.status !== 'ACCEPTED' || result.documentId !== op.doc || result.commandId !== op.body.commandId ||
          !Number.isSafeInteger(result.revision) || result.revision <= op.body.expectedRevision)
        throw new TypeError('Некорректное подтверждение');
      if (operations.get(k) !== op) return;
      if (!active()) { op.state = 'uncertain'; return; }
      await reloadPages(Math.max(workspace.revision, result.revision), active);
      if (!active() || workspace.revision < result.revision) { op.state = 'uncertain'; return; }
      operations.delete(k);
      const next = leave; leave = null; closeDialog(); editor.close();
      notice = commandMessages[op.kind]; errorNotice = '';
      render(); next?.();
    } catch (error) {
      if (operations.get(k) !== op) return;
      if (!active() || !error.status || error.status === 408 || error.status >= 500) { op.state = 'uncertain'; return; }
      operations.delete(k); leave = null; closeDialog();
      if (error.code === 'REVISION_CONFLICT') {
        await reloadPages(null, () => sameScreen(c));
        if (!sameScreen(c)) return;
        editor.revisionChanged();
        errorNotice = 'Документ изменился. Черновик не сохранён.';
      } else if (error.status === 403 || error.code === 'DOCUMENT_NOT_FOUND') {
        const role = error.code === 'DOCUMENT_NOT_FOUND' ? null : await findRole(op.doc).catch(() => undefined);
        if (!sameScreen(c)) return;
        if (role === null) { closeInaccessibleDocument(error.status); return; }
        if (role === 'Viewer') setDocumentRole(role);
        errorNotice = 'Доступ к документу утрачен или недостаточен.';
      } else {
        errorNotice = 'Команда отклонена: ' + sanitize(error.message);
        if (!editor.draft && op.kind !== 'delete' && c.node === op.body.scenario.nodeId && workspace.revision === op.body.expectedRevision)
          editor.open(op.body.scenario, null, op.kind === 'create');
      }
      render();
    } finally {
      if (sameScreen(c)) render();
    }
  }
  element('scenario-command-retry').addEventListener('click', () => {
    const op = currentOperation(); if (op?.state === 'uncertain') send(op);
  });
  return {
    reset, refresh, retainAfterNodeEdit: refresh, clearLayerSelection: onSelectionChanged, onLayerSelected: onSelectionChanged,
    requestLeave, hasDirtyDraft: editor.dirty,
    clearCommands() { operations.clear(); editor.close(); }
  };
}
