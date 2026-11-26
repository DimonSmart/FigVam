import { createTokenValueControl } from './token-value-control.js';
import { tokenSegments, buildTokenGroups, shortTokenName, tokenNameError, tokenNameDiagnostics, visibleTokens, qualifyTokenName } from './token-groups.js';
import { normalizedTokenType, normalizedTokenCategory, resolveTokenValue, tokenValueText } from './token-resolution.js';

const types = ['Color', 'Spacing', 'Typography', 'Geometry', 'Dimension', 'Number', 'FontFamily', 'FontWeight'];
const categories = ['Spacing', 'FontSize', 'Radius', 'BorderWidth', 'Size', 'LineHeight', 'Opacity', 'LetterSpacing'];
const allowedCategories = {
  Dimension: ['Spacing', 'FontSize', 'Radius', 'BorderWidth', 'Size', 'LetterSpacing'],
  Number: ['LineHeight', 'Opacity']
};
const typeIndex = type => types.indexOf(normalizedTokenType(type));
const categoryIndex = category => category == null ? null : categories.indexOf(normalizedTokenCategory(category));

function literalExpression(type, category, raw) {
  const valueType = normalizedTokenType(type);
  if (valueType === 'Color') {
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(raw))
      throw new Error('Введите цвет как #RRGGBB или #RRGGBBAA.');
    const hex = raw.slice(1) + (raw.length === 7 ? 'FF' : '');
    const [red, green, blue, alpha] = [0, 2, 4, 6].map(i => parseInt(hex.slice(i, i + 2), 16));
    return { expression: 'literal', value: { type: 'color', red, green, blue, alpha } };
  }
  if (valueType === 'FontFamily') {
    if (raw.length > 128 || !/^[\p{L}\p{N}][\p{L}\p{M}\p{N} _-]*$/u.test(raw))
      throw new Error('Введите корректное непустое имя семейства шрифта (до 128 символов).');
    return { expression: 'literal', value: { type: 'fontFamily', value: raw } };
  }
  if (valueType === 'Typography') throw new Error('Используйте поля составной типографики.');
  if (!raw.trim() || !Number.isFinite(Number(raw))) throw new Error('Введите конечное число.');
  const value = Number(raw), c = normalizedTokenCategory(category);
  if (valueType === 'FontWeight' && (!Number.isInteger(value) || value < 1 || value > 1000))
    throw new Error('Толщина шрифта должна быть целым числом от 1 до 1000.');
  if (valueType === 'Dimension' && (value < (c === 'FontSize' ? 1 : c === 'LetterSpacing' ? -100 : 0) ||
      value > (c === 'FontSize' ? 1024 : c === 'LetterSpacing' ? 100 : 1000000)))
    throw new Error('Размер выходит за пределы допустимого диапазона.');
  if (valueType === 'Number' && (value < (c === 'LineHeight' ? 0.1 : 0) ||
      value > (c === 'LineHeight' ? 10 : 1)))
    throw new Error('Число выходит за пределы допустимого диапазона.');
  if (valueType === 'Geometry' && value < 0) throw new Error('Радиус не может быть отрицательным.');
  const name = { Spacing: 'spacing', Geometry: 'geometry', Dimension: 'dimension',
    Number: 'number', FontWeight: 'fontWeight' }[valueType];
  if (!name) throw new Error('Неподдерживаемый тип токена.');
  return { expression: 'literal', value: name === 'geometry'
    ? { type: name, radius: value } : { type: name, value } };
}

function directText(expression) {
  if (expression?.expression !== 'literal') return '';
  return tokenValueText(expression.value).replace(/ px$/, '');
}

export function createTokens({ element, request, getContext, startRequest, stopLive, startLive, readPages }) {
  let tokenItems = [], selectedToken = null, tokenUsages = [], tokenLoad = 0, rendered = false;
  const el = element, editable = () => ['Owner', 'Editor'].includes(getContext().documentRole);
  let group = [], collapsed = new Set(), creating = false, usagesReady = false;
  let importEpoch = 0;
  let createControls = [], detailControls = [], renaming = false;
  const pendingThemeValues = new Map();
  let activeThemeSave = null;
  const busy = () => el('token-create').inert;
  function refreshAccess() {
    el('new-token-open').hidden = el('token-import-open').hidden = !editable();
    el('token-export').disabled = !editable();
    if (!editable()) { creating = false; pendingThemeValues.clear(); el('token-import-form').hidden = true; }
    el('token-edit').hidden = !editable();
    if (!editable()) endRename();
    el('token-rename-open').hidden = !editable() || renaming;
    detailControls.forEach(control => control.setDisabled(!editable()));
    updateDetailVisibility();
  }
  const selected = () => tokenItems.find(t => t.id === selectedToken);
  const groupKey = segments => JSON.stringify(segments);
  function updateDetailVisibility() {
    el('token-create').hidden = !creating || !editable();
    el('token-detail').hidden = creating || !selected();
    el('token-placeholder').hidden = creating || !!selected();
  }
  function beginCreate() {
    if (!editable() || busy()) return;
    creating = true; el('token-create').reset();
    endRename();
    updateCategoryOptions();
    el('new-token-name').placeholder = group.length ? group.join('.') + '.…' : 'Имя токена';
    el('new-token-name').value = group.length ? group.join('.') + '.' : '';
    updateDetailVisibility(); el('new-token-name').focus();
  }
  el('new-token-open').addEventListener('click', beginCreate);
  el('new-token-cancel').addEventListener('click', () => { creating = false; updateDetailVisibility(); });
  el('token-search').addEventListener('input', () => renderTokens(false));
  el('token-type-filter').addEventListener('change', () => renderTokens(false));
  el('token-import-open').addEventListener('click', () => {
    if (editable() && !busy()) el('token-import-form').hidden = !el('token-import-form').hidden;
  });
  for (const theme of ['light','dark']) {
    const field = el('token-import-' + theme), input = el('token-import-' + theme + '-file');
    let fileLoad = 0;
    input.addEventListener('change', async () => {
      const file = input.files?.[0], documentId = getContext().documentId, epoch = importEpoch, load = ++fileLoad;
      if (!file) return;
      try {
        if (file.size > 1024 * 1024) throw new Error('Файл токенов превышает 1 МиБ.');
        const value = await file.text();
        if (epoch === importEpoch && load === fileLoad && documentId === getContext().documentId && input.files?.[0] === file) field.value = value;
      } catch (error) {
        if (epoch === importEpoch && load === fileLoad && documentId === getContext().documentId) el('tokens-error').textContent = error.message;
      }
    });
  }
  el('token-import-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const lightJson = el('token-import-light').value, darkJson = el('token-import-dark').value;
      JSON.parse(lightJson); JSON.parse(darkJson);
      const mapping = JSON.parse(el('token-import-mapping').value || '{}');
      if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error('Некорректное сопоставление.');
      const convert = (values, names) => Object.fromEntries(Object.entries(values ?? {}).map(([key,value]) => {
        const index = typeof value === 'number' ? value : names.indexOf(value);
        if (!Number.isInteger(index) || index < 0 || index >= names.length) throw new Error('Неизвестный тип или категория: ' + value);
        return [key,index];
      }));
      tokenCommand('import-design-tokens', { expectedRevision: getContext().revision, lightJson, darkJson,
        dimensionTypes: convert(mapping.dimensionTypes, types),
        dimensionCategories: convert(mapping.dimensionCategories, categories),
        numberCategories: convert(mapping.numberCategories, categories) });
    } catch (error) { el('tokens-error').textContent = error.message; }
  });
  el('token-export').addEventListener('click', async () => {
    const { documentId, revision, navigationEpoch } = getContext(), theme = el('token-export-theme').value;
    const active = () => documentId === getContext().documentId && navigationEpoch === getContext().navigationEpoch;
    if (!editable() || !Number.isSafeInteger(revision)) return;
    el('tokens-error').textContent = '';
    try {
      const result = await request('/api/v1/documents/' + encodeURIComponent(documentId) + '/token-export?theme=' + theme + '&revision=' + revision);
      if (!active()) return;
      if (!result.tokens || result.diagnostics?.length) throw new Error((result.diagnostics ?? []).map(d => d.message).join('; ') || 'Экспорт недоступен.');
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.tokens, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'tokens-' + theme.toLowerCase() + '.json';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { if (active()) el('tokens-error').textContent = error.message; }
  });
  const typeOf = token => normalizedTokenType(token?.type);
  const categoryOf = token => normalizedTokenCategory(token?.category);
  const nameOf = id => tokenItems.find(t => t.id === id)?.name ?? 'Удалённый токен';
  const typographyFields = [
    { name: 'fontFamily', label: 'Шрифт', type: 'FontFamily', category: null, initial: 'Arial' },
    { name: 'fontSize', label: 'Размер, px', type: 'Dimension', category: 'FontSize', initial: '16' },
    { name: 'fontWeight', label: 'Толщина', type: 'FontWeight', category: null, initial: '400' },
    { name: 'lineHeight', label: 'Интерлиньяж', type: 'Number', category: 'LineHeight', initial: '1.25' },
    { name: 'letterSpacing', label: 'Межбуквенный интервал, px', type: 'Dimension', category: 'LetterSpacing', initial: '0' }
  ];
  // The shared control owns the literal/reference interaction; this adapter only
  // translates its values to the token command's literal/alias expression.
  const tokenIndex = () => new Map(tokenItems.map(token => [token.id, token]));
  function dependsOn(id, ownerId, theme, visited = new Set()) {
    if (!ownerId || !id || visited.has(id)) return false;
    if (id === ownerId) return true;
    visited.add(id);
    const expression = tokenItems.find(item => item.id === id)?.values?.[theme];
    if (expression?.expression === 'alias') return dependsOn(expression.tokenId, ownerId, theme, visited);
    if (expression?.value?.type === 'typographyFields')
      return typographyFields.some(field => dependsOn(expression.value[field.name]?.tokenId, ownerId, theme, visited));
    return false;
  }
  function makeTokenControl(prefix, label, type, category, theme, expression, ownerId, initialText = '') {
    const literal = expression?.expression === 'literal' ? expression.value : null;
    let direct;
    if (type === 'Typography') {
      const holder = document.createElement('div'); holder.className = 'token-composite-direct';
      holder.id = prefix + '-typography';
      const children = typographyFields.map(field => {
        const child = makeTokenControl(prefix + '-' + field.name + '-value', field.label, field.type,
          field.category, theme, typographyPart(literal, field), ownerId, field.initial);
        holder.append(...child.content);
        return child;
      });
      direct = {
        content: [holder], inputs: children.flatMap(child => child.inputs),
        initial: children.map(child => child.initial),
        read: () => children.map(child => child.read()),
        write: raw => children.forEach((child, i) => child.write(raw[i])),
        validate() {
          const value = { type: 'typographyFields' };
          for (const [i, child] of children.entries()) {
            const result = child.validate();
            if (result.error) return result;
            value[typographyFields[i].name] = asExpression(result.value);
          }
          return { value };
        },
        setDisabled: disabled => children.forEach(child => child.setDisabled(disabled)),
        refresh: () => children.forEach(child => child.refresh()),
        dispose: () => children.forEach(child => child.dispose())
      };
      direct.writeResolved = result => children.forEach((child, i) => {
        const field = typographyFields[i];
        child.write([field.type.toLowerCase(), result.error ? '' : String(result.value[field.name] ?? 0), '']);
      });
    } else {
      const holder = document.createElement('div'); holder.className = 'token-scalar-direct';
      const input = document.createElement('input'); input.id = prefix;
      input.setAttribute('aria-label', label); input.autocomplete = 'off';
      const inputs = [input]; let picker, preset;
      if (type === 'Color') {
        picker = document.createElement('input'); picker.type = 'color';
        picker.setAttribute('aria-label', 'Выбрать цвет ' + label);
        picker.addEventListener('input', () => {
          input.value = picker.value + (/^#[0-9a-f]{8}$/i.test(input.value) ? input.value.slice(7) : 'FF');
        });
        input.placeholder = '#RRGGBBAA'; inputs.push(picker); holder.append(picker);
      }
      if (type === 'FontWeight') {
        preset = document.createElement('select'); preset.setAttribute('aria-label', 'Пресет толщины ' + label);
        for (const [v, text] of [['','Custom'],['400','Normal'],['500','Medium'],['600','Semibold'],['700','Bold']])
          preset.add(new Option(text, v));
        preset.addEventListener('change', () => { if (preset.value) input.value = preset.value; });
        inputs.push(preset); holder.append(preset);
      }
      function sync() {
        if (picker && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(input.value)) picker.value = input.value.slice(0,7);
        if (preset) preset.value = ['400','500','600','700'].includes(input.value) ? input.value : '';
      }
      input.addEventListener('input', sync);
      holder.append(input);
      direct = {
        content: [holder], inputs, initial: literal ? directText(expression) : initialText,
        read: () => input.value,
        write: value => { input.value = value ?? ''; sync(); },
        validate() {
          try { return { value: literalExpression(type, category, input.value.trim()).value }; }
          catch (error) { return { input, error: error.message }; }
        },
        writeResolved: result => { direct.write(result.error ? '' : tokenValueText(result.value).replace(/ px$/, '')); }
      };
    }
    const control = createTokenValueControl(prefix, { type, tokenType: type, tokenCategory: category },
      { tokens: tokenIndex() }, expression?.expression === 'alias' ? { type: 'token', tokenId: expression.tokenId } : null,
      direct, label, label, {
        theme, customDirect: true, validateChoices: true,
        getToken: id => tokenItems.find(item => item.id === id),
        getCompatible: () => allowedAliases(type, category, ownerId).filter(item => !dependsOn(item.id, ownerId, theme)),
        resolve: id => dependsOn(id, ownerId, theme)
          ? { error: 'Цикл ссылок дизайн-токенов.' }
          : resolveTokenValue({ type: 'token', tokenId: id }, tokenIndex(), theme, type, category),
        writeResolved: direct.writeResolved
      });
    control.write(control.initial);
    return control;
  }
  function typographyPart(value, field) {
    if (value?.type === 'typographyFields') return value[field.name];
    if (value?.type === 'typography') return { expression: 'literal', value: {
      type: { FontFamily: 'fontFamily', Dimension: 'dimension', FontWeight: 'fontWeight', Number: 'number' }[field.type],
      value: value[field.name] ?? (field.name === 'letterSpacing' ? 0 : field.initial)
    } };
    return null;
  }
  const asExpression = value => value.type === 'token' ? { expression: 'alias', tokenId: value.tokenId } : { expression: 'literal', value };
  function readExpression(control) {
    const result = control.validate();
    if (result.error) { result.input?.setAttribute('aria-invalid', 'true'); throw new Error(result.error); }
    return asExpression(result.value);
  }
  function replaceThemeControls(hostId, previous, type, category, item) {
    previous.forEach(control => control.dispose());
    const host = el(hostId); host.replaceChildren();
    return ['Light','Dark'].map((theme, index) => {
      const prefix = (item ? 'token-' : 'new-token-') + theme.toLowerCase();
      const control = makeTokenControl(prefix, theme, type, category, theme, item?.values?.[theme], item?.id);
      const row = document.createElement('div'); row.className = 'token-theme-row'; row.dataset.theme = theme;
      row.append(...control.content); host.append(row);
      if (item) {
        control.setDisabled(!editable());
        row.addEventListener('change', () => {
          if ((busy() && !activeThemeSave) || !editable() || selectedToken !== item.id) return;
          try {
            control.inputs.forEach(input => input.removeAttribute('aria-invalid'));
            const value = readExpression(control);
            el('tokens-error').textContent = '';
            queueThemeSave(item.id, theme, index, value);
          } catch (error) {
            pendingThemeValues.delete(theme);
            el('tokens-error').textContent = error.message;
          }
        });
        row.addEventListener('keydown', event => {
          if (!event.isComposing && event.key === 'Enter' && event.target.matches('input:not([type=search]):not([type=color])')) {
            event.preventDefault(); event.target.blur();
          }
        });
      }
      return control;
    });
  }
  // Keep the two theme drafts independent. The existing document command pipeline
  // remains serialized, but saving Light must not discard an edit made in Dark.
  function queueThemeSave(tokenId, theme, index, value) {
    const baseline = activeThemeSave?.tokenId === tokenId && activeThemeSave.theme === theme
      ? activeThemeSave.value : selected()?.values?.[theme];
    if (JSON.stringify(value) === JSON.stringify(baseline)) pendingThemeValues.delete(theme);
    else pendingThemeValues.set(theme, { tokenId, theme, index, value, documentId: getContext().documentId });
    void flushThemeSaves();
  }
  async function flushThemeSaves() {
    if (activeThemeSave || busy() || !editable() || !pendingThemeValues.size) return;
    const operation = pendingThemeValues.values().next().value;
    pendingThemeValues.delete(operation.theme);
    if (operation.documentId !== getContext().documentId || operation.tokenId !== selectedToken) {
      pendingThemeValues.clear(); return;
    }
    activeThemeSave = operation;
    const saved = await tokenCommand('set-token-value', {
      tokenId: operation.tokenId, theme: operation.index, value: operation.value
    });
    if (activeThemeSave !== operation) return;
    activeThemeSave = null;
    if (!saved) { pendingThemeValues.clear(); return; }
    void flushThemeSaves();
  }
  function endRename() {
    renaming = false; el('token-rename').hidden = true; el('token-detail-title').hidden = false;
    el('token-rename-open').hidden = !editable();
  }
  function beginRename() {
    if (!selected() || !editable() || busy()) return;
    renaming = true; el('token-rename').hidden = false; el('token-detail-title').hidden = true;
    el('token-rename-open').hidden = true;
    const input = el('token-name'); input.value = selected().name; input.focus(); input.select();
  }

  function resetTokens() {
    tokenLoad++; importEpoch++; tokenItems = []; tokenUsages = []; selectedToken = null; rendered = false;
    pendingThemeValues.clear(); activeThemeSave = null;
    group = []; collapsed = new Set(); creating = false; usagesReady = false;
    el('token-search').value = el('token-type-filter').value = '';
    el('token-groups').replaceChildren(); el('token-import-form').reset(); el('token-import-form').hidden = true; el('token-import-form').inert = false;
    el('new-token-open').hidden = el('token-import-open').hidden = true; el('token-export').disabled = true;
    el('document-mode-editor').click(); updateDetailVisibility();
    el('token-create').inert = el('token-detail').inert = false;
    el('tokens-list').replaceChildren(); el('token-usages').replaceChildren();
    el('token-detail').hidden = true; el('token-create').hidden = true;
    el('tokens-error').textContent = ''; el('tokens-status').textContent = '';
    el('token-create').reset(); endRename();
    detailControls.forEach(control => control.dispose()); detailControls = []; el('token-values').replaceChildren();
    updateCategoryOptions();
  }
  async function readAllTokenPages(path, revision, signal, isCurrent) {
    const items = []; let total;
    do {
      const result = await request(`${path}?revision=${revision}&offset=${items.length}&limit=100`, {}, signal, isCurrent);
      if (result.revision !== revision || !Array.isArray(result.items) || !Number.isInteger(result.total))
        throw new Error('Некорректный ответ о токенах.');
      items.push(...result.items); total = result.total;
      if (!result.items.length && items.length < total) throw new Error('Неполный ответ о токенах.');
    } while (items.length < total);
    return items;
  }
  async function readTokens(base, revision, signal, isCurrent) {
    const items = await readAllTokenPages(`${base}/tokens`, revision, signal, isCurrent);
    const selection = selectedToken;
    const usages = selection && items.some(item => item.id === selection)
      ? await readAllTokenPages(`${base}/tokens/${encodeURIComponent(selection)}/usages`, revision, signal, isCurrent) : [];
    return { items, selection, usages };
  }
  async function readSelectedUsages(base, revision, signal, isCurrent) {
    const selection = selectedToken;
    const usages = selection ? await readAllTokenPages(`${base}/tokens/${encodeURIComponent(selection)}/usages`,
      revision, signal, isCurrent) : [];
    return { selection, usages };
  }
  function applySelectedUsages({ selection, usages }) {
    if (selection !== selectedToken) { selectToken(selectedToken); return; }
    if (!usagesReady || JSON.stringify(tokenUsages) !== JSON.stringify(usages)) { usagesReady = true; tokenUsages = usages; renderTokens(true, false); }
  }
  function applyTokens(snapshot) {
    const before = JSON.stringify([tokenItems, tokenUsages, selectedToken]), previousItem = JSON.stringify(selected());
    tokenItems = snapshot.items;
    createControls.forEach(control => control.refresh());
    detailControls.forEach(control => control.refresh());
    if (selectedToken !== snapshot.selection) { selectToken(selectedToken); return; }
    if (!tokenItems.some(item => item.id === selectedToken)) selectedToken = null;
    tokenUsages = snapshot.usages; usagesReady = true;
    if (!rendered || before !== JSON.stringify([tokenItems, tokenUsages, selectedToken])) {
      rendered = true;
      renderTokens(true, !activeThemeSave && previousItem !== JSON.stringify(selected()));
    }
  }

  function allowedAliases(type, category, excludeId = null) {
    const t = normalizedTokenType(type), c = normalizedTokenCategory(category);
    return tokenItems.filter(item => item.id !== excludeId && typeOf(item) === t && categoryOf(item) === c);
  }
  function updateCategoryOptions() {
    const type = el('new-token-type').value, choices = allowedCategories[type] ?? [];
    const category = el('new-token-category'), current = category.value;
    category.replaceChildren();
    for (const option of choices) category.add(new Option(option, option));
    if (choices.includes(current)) category.value = current;
    category.hidden = el('new-token-category-label').hidden = !choices.length;
    updateCreateMode();
  }
  function updateCreateMode() {
    createControls = replaceThemeControls('new-token-values', createControls,
      el('new-token-type').value, el('new-token-category').value || null, null);
  }
  function renderTokens(refreshDetail = true, refreshEditor = true) {
    const list = el('tokens-list'); list.replaceChildren();
    const tree = buildTokenGroups(tokenItems);
    const groups = el('token-groups'); groups.replaceChildren();
    function drawGroup(node, parent) {
      const row = document.createElement('div'); row.className = 'token-group-row';
      const key = groupKey(node.segments);
      if (node.children.size) {
        const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = collapsed.has(key) ? '▸' : '▾';
        toggle.setAttribute('aria-label', (collapsed.has(key) ? 'Раскрыть ' : 'Свернуть ') + (node.segments.join('.') || 'все группы'));
        toggle.setAttribute('aria-expanded', String(!collapsed.has(key)));
        toggle.onclick = () => { if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key); renderTokens(false); }; row.append(toggle);
      }
      const select = document.createElement('button'); select.type = 'button'; select.className = 'token-group-select';
      select.textContent = node.segments.at(-1) ?? 'Все токены';
      select.setAttribute('aria-pressed', String(key === groupKey(group)));
      select.onclick = () => { group = node.segments; el('token-search').value = ''; renderTokens(false); };
      if (!node.children.size) { const spacer = document.createElement('span'); spacer.setAttribute('aria-hidden','true'); row.append(spacer); }
      row.append(select); parent.append(row);
      if (!collapsed.has(key)) {
        const children = document.createElement('div'); children.className = 'token-group-children';
        for (const child of [...node.children.values()].sort((a,b) => a.segments.at(-1).localeCompare(b.segments.at(-1)))) drawGroup(child, children);
        parent.append(children);
      }
    }
    let active = tree;
    for (const segment of group) active = active?.children.get(segment);
    if (!active) group = [];
    drawGroup(tree, groups);
    const index = new Map(tokenItems.map(token => [token.id, token]));
    const nameDiagnostics = tokenNameDiagnostics(tokenItems);
    const search = el('token-search').value;
    for (const item of visibleTokens(tokenItems, group, search, el('token-type-filter').value, typeOf)) {
      const row = list.insertRow(), type = typeOf(item), category = categoryOf(item);
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = shortTokenName(item.name, search.trim() ? [] : group);
      button.title = item.name; button.setAttribute('aria-pressed', String(item.id === selectedToken));
      button.addEventListener('click', () => { if (!busy()) selectToken(item.id); }); row.insertCell().append(button);
      row.dataset.selected = String(item.id === selectedToken);
      row.insertCell().textContent = category ? type + '.' + category : type;
      const problems = [nameDiagnostics.get(item.id)].filter(Boolean);
      const sources = [];
      for (const currentTheme of ['Light','Dark']) {
        const cell = row.insertCell(), expression = item.values?.[currentTheme];
        const resolved = resolveTokenValue({ type: 'token', tokenId: item.id }, index, currentTheme, item.type, item.category);
        const alias = expression?.expression === 'alias';
        const nested = expression?.value?.type === 'typographyFields' && Object.values(expression.value).some(v => v?.expression === 'alias');
        sources.push(alias ? 'alias' : nested ? 'mixed' : 'literal');
        if (resolved.error) problems.push(currentTheme + ': ' + resolved.error);
        if (type === 'Color' && !resolved.error && resolved.value?.type === 'color') {
          const swatch = document.createElement('span'); swatch.className = 'token-color-swatch';
          swatch.style.backgroundColor = 'rgba(' + [resolved.value.red, resolved.value.green, resolved.value.blue, resolved.value.alpha / 255].join(',') + ')';
          cell.append(swatch);
        }
        const value = resolved.error ?? tokenValueText(resolved.value);
        if (alias) {
          const target = document.createElement('button'); target.type = 'button'; target.className = 'token-alias-link';
          target.textContent = '↳ ' + nameOf(expression.tokenId); target.title = value;
          target.onclick = () => {
            if (busy()) return;
            const item = index.get(expression.tokenId);
            group = tokenSegments(item.name).slice(0,-1);
            for (let i = 0; i <= group.length; i++) collapsed.delete(groupKey(group.slice(0,i)));
            el('token-search').value = ''; el('token-type-filter').value = '';
            selectToken(expression.tokenId);
          }; target.disabled = !index.has(expression.tokenId); cell.append(target, ' · ' + value);
        } else cell.append(value);
      }
      row.insertCell().textContent = sources[0] === sources[1] ? sources[0] : 'mixed';
      row.insertCell().textContent = item.id === selectedToken && usagesReady ? String(tokenUsages.length) : '—';
      const status = row.insertCell(); status.textContent = problems.length ? 'Ошибка' : '—'; status.title = problems.join('\n'); status.classList.toggle('token-invalid', !!problems.length);
    }
    if (!list.rows.length) { const cell = list.insertRow().insertCell(); cell.colSpan = 7; cell.textContent = 'Нет токенов в выбранном контексте.'; }
    
    const item = selected();
    updateDetailVisibility();
    if (!item || refreshDetail === false) return;
    el('token-detail-type').textContent = [typeOf(item), categoryOf(item)].filter(Boolean).join(' · ');
    el('token-detail-title').textContent = item.name;
    const diagnostics = [nameDiagnostics.get(item.id)].filter(Boolean);
    for (const selectedTheme of ['Light','Dark']) {
      const resolved = resolveTokenValue({ type: 'token', tokenId: item.id }, index, selectedTheme, item.type, item.category);
      if (resolved.error) diagnostics.push(selectedTheme + ': ' + resolved.error);
    }
    el('token-detail-diagnostic').textContent = diagnostics.join(' · ');
    el('token-edit').hidden = !editable();
    el('token-rename-open').hidden = !editable() || renaming;
    el('token-delete').disabled = !usagesReady || tokenUsages.length > 0;
    el('token-delete').title = tokenUsages.length ? 'У токена есть зависимости: ' + tokenUsages.length : 'Удалить токен';
    if (refreshEditor) {
      detailControls = replaceThemeControls('token-values', detailControls, typeOf(item), categoryOf(item), item);
    } else detailControls.forEach(control => control.refresh());
    const usages = el('token-usages'); usages.replaceChildren();
    usages.previousElementSibling.textContent = 'Использования' + (usagesReady ? ' · ' + tokenUsages.length : ' · загрузка…');
    for (const indirect of [false, true]) {
      const group = tokenUsages.filter(usage => Boolean(usage.indirect) === indirect);
      if (!group.length) continue;
      const heading = document.createElement('li');
      heading.textContent = (indirect ? 'Косвенные' : 'Прямые') + ' · ' + group.length;
      heading.className = 'resource-usage-group';
      usages.append(heading);
      for (const usage of group) {
        const li = document.createElement('li');
        li.textContent = [usage.label ?? usage.kind, usage.property,
          usage.theme == null ? null : 'тема ' + usage.theme].filter(x => x != null).join(' · ');
        li.title = (usage.chain ?? []).map(id => tokenItems.find(t => t.id === id)?.name ?? id).join(' → ');
        if (usage.kind === 'nodeProperty') {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = 'К слою';
          button.addEventListener('click', () => {
            const layer = [...document.querySelectorAll('#layers [role="treeitem"]')].find(row => row.dataset.id === usage.ownerId);
            if (layer) { el('document-mode-editor').click(); layer.querySelector('.layer-label')?.click(); }
          });
          li.append(' ', button);
        }
        usages.append(li);
      }
    }
    if (usagesReady && !tokenUsages.length) {
      const li = document.createElement('li'); li.textContent = 'Использований нет.'; usages.append(li);
    }
  }
  async function selectToken(id) {
    endRename();
    pendingThemeValues.clear();
    selectedToken = id; tokenUsages = []; creating = false; usagesReady = false;
    const current = ++tokenLoad, doc = getContext().documentId, revision = getContext().revision;
    renderTokens();
    if (!id || !Number.isSafeInteger(revision)) return;
    try {
      const items = await readAllTokenPages(`/api/v1/documents/${encodeURIComponent(doc)}/tokens/${encodeURIComponent(id)}/usages`, revision);
      if (current !== tokenLoad || doc !== getContext().documentId || revision !== getContext().revision) return;
      tokenUsages = items; usagesReady = true; el('tokens-error').textContent = ''; renderTokens(true, false);
    } catch (error) {
      if (current === tokenLoad && doc === getContext().documentId) el('tokens-error').textContent = error.message;
    }
  }
  async function tokenCommand(command, data, selection) {
    if (!editable() || busy()) return;
    stopLive(); const { signal, current } = startRequest();
    el('token-create').inert = el('token-import-form').inert = true;
    el('token-detail').inert = command !== 'set-token-value';
    el('tokens-error').textContent = ''; el('tokens-status').textContent = 'Сохранение…';
    try {
      await request(`/api/v1/documents/${encodeURIComponent(getContext().documentId)}/commands/${command}`,
        { method: 'POST', body: JSON.stringify({ commandId: crypto.randomUUID(), ...data }) }, signal);
      if (signal.aborted || current !== getContext().generation) return;
      if (selection) { selectedToken = selection; creating = false; }
      if (command === 'import-design-tokens') { importEpoch++; el('token-import-form').hidden = true; el('token-import-form').reset(); }
      await readPages(signal);
      if (current === getContext().generation) { el('tokens-status').textContent = ''; return true; }
    } catch (error) {
      if (error.name !== 'AbortError' && current === getContext().generation)
        el('tokens-error').textContent = error instanceof TypeError || error.status >= 500 ?
          'Результат неизвестен. Обновите документ перед повтором.' : (error.diagnostics?.map(d => d.path + ': ' + d.message).join('; ') || (error.code === 'INVALID_TOKEN' && error.detail ? error.message + ' ' + error.detail : error.message));
    } finally {
      if (current === getContext().generation) {
        el('token-create').inert = el('token-detail').inert = el('token-import-form').inert = false; el('tokens-status').textContent = ''; startLive();
      }
    }
  }

  el('new-token-type').addEventListener('change', updateCategoryOptions);
  el('new-token-category').addEventListener('change', updateCreateMode);
  el('token-create').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const type = el('new-token-type').value, category = allowedCategories[type] ? el('new-token-category').value : null;
      const name = qualifyTokenName(el('new-token-name').value.trim(), group);
      const error = tokenNameError(name, tokenItems); if (error) throw new Error(error);
      const id = crypto.randomUUID(), values = {};
      for (const [index, theme] of ['Light','Dark'].entries()) values[theme] = readExpression(createControls[index]);
      tokenCommand('add-token', { tokenId: id, name, type: typeIndex(type),
        category: categoryIndex(category), values }, id);
    } catch (error) { el('tokens-error').textContent = error.message; }
  });
  el('token-delete').addEventListener('click', () => {
    if (!selectedToken || !usagesReady || tokenUsages.length) return;
    tokenCommand('delete-token', { tokenId: selectedToken, expectedRevision: getContext().revision });
  });
  el('token-rename-open').addEventListener('click', beginRename);
  el('token-rename-cancel').addEventListener('click', endRename);
  el('token-name').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); endRename(); }
  });
  el('token-rename').addEventListener('submit', async event => {
    event.preventDefault();
    if (!selected() || !editable() || busy()) return;
    const name = el('token-name').value.trim(), item = selected();
    if (name === item.name) { endRename(); return; }
    const error = tokenNameError(name, tokenItems, item.id);
    if (error) { el('tokens-error').textContent = error; return; }
    if (await tokenCommand('rename-token', { tokenId: item.id, name }) && selectedToken === item.id) endRename();
  });
  updateCategoryOptions();
  return { reset: resetTokens, read: readTokens, apply: applyTokens,
    readSelectedUsages, applySelectedUsages, refreshAccess, get items() { return tokenItems; } };
}
