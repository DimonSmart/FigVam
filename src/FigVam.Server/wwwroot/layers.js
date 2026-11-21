export function createLayers({
  element, request, workspace, refreshPages, runPageRefresh, readCurrentPages,
  closeInaccessibleDocument, message, onSelectionCleared, onLayerSelected
}) {
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

  function reset() {
    closeNodeReparent();
    layerController?.abort(); layerController = null; layerGeneration++;
    layerSelection = null; layerRoots = []; layerExpanded = new Set(); layerChildren = new Map();
    onSelectionCleared();
    element('layers').replaceChildren();
    element('layers-status').textContent = 'Выберите экран.';
    element('inspector-selection').textContent = 'Выберите слой.';
    nodeReadGeneration++; nodeMetadata = null; renderNodeMetadata();
  }

  function selectLayer(item) {
    if (layerSelection?.id !== item.id) { layerSelectionEpoch++; closeNodeReparent(); }
    layerSelection = item;
    loadNodeMetadata();
    onLayerSelected();
    element('inspector-selection').textContent = `Слой: ${item.name?.trim() || 'Без имени'} · ${item.kind} · ID: ${item.id}`;
    renderNodeOrder();
    for (const node of element('layers').querySelectorAll('[role=treeitem]'))
      node.setAttribute('aria-selected', String(node.dataset.id === item.id));
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
    if (ready) { element('node-name').value = nodeMetadata.name; element('node-key').value = nodeMetadata.semanticKey ?? ''; }
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
    const key = nodeOperationKey(doc, node), epoch = workspace.navigationEpoch, requestToken = workspace.token, selectionGeneration = nodeReadGeneration;
    const active = () => nodeReadGeneration === selectionGeneration && nodeOperations.get(key) === op && workspace.documentId === doc && workspace.selectedScreen === screen && layerSelection?.id === node && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden;
    op.state = 'pending'; if (active()) renderNodeMetadata();
    try {
      const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/commands/set-node-${op.kind === 'name' ? 'name' : 'semantic-key'}`, { method: 'POST', body: JSON.stringify(op.body) }, undefined, active);
      if (nodeOperations.get(key) !== op) return;
      if (!Number.isSafeInteger(result.revision) || result.code !== 'ACCEPTED' || result.documentId?.toLowerCase() !== doc.toLowerCase() || result.commandId?.toLowerCase() !== op.body.commandId.toLowerCase()) throw new TypeError('Некорректное подтверждение');
      if (!active()) { op.state = 'uncertain'; return; }
      nodeOperations.delete(key);
      await runPageRefresh(signal => readCurrentPages(signal, activeAfterConfirmation));
      function activeAfterConfirmation() { return workspace.documentId === doc && workspace.selectedScreen === screen && layerSelection?.id === node && nodeReadGeneration === selectionGeneration && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden; }
    } catch (error) {
      if (nodeOperations.get(key) !== op) return;
      if (!active() || error instanceof TypeError || error.status >= 500 || error.name === 'AbortError') op.state = 'uncertain';
      else {
        nodeOperations.delete(key);
        if (error.status === 403) { closeInaccessibleDocument(error.status); return; }
        if (error.code === 'NODE_NOT_FOUND') {
          const currentContext = () => workspace.documentId === doc && workspace.selectedScreen === screen && layerSelection?.id === node && nodeReadGeneration === selectionGeneration && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden;
          await runPageRefresh(signal => readCurrentPages(signal, currentContext));
          if (workspace.documentId === doc && workspace.selectedScreen === screen && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden && !layerSelection) element('layers-status').textContent = 'Слой больше не существует.';
          return;
        }
        if (nodeMetadata) nodeMetadata.error = error.message;
        renderNodeMetadata(); return;
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
      if (result.code !== 'ACCEPTED' || !Number.isSafeInteger(result.revision) || result.documentId?.toLowerCase() !== op.doc.toLowerCase() || result.commandId?.toLowerCase() !== op.body.commandId.toLowerCase()) throw new TypeError('Некорректное подтверждение');
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
    return workspace.selectedScreen && layerSelection ? find(workspace.selectedScreen, layerRoots) : null;
  }
  function renderNodeOrder() {
    const op = nodeMoves.get(`${workspace.documentId}:${workspace.selectedScreen}`), context = selectedSiblingContext();
    const editable = ['Owner', 'Editor'].includes(workspace.documentRole);
    element('node-order').hidden = !editable || !layerSelection;
    element('node-earlier').disabled = !context || context.index === 0 || !!op;
    element('node-later').disabled = !context || context.index === context.count - 1 || !!op;
    element('node-reparent').disabled = !context || !!op;
    element('node-order-retry').hidden = !editable || op?.state !== 'uncertain';
    element('node-order-status').textContent = !editable ? '' : op?.state === 'pending' ? 'Перемещение слоя…' : op?.state === 'uncertain' ? `Результат перемещения неизвестен. Повторите ту же команду для слоя «${op.name}».` : nodeMoveNotices.get(`${workspace.documentId}:${workspace.selectedScreen}`) || '';
  }
  function closeNodeReparent() {
    nodeReparentDraft?.controller.abort();
    nodeReparentDraft = null;
    element('node-reparent-form').hidden = true;
    element('node-reparent').setAttribute('aria-expanded', 'false');
  }

  async function loadNodeReparent() {
    const key = `${workspace.documentId}:${workspace.selectedScreen}`;
    if (!selectedSiblingContext() || !['Owner', 'Editor'].includes(workspace.documentRole) || nodeMoves.has(key)) return;
    closeNodeReparent();
    const doc = workspace.documentId, screen = workspace.selectedScreen, node = layerSelection.id;
    const epoch = workspace.navigationEpoch, screenEpoch = screenContextEpoch, selectionEpoch = layerSelectionEpoch, requestToken = workspace.token;
    const controller = new AbortController();
    const draft = { doc, screen, node, controller, targets: new Map() };
    const active = () => nodeReparentDraft === draft && doc === workspace.documentId && screen === workspace.selectedScreen &&
      node === layerSelection?.id && epoch === workspace.navigationEpoch && screenEpoch === screenContextEpoch &&
      selectionEpoch === layerSelectionEpoch && workspace.token === requestToken && !element('editor-view').hidden;
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
    if (!target || draft.doc !== workspace.documentId || draft.screen !== workspace.selectedScreen || draft.node !== layerSelection?.id ||
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
    const key = `${workspace.documentId}:${workspace.selectedScreen}`;
    if (!layerSelection || !['Owner', 'Editor'].includes(workspace.documentRole) || nodeMoves.has(key)) return;
    const body = { commandId: crypto.randomUUID(), nodeId: layerSelection.id, expectedParentId, targetParentId, position };
    const op = { doc: workspace.documentId, screen: workspace.selectedScreen, name: layerSelection.name?.trim() || layerSelection.kind, reveal, body, state: 'ready' };
    closeNodeReparent();
    nodeMoveNotices.delete(key);
    nodeMoves.set(key, op);
    sendNodeMove(op);
  }
  element('node-earlier').addEventListener('click', () => beginNodeMove(-1));
  element('node-later').addEventListener('click', () => beginNodeMove(1));
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
      if (workspace.documentId === op.doc && workspace.selectedScreen === op.screen && workspace.token === requestToken && (workspace.navigationEpoch === epoch || nodeMoves.get(key) === op) && !element('editor-view').hidden)
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

  async function readLayerChildren(base, parentId, signal, revision, isCurrent) {
    const items = []; let total;
    do {
      const query = new URLSearchParams({ offset: String(items.length), limit: '100', fields: 'name,kind,childCount', revision: String(revision) });
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

  async function readSnapshot({ base, screen, revision, signal, isCurrent, reveal, shouldReportFailure }) {
    const children = new Map(), initialExpansion = new Set(layerExpanded);
    const expanded = new Set(screen === workspace.selectedScreen ? [...initialExpansion, ...reveal] : []);
    async function readBranch(parent) {
      const items = await readLayerChildren(base, parent, signal, revision, isCurrent);
      if (!isCurrent()) return [];
      for (const item of items) if (expanded.has(item.id)) children.set(item.id, await readBranch(item.id));
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
    layerRoots = roots; layerChildren = children; layerExpanded = expanded;
    layerController = new AbortController();
    renderLayers();
    if (selection) {
      const item = findLayer(selection.id);
      if (item) selectLayer(item);
    }
    element('layers-status').textContent = screen ? (roots.length ? 'Стрелки перемещают выбор, Enter выбирает слой.' : 'На экране нет слоёв.') : 'Выберите экран.';
  }

  function clearCommands() {
    nodeOperations.clear(); nodeDeletions.clear(); nodeMoves.clear(); nodeMoveNotices.clear();
  }

  return {
    reset, clearCommands, readSnapshot, isExpansionCurrent, applySnapshot, findLayer,
    onScreenContextChanged: () => { screenContextEpoch++; },
    get selection() { return layerSelection; },
    get hasLayers() { return layerRoots.length > 0; }
  };
}
