import { tokenSegments, buildTokenGroups, shortTokenName, tokenNameError, tokenNameDiagnostics, visibleTokens, qualifyTokenName } from './token-groups.js';
import { normalizedTokenType, normalizedTokenCategory, resolveTokenValue, tokenValueText, tokenColorHex } from './token-resolution.js';

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
  const busy = () => el('token-create').inert;
  function refreshAccess() {
    el('new-token-open').hidden = el('token-import-open').hidden = !editable();
    el('token-export').disabled = !editable();
    if (!editable()) { creating = false; el('token-import-form').hidden = true; }
    el('token-edit').hidden = !editable();
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
    for (const prefix of ['new-token-light','new-token-dark']) loadTypographyFields(prefix, null);
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
    const { documentId, revision } = getContext(), theme = el('token-export-theme').value;
    if (!editable() || !Number.isSafeInteger(revision)) return;
    el('tokens-error').textContent = '';
    try {
      const result = await request('/api/v1/documents/' + encodeURIComponent(documentId) + '/token-export?theme=' + theme + '&revision=' + revision);
      if (documentId !== getContext().documentId) return;
      if (!result.tokens || result.diagnostics?.length) throw new Error((result.diagnostics ?? []).map(d => d.message).join('; ') || 'Экспорт недоступен.');
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.tokens, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'tokens-' + theme.toLowerCase() + '.json';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { if (documentId === getContext().documentId) el('tokens-error').textContent = error.message; }
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
  const typographyPrefixes = ['new-token-light', 'new-token-dark', 'token'];
  function makeTypographyFields(prefix) {
    const root = el(prefix + '-typography');
    for (const field of typographyFields) {
      const row = document.createElement('div');
      row.className = 'token-typography-row';
      const label = document.createElement('label');
      label.htmlFor = prefix + '-' + field.name + '-source';
      label.textContent = field.label;
      const source = document.createElement('select');
      source.id = label.htmlFor;
      source.add(new Option('Прямое', 'literal'));
      source.add(new Option('Токен', 'alias'));
      const direct = document.createElement('input');
      direct.id = prefix + '-' + field.name + '-value';
      direct.placeholder = field.initial;
      direct.value = field.initial;
      const alias = document.createElement('select');
      alias.id = prefix + '-' + field.name + '-alias';
      alias.setAttribute('aria-label', field.label + ': ссылка на токен');
      source.addEventListener('change', () => updateTypographyField(prefix, field));
      row.append(label, source, direct, alias);
      root.append(row);
    }
  }
  typographyPrefixes.forEach(makeTypographyFields);

  function updateTypographyField(prefix, field) {
    const source = el(prefix + '-' + field.name + '-source');
    const input = el(prefix + '-' + field.name + '-value');
    const select = el(prefix + '-' + field.name + '-alias');
    const candidates = allowedAliases(field.type, field.category);
    const previous = select.value;
    select.replaceChildren(new Option(candidates.length ? 'Выберите токен' : 'Нет подходящих токенов', ''));
    for (const token of candidates) select.add(new Option(token.name, token.id));
    select.value = candidates.some(item => item.id === previous) ? previous : '';
    const enabled = !el(prefix + '-typography').hidden;
    input.hidden = source.value === 'alias';
    select.hidden = source.value !== 'alias';
    input.required = enabled && source.value !== 'alias';
    select.required = enabled && source.value === 'alias';
  }
  function refreshTypographyFields(prefix, visible) {
    el(prefix + '-typography').hidden = !visible;
    for (const field of typographyFields) updateTypographyField(prefix, field);
  }
  function loadTypographyFields(prefix, expression) {
    const value = expression?.value;
    for (const field of typographyFields) {
      const part = value?.type === 'typographyFields' ? value[field.name] :
        value?.type === 'typography' ? { expression: 'literal', value:
          field.type === 'FontFamily' ? { type: 'fontFamily', value: value.fontFamily } :
          { type: { Dimension: 'dimension', FontWeight: 'fontWeight', Number: 'number' }[field.type],
            value: value[field.name] ?? (field.name === 'letterSpacing' ? 0 : undefined) } } : null;
      el(prefix + '-' + field.name + '-source').value = part?.expression === 'alias' ? 'alias' : 'literal';
      el(prefix + '-' + field.name + '-value').value = part?.expression === 'literal'
        ? String(part.value.value) : field.initial;
      updateTypographyField(prefix, field);
      if (part?.expression === 'alias') el(prefix + '-' + field.name + '-alias').value = part.tokenId;
    }
  }
  function saveTypographyFields(prefix) {
    const value = { type: 'typographyFields' };
    for (const field of typographyFields) {
      const mode = el(prefix + '-' + field.name + '-source').value;
      if (mode === 'alias') {
        const id = el(prefix + '-' + field.name + '-alias').value;
        if (!allowedAliases(field.type, field.category).some(token => token.id === id))
          throw new Error('Выберите токен для поля ' + field.label + '.');
        value[field.name] = { expression: 'alias', tokenId: id };
      } else value[field.name] = literalExpression(field.type, field.category,
        el(prefix + '-' + field.name + '-value').value.trim());
    }
    return { expression: 'literal', value };
  }

  function resetTokens() {
    tokenLoad++; importEpoch++; tokenItems = []; tokenUsages = []; selectedToken = null; rendered = false;
    group = []; collapsed = new Set(); creating = false; usagesReady = false;
    el('token-search').value = el('token-type-filter').value = '';
    el('token-groups').replaceChildren(); el('token-import-form').reset(); el('token-import-form').hidden = true; el('token-import-form').inert = false;
    el('new-token-open').hidden = el('token-import-open').hidden = true; el('token-export').disabled = true;
    el('document-mode-editor').click(); updateDetailVisibility();
    el('token-create').inert = el('token-edit').inert = false;
    el('tokens-list').replaceChildren(); el('token-usages').replaceChildren();
    el('token-detail').hidden = true; el('token-create').hidden = true;
    el('tokens-error').textContent = ''; el('tokens-status').textContent = '';
    el('token-create').reset(); el('token-rename').reset(); el('token-set').reset();
    for (const prefix of typographyPrefixes) loadTypographyFields(prefix, null);
    updateCategoryOptions(); updateCreateMode();
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
    for (const prefix of typographyPrefixes)
      for (const field of typographyFields) updateTypographyField(prefix, field);
    if (selectedToken !== snapshot.selection) { selectToken(selectedToken); return; }
    if (!tokenItems.some(item => item.id === selectedToken)) selectedToken = null;
    tokenUsages = snapshot.usages; usagesReady = true;
    if (!rendered || before !== JSON.stringify([tokenItems, tokenUsages, selectedToken])) {
      rendered = true;
      renderTokens(true, previousItem !== JSON.stringify(selected()));
    }
  }

  function allowedAliases(type, category, excludeId = null) {
    const t = normalizedTokenType(type), c = normalizedTokenCategory(category);
    return tokenItems.filter(item => item.id !== excludeId && typeOf(item) === t && categoryOf(item) === c);
  }
  function aliasSelect(id, type, category, excludeId, current = '') {
    const select = el(id), options = allowedAliases(type, category, excludeId);
    const value = current || select.value;
    select.replaceChildren(new Option(options.length ? 'Выберите токен' : 'Нет совместимых токенов', ''));
    for (const option of options) select.add(new Option(option.name, option.id));
    select.value = options.some(item => item.id === value) ? value : '';
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
    const type = el('new-token-type').value, category = el('new-token-category').value;
    for (const theme of ['light', 'dark']) {
      const mode = el('new-token-' + theme + '-mode').value;
      const field = el('new-token-' + theme), picker = el('new-token-' + theme + '-picker');
      const preset = el('new-token-' + theme + '-weight-preset');
      const alias = el('new-token-' + theme + '-alias');
      const composite = type === 'Typography' && mode !== 'alias';
      refreshTypographyFields('new-token-' + theme, composite);
      preset.hidden = mode === 'alias' || type !== 'FontWeight';
      field.hidden = mode === 'alias' || composite; field.required = mode !== 'alias' && !composite;
      alias.hidden = mode !== 'alias'; alias.required = mode === 'alias';
      picker.hidden = mode === 'alias' || type !== 'Color';
      aliasSelect(alias.id, type, category, null);
      field.placeholder = type === 'Color' ? '#RRGGBBAA' :
        type === 'FontFamily' ? 'Inter' : type === 'FontWeight' ? '400' : '0';
    }
  }
  function expressionFor(type, category, mode, direct, reference) {
    if (mode === 'alias') {
      const match = allowedAliases(type, category).find(item => item.id === reference);
      if (!match) throw new Error('Выберите совместимый токен для алиаса.');
      return { expression: 'alias', tokenId: reference };
    }
    return literalExpression(type, category, direct);
  }
  function refreshSetMode() {
    const item = selected();
    if (!item) return;
    const mode = el('token-mode').value, type = typeOf(item), category = categoryOf(item);
    const literal = el('token-value'), picker = el('token-value-picker'), alias = el('token-value-alias');
    const preset = el('token-font-weight-preset');
    const composite = type === 'Typography' && mode !== 'alias';
    refreshTypographyFields('token', composite);
    alias.hidden = mode !== 'alias'; alias.required = mode === 'alias';
    literal.hidden = mode === 'alias' || composite; literal.required = mode !== 'alias' && !composite;
    picker.hidden = mode === 'alias' || type !== 'Color';
    preset.hidden = mode === 'alias' || type !== 'FontWeight';
    aliasSelect(alias.id, type, category, item.id);
    literal.placeholder = type === 'Color' ? '#RRGGBBAA' : type === 'FontFamily' ? 'Inter' : '0';
  }
  function setEditorFromTheme() {
    const item = selected();
    if (!item) return;
    const expression = item.values[el('token-theme').value];
    el('token-mode').value = expression?.expression === 'alias' ? 'alias' : 'literal';
    el('token-value').value = directText(expression);
    if (typeOf(item) === 'Color' && expression?.value?.type === 'color')
      el('token-value-picker').value = tokenColorHex(expression.value);
    const alias = el('token-value-alias');
    alias.value = expression?.tokenId ?? '';
    refreshSetMode();
    if (typeOf(item) === 'Typography') loadTypographyFields('token', expression);
    if (expression?.expression === 'alias') alias.value = expression.tokenId;
    el('token-font-weight-preset').value = typeOf(item) === 'FontWeight'
      ? (['400', '500', '600', '700'].includes(el('token-value').value) ? el('token-value').value : '') : '';
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
      select.textContent = (node.segments.at(-1) ?? 'Все токены') + ' · ' + node.count;
      select.setAttribute('aria-pressed', String(key === groupKey(group)));
      select.onclick = () => { group = node.segments; el('token-search').value = ''; renderTokens(false); };
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
    el('tokens-status').textContent = tokenItems.length ? `Токенов: ${tokenItems.length}` : 'Токенов пока нет.';
    const item = selected();
    updateDetailVisibility();
    if (!item || refreshDetail === false) return;
    const theme = el('token-view-theme').value;
    el('token-detail-title').textContent = item.name;
    const diagnostics = [nameDiagnostics.get(item.id)].filter(Boolean);
    for (const selectedTheme of ['Light','Dark']) {
      const resolved = resolveTokenValue({ type: 'token', tokenId: item.id }, index, selectedTheme, item.type, item.category);
      if (resolved.error) diagnostics.push(selectedTheme + ': ' + resolved.error);
    }
    el('token-detail-diagnostic').textContent = diagnostics.join(' · ');
    const expression = item.values[theme];
    const describe = expression => expression?.expression === 'alias'
      ? '↳ ' + nameOf(expression.tokenId) : directText(expression);
    const pair = `Light: ${describe(item.values.Light)}; Dark: ${describe(item.values.Dark)}`;
    el('token-values').textContent = categoryOf(item) ? `${typeOf(item)}.${categoryOf(item)} · ${pair}` : pair;
    el('token-edit').hidden = !editable();
    el('token-set').hidden = false;
    el('token-delete').disabled = !usagesReady || tokenUsages.length > 0;
    el('token-delete').title = tokenUsages.length ? 'У токена есть зависимости: ' + tokenUsages.length : 'Удалить токен';
    if (refreshEditor) {
      el('token-name').value = item.name;
      setEditorFromTheme();
    }
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
    el('token-create').inert = el('token-edit').inert = el('token-import-form').inert = true;
    el('tokens-error').textContent = ''; el('tokens-status').textContent = 'Сохранение…';
    try {
      await request(`/api/v1/documents/${encodeURIComponent(getContext().documentId)}/commands/${command}`,
        { method: 'POST', body: JSON.stringify({ commandId: crypto.randomUUID(), ...data }) }, signal);
      if (signal.aborted || current !== getContext().generation) return;
      if (selection) { selectedToken = selection; creating = false; }
      if (command === 'import-design-tokens') { importEpoch++; el('token-import-form').hidden = true; el('token-import-form').reset(); }
      await readPages(signal);
      if (current === getContext().generation) el('tokens-status').textContent = 'Изменение сохранено.';
    } catch (error) {
      if (error.name !== 'AbortError' && current === getContext().generation)
        el('tokens-error').textContent = error instanceof TypeError || error.status >= 500 ?
          'Результат неизвестен. Обновите документ перед повтором.' : (error.diagnostics?.map(d => d.path + ': ' + d.message).join('; ') || (error.code === 'INVALID_TOKEN' && error.detail ? error.message + ' ' + error.detail : error.message));
    } finally {
      if (current === getContext().generation) {
        el('token-create').inert = el('token-edit').inert = el('token-import-form').inert = false; startLive();
      }
    }
  }

  el('new-token-type').addEventListener('change', updateCategoryOptions);
  el('new-token-category').addEventListener('change', updateCreateMode);
  for (const theme of ['light', 'dark']) {
    el('new-token-' + theme + '-mode').addEventListener('change', updateCreateMode);
    el('new-token-' + theme + '-weight-preset').addEventListener('change', () => {
      const selectedWeight = el('new-token-' + theme + '-weight-preset').value;
      if (selectedWeight) el('new-token-' + theme).value = selectedWeight;
    });
    el('new-token-' + theme + '-picker').addEventListener('input', () => {
      const input = el('new-token-' + theme), rgb = el('new-token-' + theme + '-picker').value;
      input.value = rgb + (/^#[0-9a-f]{8}$/i.test(input.value) ? input.value.slice(7) : 'FF');
    });
  }
  el('token-value-picker').addEventListener('input', () => {
    const input = el('token-value');
    input.value = el('token-value-picker').value +
      (/^#[0-9a-f]{8}$/i.test(input.value) ? input.value.slice(7) : 'FF');
  });
  el('token-font-weight-preset').addEventListener('change', () => {
    if (el('token-font-weight-preset').value) el('token-value').value = el('token-font-weight-preset').value;
  });
  el('token-view-theme').addEventListener('change', renderTokens);
  el('token-theme').addEventListener('change', setEditorFromTheme);
  el('token-mode').addEventListener('change', refreshSetMode);
  el('token-create').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const type = el('new-token-type').value, category = allowedCategories[type] ? el('new-token-category').value : null;
      const name = qualifyTokenName(el('new-token-name').value.trim(), group);
      const error = tokenNameError(name, tokenItems); if (error) throw new Error(error);
      const id = crypto.randomUUID(), values = {};
      for (const theme of ['Light', 'Dark']) {
        const prefix = 'new-token-' + theme.toLowerCase();
        values[theme] = type === 'Typography' && el(prefix + '-mode').value === 'literal'
          ? saveTypographyFields(prefix)
          : expressionFor(type, category, el(prefix + '-mode').value,
            el(prefix).value.trim(), el(prefix + '-alias').value);
      }
      tokenCommand('add-token', { tokenId: id, name, type: typeIndex(type),
        category: categoryIndex(category), values }, id);
    } catch (error) { el('tokens-error').textContent = error.message; }
  });
  el('token-delete').addEventListener('click', () => {
    if (!selectedToken || !usagesReady || tokenUsages.length) return;
    tokenCommand('delete-token', { tokenId: selectedToken, expectedRevision: getContext().revision });
  });
  el('token-rename').addEventListener('submit', event => {
    event.preventDefault();
    const name = el('token-name').value.trim();
    const error = tokenNameError(name, tokenItems, selectedToken);
    if (error) { el('tokens-error').textContent = error; return; }
    tokenCommand('rename-token', { tokenId: selectedToken, name });
  });
  el('token-set').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const item = selected();
      if (!item) return;
      const mode = el('token-mode').value, type = typeOf(item), category = categoryOf(item);
      const value = mode === 'alias' ? (() => {
        const targetId = el('token-value-alias').value;
        if (!allowedAliases(type, category, item.id).some(t => t.id === targetId))
          throw new Error('Выберите совместимый токен для алиаса.');
        return { expression: 'alias', tokenId: targetId };
      })() : type === 'Typography' ? saveTypographyFields('token')
        : literalExpression(type, category, el('token-value').value.trim());
      tokenCommand('set-token-value', { tokenId: item.id,
        theme: el('token-theme').value === 'Light' ? 0 : 1, value });
    } catch (error) { el('tokens-error').textContent = error.message; }
  });
  for (const prefix of typographyPrefixes) loadTypographyFields(prefix, null);
  updateCategoryOptions();
  return { reset: resetTokens, read: readTokens, apply: applyTokens,
    readSelectedUsages, applySelectedUsages, refreshAccess, get items() { return tokenItems; } };
}
