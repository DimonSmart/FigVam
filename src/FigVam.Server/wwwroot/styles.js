import { normalizedTokenType, normalizedTokenCategory, resolveTokenValue, tokenValueText } from './token-resolution.js';

const definitions = {
  TextStyle: {
    typography: ['Типографика', 'Typography', null],
    textColor: ['Цвет текста', 'Color', null],
    fontStyle: ['Начертание', null, null],
    fontFallback: ['Запасной шрифт', null, null]
  },
  BorderStyle: {
    borderColor: ['Цвет рамки', 'Color', null],
    borderWidth: ['Толщина рамки', 'Dimension', 'BorderWidth'],
    cornerRadius: ['Радиус углов', 'Dimension', 'Radius']
  }
};
const typographyParts = {
  fontFamily: ['Семейство', 'FontFamily', null, 'Arial'],
  fontSize: ['Размер', 'Dimension', 'FontSize', '16'],
  fontWeight: ['Толщина', 'FontWeight', null, '400'],
  lineHeight: ['Интерлиньяж', 'Number', 'LineHeight', '1.25'],
  letterSpacing: ['Межбуквенный интервал', 'Dimension', 'LetterSpacing', '0']
};
const palette = {
  fontStyle: ['Normal', 'Italic'],
  fontFallback: ['SansSerif', 'Serif', 'Monospace']
};
const styleType = style => !style || style.type === 0 || style.type === 'TextStyle' ? 'TextStyle' : 'BorderStyle';

function literalOf(field, text) {
  if (field === 'textColor' || field === 'borderColor') {
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(text)) throw new Error('Введите цвет в формате #RRGGBB или #RRGGBBAA.');
    const hex = text.slice(1) + (text.length === 7 ? 'FF' : '');
    const [red, green, blue, alpha] = [0, 2, 4, 6].map(i => parseInt(hex.slice(i, i + 2), 16));
    return { type: 'color', red, green, blue, alpha };
  }
  if (palette[field]) {
    if (!palette[field].includes(text)) throw new Error('Выберите допустимое значение.');
    return { type: 'enum', value: text };
  }
  if (!text.trim() || !Number.isFinite(Number(text))) throw new Error('Введите число.');
  const number = Number(text);
  if (number < 0 || number > 1000000) throw new Error('Значение вне допустимого диапазона.');
  return { type: 'number', value: number };
}

function literalText(field, value) {
  if (!value) return '';
  if (value.type === 'color') return '#' + [value.red, value.green, value.blue, value.alpha]
    .map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase();
  return String(value.value ?? '');
}

export function createStyles({ element, request, getContext, getTokens, startRequest, stopLive, startLive, readPages }) {
  const el = element;
  let items = [], selectedId = null, busy = false, tokenSignature = '';
  const editable = () => ['Owner', 'Editor'].includes(getContext().documentRole);
  const chosen = () => items.find(style => style.id === selectedId);
  const tokens = () => getTokens() ?? [];
  const candidates = (type, category) => tokens().filter(token =>
    normalizedTokenType(token.type) === type && normalizedTokenCategory(token.category) === category);
  const choices = (source, options, empty = 'Выберите токен') => {
    source.replaceChildren(new Option(empty, ''));
    for (const item of options) source.add(new Option(item.name, item.id));
  };
  function input(type, name, initial = '') {
    const element = document.createElement(type);
    element.setAttribute('aria-label', name);
    if (type === 'input') element.value = initial;
    return element;
  }
  const rows = [];
  const editor = el('styles-fields');

  function choose(select, value) {
    if (value && ![...select.options].some(option => option.value === value)) {
      const missing = new Option('Недоступная ссылка', value);
      missing.disabled = true; select.add(missing);
    }
    select.value = value ?? '';
  }

  function makeInlineTypography(existing) {
    const group = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = 'Поля типографики';
    group.append(legend);
    const entries = [];
    for (const [field, [label, type, category, fallback]] of Object.entries(typographyParts)) {
      const part = existing?.type === 'typographyFields' ? existing[field] : null;
      const old = existing?.type === 'typography' ? existing[field] : null;
      const row = document.createElement('div');
      row.className = 'token-typography-row';
      const mode = input('select', label + ': источник');
      mode.add(new Option('Прямое', 'literal')); mode.add(new Option('Токен', 'alias'));
      mode.value = part?.expression === 'alias' ? 'alias' : 'literal';
      const direct = input('input', label + ': значение', part?.expression === 'literal'
        ? String(part.value?.value ?? fallback) : old == null ? fallback : String(old));
      const alias = input('select', label + ': токен');
      choices(alias, candidates(type, category));
      choose(alias, part?.expression === 'alias' ? part.tokenId : null);
      const labelElement = document.createElement('span'); labelElement.textContent = label;
      const sync = () => { direct.hidden = mode.value === 'alias'; alias.hidden = mode.value !== 'alias'; };
      mode.addEventListener('change', sync);
      row.append(labelElement, mode, direct, alias); group.append(row); sync();
      entries.push({ field, type, category, mode, direct, alias });
    }
    return {
      element: group,
      value() {
        const value = { type: 'typographyFields' };
        for (const { field, type, mode, direct, alias } of entries) {
          if (mode.value === 'alias') {
            if (!alias.value) throw new Error('Выберите токен для ' + field + '.');
            value[field] = { expression: 'alias', tokenId: alias.value };
          } else {
            const raw = direct.value.trim();
            let data;
            if (type === 'FontFamily') {
              if (!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} _-]*$/u.test(raw) || raw.length > 128)
                throw new Error('Некорректное имя шрифта.');
              data = { type: 'fontFamily', value: raw };
            } else {
              if (!raw || !Number.isFinite(Number(raw))) throw new Error('Недопустимое число для ' + field + '.');
              const number = Number(raw);
              if (type === 'FontWeight' && (!Number.isInteger(number) || number < 1 || number > 1000))
                throw new Error('Недопустимая толщина шрифта.');
              if (field === 'letterSpacing' && Math.abs(number) > 100)
                throw new Error('Межбуквенный интервал должен быть от -100 до 100 px.');
              data = { type: { Dimension: 'dimension', FontWeight: 'fontWeight', Number: 'number' }[type], value: number };
            }
            value[field] = { expression: 'literal', value: data };
          }
        }
        return { type: 'typography', value };
      }
    };
  }

  function buildFields(style, type) {
    rows.length = 0; editor.replaceChildren();
    for (const [field, [label, tokenType, category]] of Object.entries(definitions[type])) {
      const saved = style?.fields?.[field];
      const row = document.createElement('div'); row.className = 'style-field-row';
      const active = input('input', label + ': переопределить');
      active.type = 'checkbox'; active.checked = saved != null;
      const title = document.createElement('span'); title.textContent = label;
      const source = input('select', label + ': источник');
      source.add(new Option('Прямое', 'literal'));
      if (tokenType) source.add(new Option('Токен', 'alias'));
      const inline = field === 'typography' ? makeInlineTypography(saved?.value) : null;
      const direct = inline?.element ?? (palette[field] ? input('select',label) : input('input',label + ': значение'));
      if (palette[field]) {
        for (const value of palette[field]) direct.add(new Option(value, value));
        direct.value = saved?.value ?? palette[field][0];
      } else if (!inline) direct.value = saved && saved.type !== 'token' ? literalText(field, saved)
        : field.endsWith('Color') ? '#000000FF' : field === 'cornerRadius' ? '6' : '1';
      const ref = input('select', label + ': ссылка на токен');
      choices(ref, tokenType ? candidates(tokenType, category) : []);
      if (saved?.type === 'token') choose(ref, saved.tokenId);
      const fallback = style?.basedOnStyleId ? ' (наследуется при отключении)' : ' (значение по умолчанию)';
      const flag = document.createElement('label'); flag.append(active, ' Задать ' + label + fallback);
      source.value = saved?.type === 'token' ? 'alias' : 'literal';
      const sync = () => {
        source.hidden = !active.checked;
        direct.hidden = !active.checked || source.value === 'alias';
        ref.hidden = !active.checked || source.value !== 'alias';
      };
      active.addEventListener('change', sync);
      source.addEventListener('change', sync);
      row.append(flag, source, direct, ref); editor.append(row); sync();
      rows.push({ field, label, active, source, direct, ref, inline });
    }
  }

  function render() {
    const selected = chosen();
    const type = styleType(selected);
    const list = el('styles-list');
    choices(list, items, 'Новый стиль');
    choose(list, selectedId);
    el('styles-total').textContent = 'Стили: ' + items.length;
    const writable = editable();
    el('styles-form').hidden = !writable;
    el('styles-delete').hidden = !writable || !selected;
    el('styles-save').disabled = !writable || busy;
    el('styles-delete').disabled = busy;
    el('styles-name').value = selected?.name ?? '';
    el('styles-type').value = type;
    el('styles-type').disabled = Boolean(selected);
    const parent = el('styles-based-on');
    choices(parent, items.filter(item => styleType(item) === type && item.id !== selected?.id), 'Без родителя');
    choose(parent, selected?.basedOnStyleId);
    buildFields(selected, type);
    renderPreview(selected);
  }

  function resolvePreview(style, theme, seen = new Set()) {
    if (!style || !seen.add(style.id)) return style ? { error: 'Цикл наследования' } : {};
    const result = style.basedOnStyleId ? resolvePreview(items.find(i => i.id === style.basedOnStyleId), theme, seen) : {};
    for (const [field, value] of Object.entries(style.fields ?? {})) {
      if (field === 'typography') {
        const token = value?.type === 'token'
          ? resolveTokenValue(value, new Map(tokens().map(t => [t.id, t])), theme, 'Typography')
          : { value: value?.value };
        result.typography = token.error ?? tokenValueText(token.value) ?? 'Вложенная типографика';
      } else if (value?.type === 'token') {
        const token = resolveTokenValue(value, new Map(tokens().map(t => [t.id, t])), theme);
        result[field] = token.error ?? tokenValueText(token.value);
      } else result[field] = literalText(field, value);
    }
    return result;
  }

  function renderPreview(style) {
    const box = el('styles-preview');
    if (!style) { box.textContent = 'Выберите стиль или создайте новый.'; return; }
    const summarize = theme => {
      const result = resolvePreview(style, theme);
      return theme + ': ' + Object.entries(result).map(([key, value]) => key + ' = ' + value).join('; ');
    };
    box.textContent = summarize('Light') + '\n' + summarize('Dark');
  }

  function reset() {
    items = []; selectedId = null; busy = false; tokenSignature = '';
    el('styles-error').textContent = ''; el('styles-status').textContent = '';
    render();
  }

  async function read(base, revision, signal, isCurrent) {
    const all = []; let total;
    do {
      const response = await request(base + '/styles?revision=' + revision +
        '&offset=' + all.length + '&limit=100', {}, signal, isCurrent);
      if (response.revision !== revision || !Array.isArray(response.items) ||
          !Number.isInteger(response.total) || response.offset !== all.length)
        throw new Error('Некорректный ответ списка стилей.');
      all.push(...response.items);
      total = response.total;
      if (all.length < total && response.items.length === 0) throw new Error('Неполный список стилей.');
    } while (all.length < total);
    return all;
  }

  function apply(next) {
    const nextTokenSignature = JSON.stringify(tokens().map(token =>
      [token.id, token.name, token.type, token.category]));
    const changed = JSON.stringify(items) !== JSON.stringify(next) ||
      tokenSignature !== nextTokenSignature;
    tokenSignature = nextTokenSignature;
    items = next;
    if (selectedId && !items.some(item => item.id === selectedId)) selectedId = null;
    if (changed || el('styles-form').hidden === editable()) render();
  }

  async function write(endpoint, payload, id = selectedId) {
    if (!editable() || busy) return;
    busy = true;
    const { signal, current } = startRequest();
    stopLive();
    el('styles-save').disabled = el('styles-delete').disabled = true;
    el('styles-error').textContent = '';
    try {
      const context = getContext();
      await request('/api/v1/documents/' + encodeURIComponent(context.documentId) + '/commands/' + endpoint,
        { method: 'POST', body: JSON.stringify({ commandId: crypto.randomUUID(), expectedRevision: context.revision, ...payload }) },
        signal);
      if (signal.aborted || current !== getContext().generation) return;
      selectedId = id;
      await readPages(signal);
      el('styles-status').textContent = 'Стиль сохранён.';
    } catch (error) {
      if (error.name !== 'AbortError') el('styles-error').textContent =
        error.status >= 500 || error instanceof TypeError ? 'Результат неизвестен. Обновите документ.' : error.message;
    } finally {
      busy = false; render(); startLive();
    }
  }

  el('styles-list').addEventListener('change', () => { selectedId = el('styles-list').value || null; render(); });
  el('styles-type').addEventListener('change', () => {
    const type = el('styles-type').value;
    choices(el('styles-based-on'), items.filter(style => styleType(style) === type && style.id !== selectedId), 'Без родителя');
    buildFields(chosen(), type);
  });
  el('styles-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const existing = chosen();
      const name = el('styles-name').value.trim();
      if (!name || name.length > 256) throw new Error('Введите название стиля.');
      const type = el('styles-type').value;
      const fields = {};
      for (const row of rows) {
        if (!row.active.checked) continue;
        const value = row.source.value === 'alias'
          ? (row.ref.value ? { type: 'token', tokenId: row.ref.value } : null)
          : row.inline ? row.inline.value() : literalOf(row.field, row.direct.value);
        if (!value) throw new Error('Выберите токен для ' + row.label);
        fields[row.field] = value;
      }
      const id = existing?.id ?? crypto.randomUUID();
      write('upsert-style', { style: { id, name, type: type === 'TextStyle' ? 0 : 1,
        fields, basedOnStyleId: el('styles-based-on').value || null } }, id);
    } catch (error) { el('styles-error').textContent = error.message; }
  });
  el('styles-delete').addEventListener('click', () => {
    if (selectedId) write('delete-style', { styleId: selectedId }, null);
  });
  render();
  return { reset, read, apply, get items() { return items; } };
}
