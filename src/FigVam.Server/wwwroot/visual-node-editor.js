import { createPropertyControl, propertyLabel, shadowPreset } from './node-property-controls.js';

import { paddingProperties, createPaddingEditor, updatePaddingEditor, createGapRow, updateGapRow } from './padding-editor.js';

const canEdit = role => role === 'Owner' || role === 'Editor';
const sameRaw = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const draft = () => ({ values: new Map(), error: '', status: '' });
const scopeKey = context => context.screen && Number.isSafeInteger(context.revision) ?
  `${context.documentId}:${context.screen}` : null;

export function createVisualNodeEditor({
  element, request, getContext, readModel, refreshDocument, closeInaccessibleDocument, stopLive, startLive, previewProperties = () => {}
}) {
  const kindSelect = element('visual-kind'), parentSelect = element('visual-parent');
  const paletteProperties = element('visual-required-properties');
  const paletteOptional = element('visual-optional-properties'), paletteDetails = element('visual-optional-details');
  const inspectorProperties = element('visual-properties');
  const textStyledFields = new Set(['textColor', 'fontFamily', 'fontSize', 'fontWeight',
    'lineHeight', 'letterSpacing', 'fontStyle', 'fontFallback']);
  const borderStyledFields = new Set(['borderColor', 'borderWidth', 'cornerRadius']);
  const operations = new Map(), paletteDrafts = new Map(), inspectorDrafts = new Map(), canvasDrafts = new Map();
  let context, model, modelKey, resolvedModelKey, modelScope, loadedKey, loadError = '', queued = false;
  let palette, inspector, node, paletteFields = new Map(), paletteOptionalFields = new Map(), inspectorFields = new Map();
  let paletteControlKey = null, inspectorControlKey = null;
  let loadingFocus, uploadDocument;
  const uploads = new Map();
  const automatic = new Map();
  let applyTimer;

  // Each entry owns a captured target and validated snapshots, not DOM references.
  // New input remains editable while a previous snapshot awaits acknowledgement.
  function scheduleApply(state, name, field, immediate = false, previewOnly = false) {
    let entry = automatic.get(state);
    if (!entry) {
      const current = getContext();
      entry = { target: { ...current, nodeId: node.id }, fields: new Map(), due: 0, rejected: false };
      automatic.set(state, entry);
    }
    const result = field.validate(false);
    if (state.values.has(name) && result.value !== undefined && !result.error)
      entry.fields.set(name, { raw: field.read(), value: result.value });
    else entry.fields.delete(name);
    entry.rejected = false;
    previewProperties(entry.target, Object.fromEntries([...entry.fields].map(([key, item]) => [key, item.value])));
    entry.due = previewOnly ? Infinity : Date.now() + (immediate ? 0 : 500);
    planApply();
  }

  function planApply() {
    clearTimeout(applyTimer);
    const current = getContext();
    const ready = [...automatic.entries()].filter(([state, entry]) =>
      entry.fields.size && Number.isFinite(entry.due) && !entry.rejected && entry.target.token === current.token &&
      (entry.target.documentId !== current.documentId || canEdit(current.documentRole)) &&
      ![...operations.values()].some(op => op.documentId === entry.target.documentId));
    if (!ready.length) return;
    applyTimer = setTimeout(pumpApply, Math.max(0, Math.min(...ready.map(([, entry]) => entry.due)) - Date.now()));
  }

  function pumpApply() {
    const current = getContext();
    for (const [state, entry] of automatic) {
      const target = entry.target;
      if (!entry.fields.size || entry.rejected || entry.due > Date.now() || target.token !== current.token ||
          [...operations.values()].some(op => op.documentId === target.documentId)) continue;
      if (current.documentId === target.documentId && !canEdit(current.documentRole)) continue;
      const sent = new Map(entry.fields);
      const properties = Object.fromEntries([...sent].map(([name, item]) => [name, item.value]));
      const expectedRevision = current.documentId === target.documentId && Number.isSafeInteger(current.revision)
        ? current.revision : target.revision;
      const body = target.variantId
        ? { screenId: target.screen, variantId: target.variantId, nodeId: target.nodeId, expectedRevision, properties }
        : { nodeId: target.nodeId, properties, expectedParentId: Object.hasOwn(properties, 'x') || Object.hasOwn(properties, 'y') ? state.coordinateParentId : undefined };
      const key = scopeKey(target);
      const op = { key, command: target.variantId ? 'set-screen-variant-properties' : 'set-node-properties',
        state: 'ready', draft: state, documentId: target.documentId, screen: target.screen,
        selectionId: target.nodeId, body: { commandId: crypto.randomUUID(), ...body }, auto: true, sent };
      operations.set(key, op);
      send(op);
    }
    // A new edit or completed operation will wake blocked entries; do not spin.
  }

  function finishApply(state) {
    const entry = automatic.get(state);
    if (!entry || entry.rejected) return;
    if (entry.due === Infinity) return;
    entry.due = 0;
    planApply();
  }

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
      const renderKey = `${scope}:${context.variantId ?? "base"}:${selectionId}:${context.documentRole}:${context.navigationEpoch}:${context.theme}`;
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
      const signature = JSON.stringify([definition, choices, Boolean(state), context.theme]);
      const valueSignature = JSON.stringify(values?.[name] ?? definition.defaultValue);
      let field = existing.get(name);
      if (!field || field.signature !== signature) {
        field = createPropertyControl(name, definition, model, values?.[name], prefix, context.theme);
        field.signature = signature;
        field.valueSignature = valueSignature;
        function update(event) {
          const raw = field.read();
          const automaticField = prefix === 'visual-property';
          const target = event.target;
          const discrete = event.type === 'change' && target.matches('select, input[type=checkbox], input[type=color], .token-value-link');
          // Browsers emit both input and change, including a delayed change on blur.
          // A no-op must not clear the last acknowledgement or requeue saved values.
          if (automaticField && sameRaw(field.lastRaw, raw)) {
            if (discrete && automatic.get(state)?.fields.has(name)) {
              automatic.get(state).due = 0; planApply();
            }
            return;
          }
          field.lastRaw = raw;
          const inFlight = [...operations.values()].find(op => op.auto && op.draft === state)?.sent.has(name);
          if (sameRaw(field.baseline, raw) && !inFlight && !(name === 'shadow' && !field.hasValue && state.values.has(name))) state.values.delete(name);
          else state.values.set(name, raw);
          if (state === inspector && (name === 'x' || name === 'y')) {
            if (state.values.has('x') || state.values.has('y')) state.coordinateParentId ??= node.parentId;
            else state.coordinateParentId = undefined;
          }
          state.error = state.status = '';
          field.validate();
          if (automaticField) {
            // A native color picker may emit many input events before its change event.
            if (target.matches('input[type=color]') && event.type === 'input') {
              scheduleApply(state, name, field, false, true); updateControls(); return;
            }
            scheduleApply(state, name, field, discrete);
          }
          updateControls();
        }
        if (state) {
          field.row.addEventListener('input', update);
          field.row.addEventListener('change', update);
          if (prefix === 'visual-property') {
            field.row.addEventListener('focusout', event => {
              if (!field.row.contains(event.relatedTarget)) finishApply(state);
            });
            field.row.addEventListener('keydown', event => {
              if (event.isComposing) return;
              if (event.key === 'Enter' && event.target.matches('input:not([type=search])')) {
                event.preventDefault(); finishApply(state);
              }
              if (event.key === 'Escape' && event.target.matches('input, textarea') && !event.target.closest('.token-value-popover')) {
                const op = [...operations.values()].find(item => item.auto && item.draft === state);
                if (op?.sent.has(name)) return;
                state.values.delete(name); automatic.get(state)?.fields.delete(name);
                const entry = automatic.get(state);
                if (entry) previewProperties(entry.target, Object.fromEntries([...entry.fields].map(([key, item]) => [key, item.value])));
                field.write(field.baseline); field.lastRaw = field.read(); field.validate(); state.error = ''; updateControls(); planApply();
              }
            });
          }
        }
      } else if (field.valueSignature !== valueSignature) {
        // Create a detached control for a changed baseline, never replace the live DOM.
        field.baseline = createPropertyControl(name, definition, model, values?.[name], prefix, context.theme).baseline;
        field.valueSignature = valueSignature;
      }
      field.hasValue = values?.[name] !== undefined;
      if (state?.values.has(name)) {
        const value = state.values.get(name);
        if (!sameRaw(field.read(), value)) field.write(value);
        field.validate();
      } else if (!sameRaw(field.read(), field.baseline)) field.write(field.baseline);
      field.lastRaw = field.read();
      if (prefix === 'visual-property') {
        const overridden = Boolean(context.variantId && model?.overridden?.get(node?.id)?.has(name));
        field.row.dataset.variantOverride = String(overridden);
        const hasStyle = textStyledFields.has(name) ? node?.properties.textStyle?.type === 'style'
          || node?.properties.typography?.type === 'token' && name !== 'textColor'
          : borderStyledFields.has(name) && node?.properties.borderStyle?.type === 'style';
        const localOverride = !context.variantId && hasStyle && node?.properties[name] !== undefined;
        field.row.dataset.styleOverride = String(Boolean(localOverride));
        let styleReset = field.row.querySelector('.style-override-reset');
        if (!styleReset && localOverride && state) {
          styleReset = document.createElement('button');
          styleReset.className = 'style-override-reset';
          styleReset.type = 'button';
          styleReset.textContent = 'Сбросить к стилю';
          styleReset.setAttribute('aria-label', 'Сбросить к стилю: ' + propertyLabel(name));
          styleReset.addEventListener('click', () => {
            const current = getContext();
            if (current.variantId || !node || !canEdit(current.documentRole)) return;
            begin('remove-node-properties', {
              nodeId: node.id, properties: [name], expectedRevision: current.revision
            }, inspector);
          });
          field.row.append(styleReset);
        }
        if (styleReset) styleReset.hidden = !localOverride || !state;
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
      if (name === 'shadow' && prefix === 'visual-property') {
        let section = container.querySelector(':scope > .shadow-effects');
        if (!section) {
          section = document.createElement('section');
          section.className = 'shadow-effects';
        }
        const title = section.querySelector('strong') ?? document.createElement('strong');
        title.textContent = 'Effects';
        const active = values?.shadow !== undefined || state?.values.has(name);
        const action = section.querySelector('.shadow-action') ?? document.createElement('button');
        action.type = 'button';
        action.className = 'shadow-action';
        action.textContent = active ? 'Remove drop shadow' : 'Add drop shadow';
        action.onclick = () => {
          const current = getContext();
          if (!state || !canEdit(current.documentRole) || operations.has(scopeKey(current)) ||
              resolvedModelKey !== modelKey) return;
          if (!active) {
            const preset = createPropertyControl(name, definition, model, shadowPreset, prefix, context.theme).baseline;
            state.values.set(name, preset);
            render();
            scheduleApply(state, name, inspectorFields.get(name), true);
          } else if (current.variantId) {
            if (model?.overridden?.get(node.id)?.has(name))
              begin('remove-screen-variant-override', { screenId: current.screen, variantId: current.variantId,
                nodeId: node.id, property: name, expectedRevision: current.revision }, state);
            else if (state.values.has(name)) { state.values.delete(name); render(); }
          } else if (values?.shadow !== undefined) {
            begin('remove-node-properties', { nodeId: node.id, properties: [name],
              expectedRevision: current.revision }, state);
          } else {
            state.values.delete(name);
            render();
          }
        };
        action.hidden = !state || Boolean(currentlyInheritedShadow());
        function currentlyInheritedShadow() {
          return active && context.variantId && values?.shadow !== undefined &&
            !model?.overridden?.get(node.id)?.has(name) && !state?.values.has(name);
        }
        field.row.hidden = !active;
        reconcileChildren(section, [title, field.row, action]);
        rows.push(section);
      } else rows.push(field.row);
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
    if (prefix === 'visual-property' && paddingProperties.every(name => fields.has(name))) {
      const paddingRows = paddingProperties.map(name => fields.get(name).row);
      const padding = container.querySelector(':scope > .padding-editor') ?? createPaddingEditor();
      updatePaddingEditor(padding, fields, reconcileChildren);
      // Keep the section at the first padding property's original position.
      const index = rows.findIndex(row => paddingRows.includes(row));
      rows.splice(index, 0, padding);
      paddingRows.forEach(row => groupedRows.add(row));
      if (fields.has('gap')) {
        const gapField = fields.get('gap');
        const gap = container.querySelector(':scope > .padding-gap-row') ?? createGapRow();
        updateGapRow(gap, gapField, reconcileChildren);
        rows.splice(index + 1, 0, gap);
        groupedRows.add(gapField.row);
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
      editing = ['set-node-properties', 'set-screen-variant-properties', 'remove-screen-variant-override', 'remove-node-properties'].includes(op?.command) && !op.canvas;
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
    for (const [name, field] of inspectorFields) field.setDisabled(!editable || Boolean(op && !op.canvas && !op.auto));
    for (const button of inspectorProperties.querySelectorAll('.shadow-action, .variant-override-reset, .style-override-reset'))
      button.disabled = blocked;
    const validParent = model?.kinds.size && eligibleParent();
    const requiredReady = [...paletteFields.values()].every(field => field.validate(false).value !== undefined);
    const optionalReady = [...paletteOptionalFields].every(([name, field]) =>
      !palette?.values.has(name) || field.validate(false).value !== undefined);
    element('visual-add').disabled = blocked || !validParent || !requiredReady || !optionalReady;
    const autoEntry = automatic.get(inspector);
    element('visual-properties-reset').hidden = !editable || !inspector?.values.size;
    element('visual-properties-reset').disabled = blocked;
    element('visual-add-retry').hidden = !editable || !adding || op.state !== 'uncertain';
    element('visual-save-retry').hidden = !editable || !(editing && op.state === 'uncertain' || autoEntry?.rejected && autoEntry.fields.size);
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
      operationStatus(op, 'Сохранение свойств…') : loading || (autoEntry?.fields.size && !autoEntry.rejected ? 'Сохранение свойств…' : inspector?.status || '');
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
    finishApply(inspector);
  });
  element('visual-properties-reset').addEventListener('click', () => {
    if (!inspector || operations.has(scopeKey(getContext())) || !canEdit(getContext().documentRole)) return;
    const entry = automatic.get(inspector);
    if (entry) previewProperties(entry.target, {});
    automatic.delete(inspector);
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
      else if (id === 'visual-save-retry' && automatic.get(inspector)?.rejected) {
        automatic.get(inspector).rejected = false; finishApply(inspector);
      }
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
      return operations.get(op.key) === op && view.token === token &&
        (op.auto || scopeKey(view) === op.key && view.navigationEpoch === navigationEpoch);
    };
    op.state = 'pending';
    op.draft.error = op.draft.status = '';
    updateControls();
    if (getContext().documentId === op.documentId) stopLive();
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
      const view = getContext();
      const activeDocument = view.documentId === op.documentId && canEdit(view.documentRole);
      const activeSync = () => current() && getContext().documentId === op.documentId && getContext().navigationEpoch === view.navigationEpoch;
      const synced = !op.auto || activeDocument ? await refreshDocument(result.revision, op.auto ? activeSync : current, reveal, selection) : true;
      if (!synced && !op.auto) {
        op.state = 'uncertain';
        return;
      }
      operations.delete(op.key);
      confirmed = true;
      if (op.command === 'remove-node-properties' || op.command === 'remove-screen-variant-override') {
        for (const property of op.body.properties ?? [op.body.property]) op.draft.values.delete(property);
      } else if (op.auto) {
        const entry = automatic.get(op.draft);
        for (const [name, item] of op.sent) {
          if (sameRaw(op.draft.values.get(name), item.raw)) op.draft.values.delete(name);
          if (entry && sameRaw(entry.fields.get(name)?.raw, item.raw)) entry.fields.delete(name);
        }
        if (!op.draft.values.has('x') && !op.draft.values.has('y')) op.draft.coordinateParentId = undefined;
        if (entry) {
          previewProperties(entry.target, Object.fromEntries([...entry.fields].map(([key, item]) => [key, item.value])));
          entry.target.revision = result.revision;
        }
        if (!op.draft.values.size) automatic.delete(op.draft);
      } else {
        op.draft.values.clear();
        op.draft.coordinateParentId = undefined;
      }
      op.draft.status = adding ? 'Элемент добавлен.' : op.canvas ? 'Геометрия сохранена.' : 'Свойства сохранены.';
      if (scopeKey(getContext()) === op.key && (!op.auto || resolvedModelKey === modelKey)) render();
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
        if (op.auto && automatic.has(op.draft)) {
          const entry = automatic.get(op.draft);
          entry.rejected = true; previewProperties(entry.target, {});
        }
      }
    } finally {
      op.settlePreview?.(confirmed);
      op.settlePreview = null;
      startLive();
      refresh();
      planApply();
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
    clear() { clearTimeout(applyTimer); automatic.clear(); operations.clear(); uploads.clear(); paletteDrafts.clear(); inspectorDrafts.clear(); canvasDrafts.clear(); }
  };
}
