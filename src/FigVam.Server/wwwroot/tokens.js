import { normalizedTokenType, normalizedTokenCategory, resolveTokenValue, tokenValueText, tokenColorHex } from './token-resolution.js';

const types = ['Color', 'Spacing', 'Typography', 'Geometry', 'Dimension', 'Number', 'FontFamily', 'FontWeight'];
const categories = ['Spacing', 'FontSize', 'Radius', 'BorderWidth', 'Size', 'LineHeight', 'Opacity'];
const allowedCategories = {
  Dimension: ['Spacing', 'FontSize', 'Radius', 'BorderWidth', 'Size'],
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
  if (valueType === 'Typography') throw new Error('Составная типографика будет доступна на следующем этапе.');
  if (!raw.trim() || !Number.isFinite(Number(raw))) throw new Error('Введите конечное число.');
  const value = Number(raw), c = normalizedTokenCategory(category);
  if (valueType === 'FontWeight' && (!Number.isInteger(value) || value < 1 || value > 1000))
    throw new Error('Толщина шрифта должна быть целым числом от 1 до 1000.');
  if (valueType === 'Dimension' && (value < (c === 'FontSize' ? 1 : 0) ||
      value > (c === 'FontSize' ? 1024 : 1000000)))
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
  let tokenItems = [], selectedToken = null, tokenUsages = [], tokenLoad = 0, profileVersion = 3, rendered = false;
  const el = element, editable = () => ['Owner', 'Editor'].includes(getContext().documentRole);
  const selected = () => tokenItems.find(t => t.id === selectedToken);
  const typeOf = token => normalizedTokenType(token?.type);
  const categoryOf = token => normalizedTokenCategory(token?.category);
  const nameOf = id => tokenItems.find(t => t.id === id)?.name ?? 'Удалённый токен';

  function resetTokens() {
    tokenLoad++; tokenItems = []; tokenUsages = []; selectedToken = null; profileVersion = 3; rendered = false;
    el('token-create').inert = el('token-edit').inert = false;
    el('tokens-list').replaceChildren(); el('token-usages').replaceChildren();
    el('token-detail').hidden = true; el('token-create').hidden = true;
    el('token-upgrade').hidden = true;
    el('tokens-error').textContent = ''; el('tokens-status').textContent = '';
    el('token-create').reset(); el('token-rename').reset(); el('token-set').reset();
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
    const [items, profile] = await Promise.all([
      readAllTokenPages(`${base}/tokens`, revision, signal, isCurrent),
      request(`${base}/profile?revision=${revision}`, {}, signal, isCurrent)
    ]);
    const selection = selectedToken;
    const usages = selection && items.some(item => item.id === selection)
      ? await readAllTokenPages(`${base}/tokens/${encodeURIComponent(selection)}/usages`, revision, signal, isCurrent) : [];
    return { items, selection, usages, profileVersion: profile.profile?.version ?? 3 };
  }
  async function readSelectedUsages(base, revision, signal, isCurrent) {
    const selection = selectedToken;
    const usages = selection ? await readAllTokenPages(`${base}/tokens/${encodeURIComponent(selection)}/usages`,
      revision, signal, isCurrent) : [];
    return { selection, usages };
  }
  function applySelectedUsages({ selection, usages }) {
    if (selection !== selectedToken) { selectToken(selectedToken); return; }
    if (JSON.stringify(tokenUsages) !== JSON.stringify(usages)) { tokenUsages = usages; renderTokens(); }
  }
  function applyTokens(snapshot) {
    const before = JSON.stringify([tokenItems, tokenUsages, selectedToken, profileVersion]);
    tokenItems = snapshot.items;
    profileVersion = snapshot.profileVersion;
    if (selectedToken !== snapshot.selection) { selectToken(selectedToken); return; }
    if (!tokenItems.some(item => item.id === selectedToken)) selectedToken = null;
    tokenUsages = snapshot.usages;
    if (!rendered || before !== JSON.stringify([tokenItems, tokenUsages, selectedToken, profileVersion])) {
      rendered = true;
      renderTokens();
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
      preset.hidden = mode === 'alias' || type !== 'FontWeight';
      field.hidden = mode === 'alias'; field.required = mode !== 'alias';
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
    alias.hidden = mode !== 'alias'; alias.required = mode === 'alias';
    literal.hidden = mode === 'alias'; literal.required = mode !== 'alias';
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
    if (expression?.expression === 'alias') alias.value = expression.tokenId;
    el('token-font-weight-preset').value = typeOf(item) === 'FontWeight'
      ? (['400', '500', '600', '700'].includes(el('token-value').value) ? el('token-value').value : '') : '';
  }
  function renderTokens() {
    const list = el('tokens-list'); list.replaceChildren();
    const theme = el('token-view-theme').value;
    for (const item of tokenItems) {
      const li = document.createElement('li'), button = document.createElement('button');
      const type = typeOf(item), category = categoryOf(item);
      button.type = 'button';
      const resolved = resolveTokenValue({ type: 'token', tokenId: item.id },
        new Map(tokenItems.map(token => [token.id, token])), theme, item.type, item.category);
      const oldLabel = { Color: 'Цвет', Spacing: 'Отступ', Geometry: 'Геометрия', Typography: 'Типографика' }[type];
      button.textContent = oldLabel ? `${item.name} (${oldLabel})` :
        `${item.name} (${type}.${category ?? ''})`;
      const preview = document.createElement('small');
      preview.setAttribute('aria-hidden', 'true');
      preview.textContent = ' · ' + (resolved.error ?? tokenValueText(resolved.value));
      if (type === 'Color' && !resolved.error && resolved.value?.type === 'color') {
        const swatch = document.createElement('span');
        swatch.setAttribute('aria-hidden', 'true');
        swatch.title = 'Образец цвета';
        Object.assign(swatch.style, {
          display: 'inline-block', width: '0.9em', height: '0.9em',
          border: '1px solid currentColor', borderRadius: '2px', verticalAlign: 'middle',
          backgroundColor: 'rgba(' + [resolved.value.red, resolved.value.green,
            resolved.value.blue, resolved.value.alpha / 255].join(', ') + ')'
        });
        button.append(' ', swatch);
      }
      button.append(preview);
      button.setAttribute('aria-pressed', String(item.id === selectedToken));
      button.addEventListener('click', () => selectToken(item.id));
      li.append(button); list.append(li);
    }
    el('tokens-status').textContent = tokenItems.length ? `Токенов: ${tokenItems.length}` : 'Токенов пока нет.';
    el('token-upgrade').hidden = !editable() || profileVersion >= 4;
    if (!el('token-upgrade').hidden) el('token-upgrade').textContent = `Обновить профиль до v${profileVersion + 1}`;
    const item = selected();
    el('token-detail').hidden = !item;
    if (!item) return;
    el('token-detail-title').textContent = item.name;
    const expression = item.values[theme];
    const describe = expression => expression?.expression === 'alias'
      ? '↳ ' + nameOf(expression.tokenId) : directText(expression);
    const pair = `Light: ${describe(item.values.Light)}; Dark: ${describe(item.values.Dark)}`;
    el('token-values').textContent = categoryOf(item) ? `${typeOf(item)}.${categoryOf(item)} · ${pair}` : pair;
    el('token-edit').hidden = !editable();
    el('token-set').hidden = typeOf(item) === 'Typography';
    el('token-name').value = item.name;
    setEditorFromTheme();
    const usages = el('token-usages'); usages.replaceChildren();
    for (const usage of tokenUsages) {
      const li = document.createElement('li');
      li.textContent = [usage.kind, usage.ownerId, usage.property, usage.theme == null ? null : `тема ${usage.theme}`,
        usage.parameterId].filter(x => x != null).join(' · ');
      usages.append(li);
    }
    if (!tokenUsages.length) {
      const li = document.createElement('li'); li.textContent = 'Прямых использований нет.'; usages.append(li);
    }
  }
  async function selectToken(id) {
    selectedToken = id; tokenUsages = [];
    const current = ++tokenLoad, doc = getContext().documentId, revision = getContext().revision;
    renderTokens();
    if (!id || !Number.isSafeInteger(revision)) return;
    try {
      const items = await readAllTokenPages(`/api/v1/documents/${encodeURIComponent(doc)}/tokens/${encodeURIComponent(id)}/usages`, revision);
      if (current !== tokenLoad || doc !== getContext().documentId || revision !== getContext().revision) return;
      tokenUsages = items; el('tokens-error').textContent = ''; renderTokens();
    } catch (error) {
      if (current === tokenLoad && doc === getContext().documentId) el('tokens-error').textContent = error.message;
    }
  }
  async function tokenCommand(command, data, selection) {
    if (!editable()) return;
    stopLive(); const { signal, current } = startRequest();
    el('token-create').inert = el('token-edit').inert = true;
    el('tokens-error').textContent = ''; el('tokens-status').textContent = 'Сохранение…';
    try {
      await request(`/api/v1/documents/${encodeURIComponent(getContext().documentId)}/commands/${command}`,
        { method: 'POST', body: JSON.stringify({ commandId: crypto.randomUUID(), ...data }) }, signal);
      if (signal.aborted || current !== getContext().generation) return;
      if (selection) selectedToken = selection;
      await readPages(signal);
      if (current === getContext().generation) el('tokens-status').textContent = 'Изменение сохранено.';
    } catch (error) {
      if (error.name !== 'AbortError' && current === getContext().generation)
        el('tokens-error').textContent = error instanceof TypeError || error.status >= 500 ?
          'Результат неизвестен. Обновите документ перед повтором.' : error.message;
    } finally {
      if (current === getContext().generation) {
        el('token-create').inert = el('token-edit').inert = false; startLive();
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
  el('token-upgrade').addEventListener('click', () => tokenCommand('upgrade-portable-ui-profile',
    { expectedRevision: getContext().revision }));
  el('token-create').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const type = el('new-token-type').value, category = allowedCategories[type] ? el('new-token-category').value : null;
      const id = crypto.randomUUID(), values = {};
      for (const theme of ['Light', 'Dark']) {
        const prefix = 'new-token-' + theme.toLowerCase();
        values[theme] = expressionFor(type, category, el(prefix + '-mode').value,
          el(prefix).value.trim(), el(prefix + '-alias').value);
      }
      tokenCommand('add-token', { tokenId: id, name: el('new-token-name').value, type: typeIndex(type),
        category: categoryIndex(category), values }, id);
    } catch (error) { el('tokens-error').textContent = error.message; }
  });
  el('token-rename').addEventListener('submit', event => {
    event.preventDefault();
    tokenCommand('rename-token', { tokenId: selectedToken, name: el('token-name').value });
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
      })() : literalExpression(type, category, el('token-value').value.trim());
      tokenCommand('set-token-value', { tokenId: item.id,
        theme: el('token-theme').value === 'Light' ? 0 : 1, value });
    } catch (error) { el('tokens-error').textContent = error.message; }
  });
  updateCategoryOptions();
  return { reset: resetTokens, read: readTokens, apply: applyTokens,
    readSelectedUsages, applySelectedUsages, get items() { return tokenItems; } };
}
