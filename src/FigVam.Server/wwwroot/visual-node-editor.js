import { createPropertyControl, propertyLabel } from './node-property-controls.js';

const canEdit = role => role === 'Owner' || role === 'Editor';
const sameRaw = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const draft = () => ({ values: new Map(), error: '', status: '' });
const scopeKey = context => context.screen && Number.isSafeInteger(context.revision) ?
  `${context.documentId}:${context.screen}` : null;

export function createVisualNodeEditor({
  element, request, getContext, readModel, refreshDocument, closeInaccessibleDocument, stopLive, startLive
}) {
  const kindSelect = element('visual-kind'), parentSelect = element('visual-parent');
  const paletteProperties = element('visual-required-properties');
  const paletteOptional = element('visual-optional-properties'), paletteDetails = element('visual-optional-details');
  const inspectorProperties = element('visual-properties');
  const operations = new Map(), paletteDrafts = new Map(), inspectorDrafts = new Map(), canvasDrafts = new Map();
  let context, model, modelKey, resolvedModelKey, modelScope, loadedKey, loadError = '', queued = false;
  let palette, inspector, node, paletteFields = new Map(), paletteOptionalFields = new Map(), inspectorFields = new Map();
  let paletteControlKey = null, inspectorControlKey = null;
  let loadingFocus, uploadDocument;
  const uploads = new Map();

  function refresh() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      context = getContext();
      if (uploadDocument !== context.documentId) {
        element('asset-upload-file').value = '';
        uploadDocument = context.documentId;
      }
      const scope = scopeKey(context);
      const key = scope && `${scope}:${context.revision}:${context.variantId ?? "base"}:${context.navigationEpoch}`;
      const selectionId = context.selection?.id;
      // UI identity follows selection, not the document revision.
      const renderKey = `${scope}:${context.variantId ?? "base"}:${selectionId}:${context.documentRole}:${context.navigationEpoch}`;
      if (modelKey !== key) load(key, scope);
      if (loadedKey !== renderKey) {
        loadedKey = renderKey;
        render();
      } else updateControls();
    });
  }

  function load(key, scope = scopeKey(context)) {
    modelKey = key;
    loadError = '';
    if (scope !== modelScope) {
      modelScope = scope;
      model = null;
      resolvedModelKey = null;
      paletteFields = new Map(); paletteOptionalFields = new Map(); inspectorFields = new Map();
      paletteControlKey = inspectorControlKey = null;
    }
    if (!key) return;
    // A new pinned snapshot is loaded without blanking the existing inspector.
    readModel().then(result => {
      if (modelKey !== key) return;
      model = result;
      resolvedModelKey = key;
      render();
    }).catch(error => {
      if (modelKey !== key || error.name === 'AbortError') return;
      if (error.status === 403 || error.code === 'DOCUMENT_NOT_FOUND') {
        closeInaccessibleDocument(error.status);
        return;
      }
      loadError = error.message || 'Не удалось загрузить профиль и свойства.';
      updateControls();
    });
  }

  function sameChoices(select, choices) {
    return select.options.length === choices.length &&
      choices.every((choice, index) =>
        select.options[index].value === choice.value && select.options[index].text === choice.text);
  }

  function render() {
    const focus = document.activeElement?.id;
    if (!model && focus) loadingFocus = { id: focus, key: loadedKey };
    const scope = scopeKey(context), selected = context.selection;
    const editable = canEdit(context.documentRole);
    if (scope && !paletteDrafts.has(scope)) paletteDrafts.set(scope, { ...draft(), kind: '', parent: null, selectionId: undefined });
    palette = paletteDrafts.get(scope);
    node = model?.nodes.get(selected?.id);
    const definition = model?.kinds.get(node?.kind);
    const key = node && `${scope}:${context.variantId ?? "base"}:${node.id}`;
    if (key && !inspectorDrafts.has(key)) inspectorDrafts.set(key, draft());
    inspector = inspectorDrafts.get(key);
    element('visual-palette').hidden = !scope || !editable;
    element('visual-inspector').hidden = !scope || !selected;
    element('visual-palette-form').hidden = !model?.kinds.size;
    element('visual-properties-form').hidden = !definition;
    if (model?.kinds.size && editable) {
      const kinds = [...model.kinds.keys()];
      const options = kinds.map(kind => ({ value: kind, text: kind }));
      if (!sameChoices(kindSelect, options))
        kindSelect.replaceChildren(...kinds.map(kind => new Option(kind, kind)));
      if (!model.kinds.has(palette.kind)) palette.kind = kinds[0];
      kindSelect.value = palette.kind;
      const choices = [{ value: context.screen, text: 'Выбранный экран' }];
      if (selected && node)
        choices.push({ value: selected.id, text: `Выбранный слой · ${selected.name?.trim() || selected.kind}` });
      if (!sameChoices(parentSelect, choices))
        parentSelect.replaceChildren(...choices.map(option => new Option(option.text, option.value)));
      if (palette.selectionId !== selected?.id) {
        palette.selectionId = selected?.id;
        palette.parent = selected?.id;
      }
      parentSelect.value = node && palette.parent === node.id ? node.id : context.screen;
      renderRequiredFields();
    }
    if (inspectorControlKey !== key) {
      inspectorFields = new Map();
      inspectorControlKey = key;
    }
    inspectorFields = renderFields(inspectorProperties, definition?.properties, node?.properties,
      editable ? inspector : undefined, 'visual-property', inspectorFields);
    updateControls();
    const focusId = focus || (loadingFocus?.key === loadedKey ? loadingFocus.id : null);
    const nextFocus = focusId && element(focusId);
    if (document.activeElement === document.body && nextFocus && !nextFocus.closest('[hidden]') && !nextFocus.disabled)
      nextFocus.focus({ preventScroll: true });
    if (model) loadingFocus = null;
  }

  function renderRequiredFields() {
    const key = `${scopeKey(context)}:${palette.kind}`;
    if (paletteControlKey !== key) {
      paletteFields = new Map();
      paletteOptionalFields = new Map();
      paletteDetails.open = false;
      paletteControlKey = key;
    }
    const properties = model?.kinds.get(palette.kind)?.properties ?? {};
    const required = Object.fromEntries(Object.entries(properties).filter(([, definition]) => definition.required));
    paletteFields = renderFields(paletteProperties, required, null, palette, 'visual-required', paletteFields);
    const optional = Object.fromEntries(Object.entries(properties)
      .filter(([, definition]) => !definition.required && definition.tokenType != null &&
        (definition.type === 'Color' || definition.type === 'Number' ||
          definition.type === 'String' || definition.type === 'Enum')));
    paletteDetails.hidden = !Object.keys(optional).length;
    paletteOptionalFields = renderFields(paletteOptional, optional, null, palette,
      'visual-optional', paletteOptionalFields);
    if ([...paletteOptionalFields.keys()].some(name => palette.values.has(name)))
      paletteDetails.open = true;
  }

  function renderFields(container, definitions, values, state, prefix, existing = new Map()) {
    const fields = new Map(), rows = [];
    for (const [name, definition] of Object.entries(definitions ?? {})) {
      const choices = definition.type === 'Asset' ? [...model.assets.values()] :
        definition.type === 'TokenReference' || definition.tokenType != null ? [...model.tokens.values()] : null;
      const signature = JSON.stringify([definition, choices, Boolean(state)]);
      const valueSignature = JSON.stringify(values?.[name] ?? definition.defaultValue);
      let field = existing.get(name);
      if (!field || field.signature !== signature) {
        field = createPropertyControl(name, definition, model, values?.[name], prefix);
        field.signature = signature;
        field.valueSignature = valueSignature;
        function update() {
          const raw = field.read();
          if (sameRaw(field.baseline, raw)) state.values.delete(name);
          else state.values.set(name, raw);
          if (state === inspector && (name === 'x' || name === 'y')) {
            if (state.values.has('x') || state.values.has('y')) state.coordinateParentId ??= node.parentId;
            else state.coordinateParentId = undefined;
          }
          state.error = state.status = '';
          field.validate();
          updateControls();
        }
        if (state) {
          field.row.addEventListener('input', update);
          field.row.addEventListener('change', update);
        }
      } else if (field.valueSignature !== valueSignature) {
        // Create a detached control for a changed baseline, never replace the live DOM.
        field.baseline = createPropertyControl(name, definition, model, values?.[name], prefix).baseline;
        field.valueSignature = valueSignature;
      }
      if (state?.values.has(name)) {
        const value = state.values.get(name);
        if (!sameRaw(field.read(), value)) field.write(value);
        field.validate();
      } else if (!sameRaw(field.read(), field.baseline)) field.write(field.baseline);
      if (prefix === 'visual-property') {
        const overridden = Boolean(context.variantId && model?.overridden?.get(node?.id)?.has(name));
        field.row.dataset.variantOverride = String(overridden);
        let reset = field.row.querySelector('.variant-override-reset');
        if (!reset && overridden && state) {
          reset = document.createElement('button');
          reset.className = 'variant-override-reset'; reset.type = 'button';
          reset.addEventListener('click', () => {
            const current = getContext();
            if (!current.variantId || !node || !canEdit(current.documentRole)) return;
            begin('remove-screen-variant-override', {
              screenId: current.screen, variantId: current.variantId,
              nodeId: node.id, property: name, expectedRevision: current.revision
            }, inspector);
          });
          field.row.append(reset);
        }
        if (reset) {
          reset.textContent = 'Reset Override';
          reset.hidden = !overridden || !state;
        }
      }
      fields.set(name, field);
      rows.push(field.row);
    }
    // Keep the compact geometry rows while retaining input DOM identity between revisions.
    const geometryGroups = [], groupedRows = new Set();
    if (prefix === 'visual-property') {
      for (const names of [['x', 'y'], ['width', 'height']]) {
        const children = names.map(name => fields.get(name)?.row)
          .filter(row => row?.classList.contains('node-property--geometry'));
        if (!children.length) continue;
        let group = [...container.children].find(child =>
          child.classList.contains('node-geometry-row') && child.dataset.geometryGroup === names[0]);
        if (!group) {
          group = document.createElement('div');
          group.className = 'node-geometry-row';
          group.dataset.geometryGroup = names[0];
        }
        reconcileChildren(group, children);
        geometryGroups.push(group);
        children.forEach(row => groupedRows.add(row));
      }
    }
    reconcileChildren(container, [...geometryGroups, ...rows.filter(row => !groupedRows.has(row))]);
    return fields;
  }

  function reconcileChildren(parent, rows) {
    let following = null;
    for (let index = rows.length - 1; index >= 0; index--) {
      const row = rows[index];
      if (row.parentNode !== parent || row.nextElementSibling !== following)
        parent.insertBefore(row, following);
      following = row;
    }
    const wanted = new Set(rows);
    for (const child of [...parent.children]) if (!wanted.has(child)) child.remove();
  }

  function eligibleParent() {
    const id = parentSelect.value;
    return id === context.screen || model?.kinds.get(model.nodes.get(id)?.kind)?.canContainChildren === true;
  }

  function updateControls() {
    if (!context) return;
    const op = operations.get(scopeKey(context));
    const adding = op?.command === 'add-node',
      editing = ['set-node-properties', 'set-screen-variant-properties', 'remove-screen-variant-override'].includes(op?.command) && !op.canvas;
    const canvas = canvasDrafts.get(scopeKey(context));
    const editable = canEdit(context.documentRole);
    // An old inspector snapshot is visible while synchronizing, but it must not submit stale edits.
    const blocked = !editable || Boolean(op) || Boolean(modelKey && resolvedModelKey !== modelKey);
    const upload = uploads.get(context.documentId);
    const uploading = upload?.state === 'pending';
    element('asset-upload-file').disabled = !editable || Boolean(upload);
    element('asset-upload').disabled = !editable || Boolean(upload);
    element('asset-upload-retry').hidden = !editable || upload?.state !== 'uncertain';
    element('asset-upload-status').textContent = uploading ? 'Загрузка изображения…' :
      upload?.state === 'uncertain' ? 'Подтверждение не получено. Повторите загрузку.' : palette?.uploadStatus || '';
    element('asset-upload-error').textContent = palette?.uploadError || '';
    kindSelect.disabled = parentSelect.disabled = blocked;
    for (const field of paletteFields.values()) field.setDisabled(blocked);
    for (const field of paletteOptionalFields.values()) field.setDisabled(blocked);
    for (const field of inspectorFields.values()) field.setDisabled(!editable || Boolean(op && !op.canvas));
    const validParent = model?.kinds.size && eligibleParent();
    const requiredReady = [...paletteFields.values()].every(field => field.validate(false).value !== undefined);
    const optionalReady = [...paletteOptionalFields].every(([name, field]) =>
      !palette?.values.has(name) || field.validate(false).value !== undefined);
    element('visual-add').disabled = blocked || !validParent || !requiredReady || !optionalReady;
    const save = element('visual-save');
    save.hidden = !editable;
    save.disabled = blocked || !inspector?.values.size;
    element('visual-properties-reset').hidden = !editable || !inspector?.values.size;
    element('visual-properties-reset').disabled = blocked;
    element('visual-add-retry').hidden = !editable || !adding || op.state !== 'uncertain';
    element('visual-save-retry').hidden = !editable || !editing || op.state !== 'uncertain';
    element('visual-palette-retry').hidden = element('visual-data-retry').hidden = !loadError;
    element('visual-palette-error').textContent = loadError || palette?.error || '';
    element('visual-inspector-error').textContent = loadError || inspector?.error || '';
    element('canvas-edit-error').textContent = canvas?.error || '';
    element('canvas-edit-status').textContent = op?.canvas ?
      operationStatus(op, 'Сохранение геометрии…') : canvas?.status || '';
    element('canvas-edit-retry').hidden = !editable || !op?.canvas || op.state !== 'uncertain';
    const defaults = model?.kinds.get(palette?.kind)?.properties;
    const geometry = ['width', 'height', 'x', 'y'].map(name => defaults?.[name]?.defaultValue?.value);
    const geometryHint = geometry.every(Number.isFinite) ?
      `Размер ${geometry[0]} × ${geometry[1]}, положение X ${geometry[2]}, Y ${geometry[3]}.` : '';
    const loading = scopeKey(context) && !model && !loadError ? 'Загрузка профиля…' : '';
    const paletteStatus = !validParent && model?.kinds.size ?
      'Выбранный слой не допускает дочерние элементы. Укажите экран или выберите контейнер.' :
      model && !model.kinds.size ? 'Профиль документа не содержит визуальных видов.' : geometryHint;
    element('visual-palette-status').textContent = adding ?
      operationStatus(op, 'Добавление элемента…') : loading || [palette?.status, paletteStatus].filter(Boolean).join(' ');
    element('visual-inspector-status').textContent = editing ?
      operationStatus(op, 'Сохранение свойств…') : loading || inspector?.status || '';
  }

  function operationStatus(op, pending) {
    return op.state === 'uncertain' ? 'Подтверждение не получено. Повторите ту же команду.' : pending;
  }

  function readProperties(fields, names) {
    const properties = {};
    let invalid;
    for (const name of names) {
      const { value, input, error } = fields.get(name).validate();
      if (error) invalid ??= input;
      else if (value !== undefined) properties[name] = value;
    }
    invalid?.focus();
    return invalid ? null : properties;
  }

  element('asset-upload-file').addEventListener('change', () => {
    if (palette) palette.uploadError = palette.uploadStatus = '';
    updateControls();
  });
  element('asset-upload-form').addEventListener('submit', event => {
    event.preventDefault();
    const current = getContext(), file = element('asset-upload-file').files[0];
    const scope = scopeKey(current);
    if (!file || !scope || !canEdit(current.documentRole) || uploads.has(current.documentId)) return;
    // Uploads may start before the async palette render finishes. Bind the
    // operation to its scoped draft rather than the potentially unset UI field.
    if (!paletteDrafts.has(scope))
      paletteDrafts.set(scope, { ...draft(), kind: '', parent: null, selectionId: undefined });
    const op = { documentId: current.documentId, token: current.token, epoch: current.navigationEpoch,
      assetId: crypto.randomUUID(), commandId: crypto.randomUUID(), file, draft: paletteDrafts.get(scope) };
    uploads.set(op.documentId, op);
    sendUpload(op);
  });
  element('asset-upload-retry').addEventListener('click', () => {
    const op = uploads.get(getContext().documentId);
    if (op?.state === 'uncertain' && canEdit(getContext().documentRole)) sendUpload(op);
  });

  async function sendUpload(op) {
    const view = getContext();
    op.token = view.token; op.epoch = view.navigationEpoch;
    const current = () => uploads.get(op.documentId) === op && getContext().documentId === op.documentId &&
      getContext().token === op.token && getContext().navigationEpoch === op.epoch;
    op.state = 'pending'; op.draft.uploadError = op.draft.uploadStatus = '';
    updateControls();
    stopLive();
    try {
      const result = await request(`/api/v1/documents/${encodeURIComponent(op.documentId)}/assets/${op.assetId}?commandId=${op.commandId}`,
        { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: op.file }, undefined, current);
      if (!current() || result.status !== 'ACCEPTED' || result.commandId !== op.commandId ||
        result.documentId?.toLowerCase() !== op.documentId.toLowerCase() || !Number.isSafeInteger(result.revision) ||
        !await refreshDocument(result.revision, current, [], undefined, true)) {
        op.state = 'uncertain';
        return;
      }
      uploads.delete(op.documentId);
      element('asset-upload-file').value = '';
      op.draft.uploadStatus = 'Изображение загружено. Выберите его в поле «Ассет».';
    } catch (error) {
      if (!current() || error.status == null || error.status === 408 || error.status >= 500) op.state = 'uncertain';
      else {
        uploads.delete(op.documentId);
        if (error.code === 'DOCUMENT_NOT_FOUND') { closeInaccessibleDocument(error.status); return; }
        op.draft.uploadError = error.code === 'ASSET_LIMIT_EXCEEDED' ? 'Достигнут лимит ассетов документа.' :
          error.status === 413 ? 'Файл превышает 5 МиБ.' :
          error.status === 400 || error.status === 415 ? 'Сервер отклонил изображение. Выберите допустимый PNG.' : error.message;
      }
    } finally { startLive(); refresh(); }
  }

  kindSelect.addEventListener('change', () => {
    if (palette.kind === kindSelect.value) return;
    palette.kind = kindSelect.value;
    palette.values.clear();
    palette.error = palette.status = '';
    renderRequiredFields();
    updateControls();
  });
  parentSelect.addEventListener('change', () => {
    palette.parent = parentSelect.value;
    palette.error = palette.status = '';
    updateControls();
  });
  element('visual-palette-form').addEventListener('submit', event => {
    event.preventDefault();
    const kind = model?.kinds.get(kindSelect.value);
    if (!kind || !eligibleParent() || !canEdit(getContext().documentRole)) return;
    const properties = readProperties(paletteFields, paletteFields.keys());
    if (!properties) return;
    const optionalNames = [...palette.values.keys()].filter(name => paletteOptionalFields.has(name));
    const selected = readProperties(paletteOptionalFields, optionalNames);
    if (!selected) return;
    begin('add-node', {
      nodeId: crypto.randomUUID(), parentId: parentSelect.value, kind: kind.kind,
      properties: { ...properties, ...selected }
    }, palette);
  });
  element('visual-properties-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!inspector?.values.size || !canEdit(getContext().documentRole)) return;
    const names = [...inspector.values.keys()].filter(name => inspectorFields.has(name));
    if (!names.length) return;
    const properties = readProperties(inspectorFields, names);
    if (!properties) return;
    const expectedParentId = Object.hasOwn(properties, 'x') || Object.hasOwn(properties, 'y') ? inspector.coordinateParentId : undefined;
    const current = getContext();
    if (current.variantId)
      begin('set-screen-variant-properties', { screenId: current.screen, variantId: current.variantId,
        nodeId: node.id, expectedRevision: current.revision, properties }, inspector);
    else begin('set-node-properties', { nodeId: node.id, properties, expectedParentId }, inspector);
  });
  element('visual-properties-reset').addEventListener('click', () => {
    if (!inspector || operations.has(scopeKey(getContext())) || !canEdit(getContext().documentRole)) return;
    inspector.values.clear();
    inspector.coordinateParentId = undefined;
    inspector.error = inspector.status = '';
    render();
    inspectorProperties.querySelector('input, select, textarea')?.focus();
  });
  for (const id of ['visual-palette-retry', 'visual-data-retry'])
    element(id).addEventListener('click', () => { load(modelKey); updateControls(); });
  for (const id of ['visual-add-retry', 'visual-save-retry', 'canvas-edit-retry'])
    element(id).addEventListener('click', () => {
      const op = operations.get(scopeKey(getContext()));
      if (op?.state === 'uncertain' && canEdit(getContext().documentRole)) send(op);
    });

  function begin(command, body, state, canvas = null) {
    const current = getContext(), key = scopeKey(current);
    if (!key || scopeKey(context) !== key || context.revision !== current.revision ||
      context.selection?.id !== current.selection?.id || operations.has(key) ||
      resolvedModelKey !== modelKey) return false;
    const op = { key, command, state: 'ready', draft: state, documentId: current.documentId, screen: current.screen,
      selectionId: current.selection?.id, body: { commandId: crypto.randomUUID(), ...body },
      canvas: Boolean(canvas), settlePreview: canvas };
    operations.set(key, op);
    send(op);
    return true;
  }

  async function send(op) {
    const { token, navigationEpoch } = getContext(), adding = op.command === 'add-node';
    const current = () => {
      const view = getContext();
      return operations.get(op.key) === op && scopeKey(view) === op.key &&
        view.token === token && view.navigationEpoch === navigationEpoch;
    };
    op.state = 'pending';
    op.draft.error = op.draft.status = '';
    updateControls();
    stopLive();
    let confirmed = false;
    try {
      const result = await request(`/api/v1/documents/${encodeURIComponent(op.documentId)}/commands/${op.command}`, {
        method: 'POST', body: JSON.stringify(op.body)
      }, undefined, current);
      if (!current() || result.status !== 'ACCEPTED' || result.documentId?.toLowerCase() !== op.documentId.toLowerCase() ||
        result.commandId !== op.body.commandId || result.nodeId !== op.body.nodeId || !Number.isSafeInteger(result.revision)) {
        op.state = 'uncertain';
        return;
      }
      const reveal = adding && op.body.parentId !== op.screen ? [op.body.parentId] : [];
      const selection = adding ? { nodeId: op.body.nodeId, previousId: op.selectionId } : undefined;
      const synced = await refreshDocument(result.revision, current, reveal, selection);
      if (!synced) {
        op.state = 'uncertain';
        return;
      }
      operations.delete(op.key);
      confirmed = true;
      op.draft.values.clear();
      op.draft.coordinateParentId = undefined;
      op.draft.status = adding ? 'Элемент добавлен.' : op.canvas ? 'Геометрия сохранена.' : 'Свойства сохранены.';
      if (scopeKey(getContext()) === op.key) updateControls();
    } catch (error) {
      if (!current() || error.status == null || error.status === 408 || error.status >= 500) op.state = 'uncertain';
      else {
        operations.delete(op.key);
        if (error.code === 'DOCUMENT_NOT_FOUND') {
          closeInaccessibleDocument(error.status);
          return;
        }
        const property = error.property ? `${propertyLabel(error.property)} · ` : '';
        op.draft.error = property + (error.detail || error.message);
      }
    } finally {
      op.settlePreview?.(confirmed);
      op.settlePreview = null;
      startLive();
      refresh();
    }
  }

  function editGeometry(body, settlePreview) {
    const current = getContext(), key = scopeKey(current);
    if (!key || !canEdit(current.documentRole) || current.revision !== body.expectedRevision ||
      current.selection?.id !== body.nodeId || operations.has(key)) return false;
    if (!canvasDrafts.has(key)) canvasDrafts.set(key, draft());
    return begin(current.variantId ? 'set-screen-variant-properties' : 'set-node-properties',
      current.variantId ? {
        screenId: current.screen, variantId: current.variantId,
        nodeId: body.nodeId, properties: body.properties, expectedRevision: body.expectedRevision
      } : body,
      canvasDrafts.get(key), settlePreview);
  }

  return {
    refresh, editGeometry,
    get editPending() { return operations.has(scopeKey(getContext())); },
    clear() { operations.clear(); uploads.clear(); paletteDrafts.clear(); inspectorDrafts.clear(); canvasDrafts.clear(); }
  };
}
