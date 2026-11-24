import { createLayerDrag, resolveLayerDrop } from './layer-drag.js';

// Derived layer captions are for display only and never change the saved node name.
export function layerDisplayName(item) {
  const explicit = item.name?.trim();
  if (explicit) return { text: explicit, source: 'explicit', origin: 'Имя слоя' };

  const props = item.properties ?? {};
  function excerpt(key) {
    const value = props[key];
    if (value?.type !== 'string' || typeof value.value !== 'string') return null;
    const line = value.value.split(/\r\n|\r|\n/, 1)[0].replace(/\s+/g, ' ').trim();
    if (!line) return null;
    return line.length > 48 ? line.slice(0, 47).trimEnd() + '…' : line;
  }
  const keys = {
    Text: [['text', 'Текст элемента']],
    Button: [['text', 'Текст кнопки']],
    TextInput: [
      ['placeholder', 'Подсказка поля'],
      ...(props.inputType?.value === 'Password' ? [] : [['value', 'Значение поля']])
    ],
    Image: [['altText', 'Альтернативный текст']]
  };
  for (const [key, origin] of keys[item.kind] ?? []) {
    const text = excerpt(key);
    if (text) return { text, source: 'inferred', origin };
  }
  return { text: 'Без имени', source: 'missing', origin: 'Имя слоя не задано' };
}

export function createLayers({
  element, request, workspace, refreshPages, runPageRefresh, readCurrentPages,
  closeInaccessibleDocument, message, onSelectionCleared, onLayerSelected, beforeSelectionChange = () => true
}) {
  let layerController = null, layerGeneration = 0, layerSelection = null;
  let nodeReadGeneration = 0, nodeMetadata = null;
  const nodeOperations = new Map();
  const nodeDeletions = new Map();
  const nodeMoves = new Map();
  const nodeMoveNotices = new Map();
  let layerSelectionEpoch = 0;
  let screenContextEpoch = 0;
  let layerRoots = [], layerExpanded = new Set(), layerChildren = new Map();
  let interactiveNodes = new Set();

  function reset() {
    drag.cancel();
    layerController?.abort(); layerController = null; layerGeneration++;
    layerSelection = null; interactiveNodes = new Set(); layerRoots = []; layerExpanded = new Set(); layerChildren = new Map();
    onSelectionCleared();
    element('layers').replaceChildren();
    element('layers-status').textContent = 'Выберите экран.';
    element('inspector-selection').textContent = 'Выберите слой.';
    nodeReadGeneration++; nodeMetadata = null; renderNodeMetadata();
  }

  function selectLayer(item) {
    const changed = layerSelection?.id !== item.id;
    if (changed) layerSelectionEpoch++;
    layerSelection = item;
    if (changed || nodeMetadata?.id !== item.id) loadNodeMetadata();
    if (changed) onLayerSelected();
    if (!changed && nodeMetadata?.id === item.id && nodeMetadata.name !== item.name) {
      nodeMetadata.name = item.name;
      renderNodeMetadata();
    }
    const caption = `Слой: ${item.name?.trim() || 'Без имени'} · ${item.kind} · ID: ${item.id}`;
    if (element('inspector-selection').textContent !== caption)
      element('inspector-selection').textContent = caption;
    renderNodeOrder();
    for (const row of element('layers').querySelectorAll('[role=treeitem]')) {
      const selected = String(row.dataset.id === item.id);
      if (row.getAttribute('aria-selected') !== selected) row.setAttribute('aria-selected', selected);
    }
  }

  function nodeOperationKey(doc, node) { return `${doc}:${node}`; }
  function renderNodeDeletion() {
    renderNodeOrder();
    let op = nodeDeletions.get(`${workspace.documentId}:${workspace.selectedScreen}`);
    const editable = ['Owner', 'Editor'].includes(workspace.documentRole);
    element('node-delete').hidden = !layerSelection || !editable;
    element('node-delete').disabled = !!op && op.state !== 'rejected' || !!(layerSelection && nodeOperations.get(nodeOperationKey(workspace.documentId, layerSelection.id)));
    element('node-delete-retry').hidden = !editable || op?.state !== 'uncertain';
    element('node-delete-status').textContent = op?.state === 'pending' ? 'Удаление слоя…' : op?.state === 'uncertain' ? `Результат удаления слоя «${op.name}» неизвестен. Повторите ту же команду.` : op?.error || '';
  }
  function renderNodeMetadata() {
    renderNodeDeletion();
    const selected = layerSelection, op = selected && nodeOperations.get(nodeOperationKey(workspace.documentId, selected.id));
    const visible = !!selected;
    element('node-metadata').hidden = !visible;
    if (!visible) return;
    const editable = ['Owner', 'Editor'].includes(workspace.documentRole);
    const ready = nodeMetadata?.id === selected.id;
    for (const id of ['node-name', 'node-key']) element(id).readOnly = !editable || !ready || !!op;
    for (const id of ['node-name-form', 'node-key-form']) element(id).querySelector('button').hidden = !editable;
    for (const id of ['node-name-form', 'node-key-form']) element(id).querySelector('button').disabled = !ready || !!op;
    if (ready) {
      element('node-name').value = editable && op?.kind === 'name' ? op.body.name : nodeMetadata.name;
      element('node-key').value = (editable && op?.kind === 'key' ? op.body.semanticKey : nodeMetadata.semanticKey) ?? '';
    }
    else { element('node-name').value = ''; element('node-key').value = ''; }
    element('node-metadata-status').textContent = op?.state === 'pending' ? 'Ожидание подтверждения…' : (!ready ? 'Загрузка слоя…' : '');
    element('node-metadata-error').textContent = op?.state === 'uncertain' ? 'Результат неизвестен. Повторите ту же команду.' : (nodeMetadata?.error ?? '');
    element('node-metadata-retry').hidden = !editable || op?.state !== 'uncertain';
  }
  async function loadNodeMetadata() {
    const current = ++nodeReadGeneration, doc = workspace.documentId, screen = workspace.selectedScreen, node = layerSelection?.id, atRevision = workspace.revision, epoch = workspace.navigationEpoch, requestToken = workspace.token;
    nodeMetadata = null; renderNodeMetadata();
    if (!node || !Number.isSafeInteger(atRevision)) return;
    const active = () => current === nodeReadGeneration && doc === workspace.documentId && screen === workspace.selectedScreen && node === layerSelection?.id && atRevision === workspace.revision && epoch === workspace.navigationEpoch && requestToken === workspace.token && !element('editor-view').hidden;
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
    const doc = workspace.documentId, screen = workspace.selectedScreen, node = layerSelection?.id;
    if (!node || !nodeMetadata || !['Owner', 'Editor'].includes(workspace.documentRole)) return;
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
    const op = layerSelection && nodeOperations.get(nodeOperationKey(workspace.documentId, layerSelection.id));
    if (op?.state === 'uncertain') sendNodeMetadata(workspace.documentId, workspace.selectedScreen, layerSelection.id, op);
  });
  async function sendNodeMetadata(doc, screen, node, op) {
    const key = nodeOperationKey(doc, node), epoch = workspace.navigationEpoch, requestToken = workspace.token, selectionEpoch = layerSelectionEpoch;
    // Rereading metadata for the same selected node must not invalidate a command.
    const active = () => layerSelectionEpoch === selectionEpoch && nodeOperations.get(key) === op && workspace.documentId === doc && workspace.selectedScreen === screen && layerSelection?.id === node && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden;
    op.state = 'pending'; if (active()) renderNodeMetadata();
    try {
      const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/commands/set-node-${op.kind === 'name' ? 'name' : 'semantic-key'}`, { method: 'POST', body: JSON.stringify(op.body) }, undefined, active);
      if (nodeOperations.get(key) !== op) return;
      if (!Number.isSafeInteger(result.revision) || result.status !== 'ACCEPTED' || result.documentId?.toLowerCase() !== doc.toLowerCase() || result.commandId?.toLowerCase() !== op.body.commandId.toLowerCase()) throw new TypeError('Некорректное подтверждение');
      if (!active()) { op.state = 'uncertain'; return; }
      nodeOperations.delete(key);
      // Keep confirmed values stable while refreshing the same selected layer.
      if (nodeMetadata?.id === node) {
        if (op.kind === 'name') nodeMetadata.name = op.body.name;
        else nodeMetadata.semanticKey = op.body.semanticKey;
      }
      renderNodeMetadata();
      await runPageRefresh(signal => readCurrentPages(signal, activeAfterConfirmation));
      function activeAfterConfirmation() { return workspace.documentId === doc && workspace.selectedScreen === screen && layerSelection?.id === node && layerSelectionEpoch === selectionEpoch && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden; }
    } catch (error) {
      if (nodeOperations.get(key) !== op) return;
      if (!active() || error instanceof TypeError || error.status >= 500 || error.name === 'AbortError') op.state = 'uncertain';
      else {
        nodeOperations.delete(key);
        if (error.status === 403) { closeInaccessibleDocument(error.status); return; }
        if (error.code === 'NODE_NOT_FOUND') {
          const currentContext = () => workspace.documentId === doc && workspace.selectedScreen === screen && layerSelection?.id === node && layerSelectionEpoch === selectionEpoch && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden;
          await runPageRefresh(signal => readCurrentPages(signal, currentContext));
          if (workspace.documentId === doc && workspace.selectedScreen === screen && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden && !layerSelection) element('layers-status').textContent = 'Слой больше не существует.';
          return;
        }
        if (nodeMetadata) nodeMetadata.error = error.message;
        renderNodeMetadata();
        const input = element(op.kind === 'name' ? 'node-name' : 'node-key');
        input.value = (op.kind === 'name' ? op.body.name : op.body.semanticKey) ?? '';
        return;
      }
    } finally { if (nodeOperations.get(key) === op && workspace.documentId === doc && workspace.selectedScreen === screen && layerSelection?.id === node && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden) renderNodeMetadata(); }
  }

  element('node-delete').addEventListener('click', () => {
    const node = layerSelection, doc = workspace.documentId, screen = workspace.selectedScreen, key = `${doc}:${screen}`;
    if (!node || !['Owner', 'Editor'].includes(workspace.documentRole) || (nodeDeletions.has(key) && nodeDeletions.get(key).state !== 'rejected') || nodeOperations.has(nodeOperationKey(doc, node.id))) return;
    const name = node.name?.trim() || 'Без имени';
    if (!confirm(`Удалить слой «${name}»? Будет удалено всё его поддерево.`)) return;
    const op = { doc, screen, name, body: { commandId: crypto.randomUUID(), nodeId: node.id }, state: 'ready' };
    nodeDeletions.set(key, op); sendNodeDeletion(op);
  });
  element('node-delete-retry').addEventListener('click', () => {
    const op = nodeDeletions.get(`${workspace.documentId}:${workspace.selectedScreen}`);
    if (op?.state === 'uncertain') sendNodeDeletion(op);
  });
  async function sendNodeDeletion(op) {
    const key = `${op.doc}:${op.screen}`;
    if (nodeDeletions.get(key) !== op || op.state === 'pending') return;
    const epoch = workspace.navigationEpoch, screenEpoch = screenContextEpoch, requestToken = workspace.token;
    const active = () => screenEpoch === screenContextEpoch && nodeDeletions.get(key) === op && workspace.documentId === op.doc && workspace.selectedScreen === op.screen && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden;
    op.state = 'pending'; renderNodeDeletion();
    try {
      const result = await request(`/api/v1/documents/${encodeURIComponent(op.doc)}/commands/delete-node`, { method: 'POST', body: JSON.stringify(op.body) }, undefined, active);
      if (!active()) { op.state = 'uncertain'; return; }
      if (result.status !== 'ACCEPTED' || !Number.isSafeInteger(result.revision) || result.documentId?.toLowerCase() !== op.doc.toLowerCase() || result.commandId?.toLowerCase() !== op.body.commandId.toLowerCase()) throw new TypeError('Некорректное подтверждение');
      let synced = false;
      await runPageRefresh(async signal => { await readCurrentPages(signal, active); synced = true; });
      if (active() && synced) { nodeDeletions.delete(key); renderNodeDeletion(); }
      else op.state = 'uncertain';
    } catch (error) {
      if (!active() || error instanceof TypeError || error.name === 'AbortError' || error.status === undefined || error.status >= 500) { op.state = 'uncertain'; return; }
      if (error.status === 403) { nodeDeletions.delete(key); closeInaccessibleDocument(403); return; }
      if (error.code === 'NODE_NOT_FOUND') {
        await runPageRefresh(signal => readCurrentPages(signal, active));
        if (!active()) { op.state = 'uncertain'; return; }
        op.error = 'Слой уже удалён другим участником.';
      } else op.error = ({ SCENARIO_IN_USE: 'Слой или его поддерево используется в сценариях. Сначала удалите ссылки сценариев.', SCREEN_VARIANT_IN_USE: 'Слой или его поддерево используется в вариантах. Сначала удалите ссылки вариантов.', INVALID_REPEATER: 'Слой используется повторителем. Сначала удалите зависимость.', INVALID_COMPONENT: 'Слой используется компонентом. Сначала удалите зависимость.' })[error.code] || error.message;
      op.state = 'rejected';
    } finally { if (nodeDeletions.get(key) === op && workspace.documentId === op.doc && workspace.selectedScreen === op.screen && workspace.token === requestToken && !element('editor-view').hidden) renderNodeDeletion(); }
  }

  function siblingContext(id) {
    function find(parent, items, ancestors = []) {
      const index = items.findIndex(item => item.id === id);
      if (index >= 0) return { parent, index, count: items.length, ancestors, item: items[index] };
      for (const item of items) {
        const found = find(item.id, layerChildren.get(item.id) || [], [...ancestors, item.id]);
        if (found) return found;
      }
      return null;
    }
    return workspace.selectedScreen && id ? find(workspace.selectedScreen, layerRoots) : null;
  }
  const moveKey = () => `${workspace.documentId}:${workspace.selectedScreen}`;
  const canMove = () => ['Owner', 'Editor'].includes(workspace.documentRole) && !nodeMoves.has(moveKey()) && !element('editor-view').hidden;
  function renderNodeOrder() {
    const op = nodeMoves.get(moveKey());
    const editable = ['Owner', 'Editor'].includes(workspace.documentRole);
    element('layers').classList.toggle('layer-move-enabled', editable && !op);
    element('node-order-retry').hidden = !editable || op?.state !== 'uncertain';
    element('node-order-status').textContent = !editable ? '' : op?.state === 'pending' ? 'Перемещение слоя…' : op?.state === 'uncertain' ? `Результат перемещения неизвестен. Повторите ту же команду для слоя «${op.name}».` : nodeMoveNotices.get(moveKey()) || '';
  }

  const drag = createLayerDrag({
    tree: element('layers'), canMove, context: siblingContext,
    stamp: () => [workspace.documentId, workspace.selectedScreen, workspace.revision, layerGeneration, workspace.navigationEpoch, layerSelectionEpoch].join(':'),
    resolve: (source, target, zone) => resolveLayerDrop(siblingContext(source), siblingContext(target), zone),
    expand: id => {
      if (!layerExpanded.has(id) && layerChildren.has(id)) {
        layerExpanded.add(id);
        renderLayers();
      }
    },
    commit: (id, plan) => {
      const item = findLayer(id);
      if (!item || !canMove()) return;
      // A dirty inspector draft must be resolved before moving, never during a gesture.
      if (layerSelection?.id !== id && !beforeSelectionChange(() => selectLayer(item))) return;
      selectLayer(item);
      renderLayers(id);
      startNodeMove(plan.expectedParentId, plan.targetParentId, plan.position, plan.reveal);
    }
  });

  function beginNodeMove(delta) {
    const context = siblingContext(layerSelection?.id);
    if (!context) return;
    const position = context.index + delta;
    if (position < 0 || position >= context.count) return;
    renderLayers(layerSelection.id);
    startNodeMove(context.parent, context.parent, position, context.ancestors);
  }
  function startNodeMove(expectedParentId, targetParentId, position, reveal = []) {
    const key = `${workspace.documentId}:${workspace.selectedScreen}`;
    if (!layerSelection || !['Owner', 'Editor'].includes(workspace.documentRole) || nodeMoves.has(key)) return;
    const body = { commandId: crypto.randomUUID(), nodeId: layerSelection.id, expectedParentId, targetParentId, position, expectedRevision: workspace.revision };
    const op = { doc: workspace.documentId, screen: workspace.selectedScreen, name: layerSelection.name?.trim() || layerSelection.kind, reveal, body, state: 'ready' };
    nodeMoveNotices.delete(key);
    nodeMoves.set(key, op);
    sendNodeMove(op);
  }
  element('node-order-retry').addEventListener('click', () => {
    const op = nodeMoves.get(`${workspace.documentId}:${workspace.selectedScreen}`);
    if (op?.state === 'uncertain') sendNodeMove(op);
  });
  async function refreshNodeMoveTree(active, reveal = []) {
    let synced = false;
    await runPageRefresh(async (signal, current) => {
      try {
        synced = await readCurrentPages(signal, active, reveal) === true;
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
    if (nodeMoves.get(key) !== op || op.state === 'pending' || !['Owner', 'Editor'].includes(workspace.documentRole)) return;
    const epoch = workspace.navigationEpoch, screenEpoch = screenContextEpoch, selectionEpoch = layerSelectionEpoch, requestToken = workspace.token;
    const context = () => nodeMoves.get(key) === op && workspace.documentId === op.doc && workspace.selectedScreen === op.screen && screenContextEpoch === screenEpoch && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden;
    const active = () => context() && layerSelectionEpoch === selectionEpoch;
    const restoreFocus = element('layers').contains(document.activeElement) || document.activeElement === element('node-order-retry');
    op.state = 'pending'; renderNodeOrder();
    try {
      const result = await request(`/api/v1/documents/${encodeURIComponent(op.doc)}/commands/move-node`, { method: 'POST', body: JSON.stringify(op.body) }, undefined, active);
      if (!active()) { op.state = 'uncertain'; return; }
      if (result.status !== 'ACCEPTED' || !Number.isSafeInteger(result.revision) || result.documentId?.toLowerCase() !== op.doc.toLowerCase() || result.commandId?.toLowerCase() !== op.body.commandId.toLowerCase()) throw new TypeError('Некорректное подтверждение');
      const reveal = layerSelection?.id === op.body.nodeId ? op.reveal : [];
      const synced = await refreshNodeMoveTree(active, reveal);
      if (context() && synced) {
        nodeMoves.delete(key);
        nodeMoveNotices.set(key, (op.body.expectedParentId !== op.body.targetParentId ? 'Слой перемещён к новому родителю.' : 'Порядок слоёв изменён.') + ` Позиция: ${op.body.position + 1}.`);
        if (layerSelection?.id === op.body.nodeId && restoreFocus &&
            (element('layers').contains(document.activeElement) || document.activeElement === document.body || document.activeElement === element('node-order-retry'))) {
          renderLayers(op.body.nodeId);
          element('layers').querySelector('[role=treeitem][aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      } else op.state = 'uncertain';
    } catch (error) {
      if (!active() || error.status === undefined || error.status === 408 || error.status >= 500) { op.state = 'uncertain'; return; }
      if (error.status === 403 || error.code === 'DOCUMENT_NOT_FOUND') { nodeMoves.delete(key); closeInaccessibleDocument(error.status); return; }
      const explanations = {
        NODE_NOT_FOUND: 'Слой уже удалён другим участником.',
        PARENT_NOT_FOUND: 'Новый родитель уже удалён другим участником.',
        INVALID_LAYOUT_CONTEXT: 'Родитель слоя изменился.',
        INVALID_POSITION: 'Эта позиция больше недоступна.',
        REVISION_CONFLICT: 'Структура документа изменилась. Повторите жест.',
        CHILDREN_NOT_ALLOWED: 'Новый родитель не может содержать дочерние слои.',
        CYCLE_NOT_ALLOWED: 'Нельзя переместить слой внутрь его собственного поддерева.',
        INVALID_COMPONENT: 'Перемещение нарушит структуру компонента.',
        INVALID_REPEATER: 'Перемещение нарушит структуру повторителя.',
        SCENARIO_IN_USE: 'Перемещение нарушит ссылки сценария.',
        SCREEN_VARIANT_IN_USE: 'Перемещение нарушит ссылки варианта экрана.'
      };
      const notice = explanations[error.code] ?? error.message;
      const refresh = ['NODE_NOT_FOUND', 'PARENT_NOT_FOUND', 'INVALID_LAYOUT_CONTEXT', 'INVALID_POSITION', 'CYCLE_NOT_ALLOWED', 'REVISION_CONFLICT'].includes(error.code);
      const synced = refresh && await refreshNodeMoveTree(context);
      if (context())
        nodeMoveNotices.set(key, notice + (synced ? ' Дерево обновлено.' : ''));
      if (nodeMoves.get(key) === op) nodeMoves.delete(key);
    } finally {
      if (workspace.documentId === op.doc && workspace.selectedScreen === op.screen && workspace.token === requestToken && (workspace.navigationEpoch === epoch || nodeMoves.get(key) === op) && !element('editor-view').hidden)
        renderNodeOrder();
    }
  }

  function renderLayers(focusId) {
    renderNodeDeletion();
    const tree = element('layers');
    const old = new Map([...tree.querySelectorAll('[role=treeitem]')].map(row => [row.dataset.id, row]));

    function reconcile(parent, items) {
      const rows = [];
      for (const [index, item] of items.entries()) {
        let row = old.get(item.id);
        if (!row) {
          row = document.createElement('div');
          row.setAttribute('role', 'treeitem');
          row.dataset.id = item.id;
          row.tabIndex = -1;
          const label = document.createElement('span');
          label.className = 'layer-label';
          row.append(label);
          label.addEventListener('click', () => {
            const latest = findLayer(item.id);
            if (!latest) return;
            const select = () => { selectLayer(latest); row.focus(); if (latest.childCount) toggleLayer(latest); };
            if (layerSelection?.id === latest.id || beforeSelectionChange(select)) select();
          });
        }
        row.setAttribute('aria-posinset', String(index + 1));
        row.setAttribute('aria-setsize', String(items.length));
        const selected = String(layerSelection?.id === item.id);
        if (row.getAttribute('aria-selected') !== selected) row.setAttribute('aria-selected', selected);
        if (item.childCount) {
          const expanded = String(layerExpanded.has(item.id));
          if (row.getAttribute('aria-expanded') !== expanded) row.setAttribute('aria-expanded', expanded);
        } else row.removeAttribute('aria-expanded');
        const label = row.querySelector(':scope > .layer-label');
        const { text: name, source, origin } = layerDisplayName(item);
        const expansion = item.childCount ? (layerExpanded.has(item.id) ? '▾' : '▸') : '';
        const caption = `${expansion}:${name}:${item.kind}:${source}:${origin}`;
        if (label.dataset.caption !== caption) {
          const disclosure = document.createElement('span');
          disclosure.className = 'layer-disclosure';
          disclosure.setAttribute('aria-hidden', 'true');
          disclosure.textContent = expansion;
          const icon = document.createElement('span');
          icon.className = 'layer-kind-icon';
          icon.setAttribute('aria-hidden', 'true');
          icon.title = item.kind;
          icon.textContent = ({ Frame: '▣', Container: '▣', Text: 'T', Button: '▭',
            TextInput: '▤', Image: '▧' })[item.kind] ?? '◇';
          const title = document.createElement('span');
          title.className = 'layer-name';
          title.dataset.labelSource = source;
          title.textContent = name;
          label.replaceChildren(disclosure, icon, title);
          label.dataset.caption = caption;
          label.title = `${name} · ${item.kind} · ${origin}`;
          row.setAttribute('aria-label', `${name}, ${item.kind}`);
        }
        let marker = label.querySelector('.layer-interaction');
        if (interactiveNodes.has(item.id) && !marker) {
          marker = document.createElement('span');
          marker.className = 'layer-interaction';
          marker.textContent = '↗';
          marker.title = 'Есть взаимодействия';
          marker.setAttribute('aria-hidden', 'true');
          label.append(marker);
        } else if (!interactiveNodes.has(item.id)) marker?.remove();
        row.setAttribute('aria-label', name + ', ' + item.kind + (interactiveNodes.has(item.id) ? ', есть взаимодействия' : ''));
        let group = row.querySelector(':scope > [role=group]');
        if (layerExpanded.has(item.id) && item.childCount) {
          if (!group) {
            group = document.createElement('div');
            group.setAttribute('role', 'group');
            row.append(group);
          }
          reconcile(group, layerChildren.get(item.id) || []);
        } else group?.remove();
        rows.push(row);
      }
      let following = null;
      for (let index = rows.length - 1; index >= 0; index--) {
        const row = rows[index];
        if (row.parentNode !== parent || row.nextElementSibling !== following)
          parent.insertBefore(row, following);
        following = row;
      }
      const expected = new Set(items.map(item => item.id));
      for (const child of [...parent.children]) {
        if (child.getAttribute('role') === 'treeitem' && !expected.has(child.dataset.id))
          child.remove();
      }
    }

    const focusedElement = document.activeElement?.closest('[role=treeitem]');
    reconcile(tree, layerRoots);
    const rows = [...tree.querySelectorAll('[role=treeitem]')];
    const focused = rows.find(row => row.dataset.id === focusId) ||
      rows.find(row => row === focusedElement) ||
      rows.find(row => row.dataset.id === layerSelection?.id) || rows[0];
    for (const row of rows) row.tabIndex = row === focused ? 0 : -1;
    if (focused && focusId) focused.focus({ preventScroll: true });
  }

  async function readLayerChildren(base, parentId, signal, revision, isCurrent) {
    const items = []; let total;
    do {
      const query = new URLSearchParams({ offset: String(items.length), limit: '100', fields: 'name,kind,childCount,properties,canContainChildren', revision: String(revision) });
      const result = await request(`${base}/children/${encodeURIComponent(parentId)}?${query}`, {}, signal, isCurrent);
      total = result.total;
      if (!result.items.length && items.length < total) throw new Error('Не удалось загрузить все слои. Обновите страницы.');
      items.push(...result.items);
    } while (items.length < total);
    return items;
  }

  function layerFailure(error, current) {
    if (error.name === 'AbortError' || current !== layerGeneration) return;
    if (error.status === 403) { closeInaccessibleDocument(403); return; }
    reset();
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
        const base = `/api/v1/documents/${encodeURIComponent(workspace.documentId)}`;
        const latest = await request(`${base}/pages?limit=1&fields=name`, {}, layerController.signal);
        if (current !== layerGeneration) return;
        if (latest.revision !== workspace.revision) { await refreshPages(); return; }
        const items = await readLayerChildren(base, item.id, layerController.signal, workspace.revision);
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
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (canMove() && layerSelection) beginNodeMove(event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
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
      const item = findLayer(row.dataset.id);
      if (item && (layerSelection?.id === item.id || beforeSelectionChange(() => selectLayer(item)))) selectLayer(item);
    } else return;
    event.preventDefault();
    if (target) { row.tabIndex = -1; target.tabIndex = 0; target.focus(); }
  });

  async function readSnapshot({ base, screen, revision, signal, isCurrent, reveal, shouldReportFailure }) {
    const children = new Map(), initialExpansion = new Set(layerExpanded);
    const expanded = new Set(screen === workspace.selectedScreen ? [...initialExpansion, ...reveal] : []);
    async function readBranch(parent) {
      const items = await readLayerChildren(base, parent, signal, revision, isCurrent);
      if (!isCurrent()) return [];
      for (const item of items) if (item.childCount > 0 || expanded.has(item.id)) children.set(item.id, await readBranch(item.id));
      return items;
    }
    try {
      const roots = screen ? await readBranch(screen) : [];
      return { screen, roots, children, expanded, initialExpansion };
    } catch (error) {
      if (isCurrent() && shouldReportFailure()) layerFailure(error, layerGeneration);
      throw error;
    }
  }

  function isExpansionCurrent({ initialExpansion }) {
    return initialExpansion.size === layerExpanded.size && [...initialExpansion].every(id => layerExpanded.has(id));
  }

  function applySnapshot({ screen, roots, children, expanded }, selection) {
    drag.cancel();
    layerController?.abort();
    layerGeneration++;
    layerRoots = roots; layerChildren = children; layerExpanded = expanded;
    layerController = new AbortController();
    const selected = selection && findLayer(selection.id);
    if (selected) selectLayer(selected);
    else if (layerSelection) {
      layerSelection = null;
      layerSelectionEpoch++;
      nodeReadGeneration++;
      nodeMetadata = null;
      renderNodeMetadata();
      element('inspector-selection').textContent = 'Выберите слой.';
      onSelectionCleared();
    }
    renderLayers();
    element('layers-status').textContent = screen ? (roots.length ? 'Стрелки перемещают выбор, Enter выбирает слой.' : 'На экране нет слоёв.') : 'Выберите экран.';
  }

  function selectFromCanvas(item, nodes, confirmed = false) {
    if (!confirmed && layerSelection?.id !== item.id && !beforeSelectionChange(() => selectFromCanvas(item, nodes, true))) return false;
    drag.cancel();
    const byId = new Map(nodes.map(node => [node.id, node]));
    const branches = new Map();
    for (const node of nodes) {
      if (!branches.has(node.parentId)) branches.set(node.parentId, []);
      branches.get(node.parentId).push(node);
    }
    for (let parent = byId.get(item.parentId); parent; parent = byId.get(parent.parentId)) {
      layerExpanded.add(parent.id);
      layerChildren.set(parent.id, branches.get(parent.id));
    }
    layerRoots = branches.get(workspace.selectedScreen) ?? [];
    selectLayer(item);
    renderLayers();
    return true;
  }

  function clearCommands() {
    nodeOperations.clear(); nodeDeletions.clear(); nodeMoves.clear(); nodeMoveNotices.clear();
  }

  return {
    reset, clearCommands, readSnapshot, isExpansionCurrent, applySnapshot, findLayer, selectFromCanvas,
    refreshMoveAvailability() { if (!canMove()) drag.cancel(); renderNodeOrder(); },
    setInteractiveNodes(ids) { interactiveNodes = new Set(ids); renderLayers(); },
    clearSelection() {
      if (!layerSelection) return;
      layerSelection = null; layerSelectionEpoch++; nodeReadGeneration++; nodeMetadata = null;
      drag.cancel(); renderNodeMetadata(); renderNodeOrder(); renderLayers();
      element('inspector-selection').textContent = 'Выберите слой.';
      onSelectionCleared();
    },
    onScreenContextChanged: () => { drag.cancel(); screenContextEpoch++; },
    get selection() { return layerSelection; },
    get hasLayers() { return layerRoots.length > 0; }
  };
}
