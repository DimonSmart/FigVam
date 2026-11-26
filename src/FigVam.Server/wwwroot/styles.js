import { normalizedTokenType, normalizedTokenCategory, resolveTokenValue, resolveInlineTypography, tokenValueText } from './token-resolution.js';

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
  let styleUsages = [], styleUsageRequest = 0;
  let formId, formSnapshot, timer, activeAuto = null, epoch = 0, rendering = false;
  const drafts = new Map();
  const canonical = value => JSON.stringify(value ?? null, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const equal = (a, b) => canonical(a) === canonical(b);
  const fieldValue = (style, key) => key.startsWith('fields.')
    ? style?.fields?.[key.slice(7)] : style?.[key];
  function withValue(style, key, value) {
    if (!key.startsWith('fields.')) return { ...style, [key]: value };
    const fields = { ...style.fields }, field = key.slice(7);
    if (value == null) delete fields[field];
    else fields[field] = value;
    return { ...style, fields };
  }
  function draftStyle(style, draft) {
    for (const [key, change] of draft?.changes ?? []) style = withValue(style, key, change.value);
    return style;
  }
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
      rows.push({ field, label, active, source, direct, ref, inline, element: row });
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
    el('styles-save').hidden = Boolean(selected);
    el('styles-save').disabled = !writable || busy;
    el('styles-delete').disabled = busy;
    const draft = drafts.get(selectedId);
    if (formId !== selectedId || !draft && activeAuto?.id !== selectedId) {
      rendering = true;
      const focused = document.activeElement;
      const focusKey = el('styles-form').contains(focused) ? focused.getAttribute('aria-label') || focused.id : '';
      const selection = focusKey && focused.matches('input[type=text], input:not([type])')
        ? [focused.selectionStart, focused.selectionEnd] : null;
      const display = selected ? draftStyle(selected, draft) : null;
      formId = selectedId; formSnapshot = selected;
      el('styles-name').value = display?.name ?? '';
      el('styles-type').value = type;
      el('styles-type').disabled = Boolean(selected);
      const parent = el('styles-based-on');
      choices(parent, items.filter(item => styleType(item) === type && item.id !== selected?.id), 'Без родителя');
      choose(parent, display?.basedOnStyleId);
      buildFields(display, type);
      if (focusKey && selected && !el('styles-form').contains(focused)) {
        const replacement = [...el('styles-form').querySelectorAll('input,select')].find(control =>
          (control.getAttribute('aria-label') || control.id) === focusKey && !control.hidden && !control.closest('[hidden]'));
        replacement?.focus({ preventScroll: true });
        if (selection && replacement?.matches('input[type=text], input:not([type])')) replacement.setSelectionRange(...selection);
      }
      rendering = false;
    }
    renderPreview(selected ? draftStyle(selected, draft) : null);
    const usageList = el('styles-usages');
    usageList.replaceChildren();
    for (const indirect of [false, true]) {
      const uses = styleUsages.filter(item => Boolean(item.indirect) === indirect);
      if (!uses.length) continue;
      const group = document.createElement('li');
      group.className = 'resource-usage-group';
      group.textContent = (indirect ? 'Косвенные' : 'Прямые') + ' · ' + uses.length;
      usageList.append(group);
      for (const usage of uses) {
        const li = document.createElement('li');
        li.textContent = [usage.label ?? usage.kind, usage.property, usage.theme == null ? null : 'тема ' + usage.theme]
          .filter(x => x != null).join(' · ');
        if (usage.kind === 'nodeProperty') {
          const target = document.createElement('button');
          target.type = 'button';
          target.textContent = 'К слою';
          target.addEventListener('click', () => {
            const node = [...document.querySelectorAll('#layers [role="treeitem"]')].find(row => row.dataset.id === usage.ownerId);
            node?.querySelector('.layer-label')?.click();
          });
          li.append(' ', target);
        }
        li.title = (usage.chain ?? []).map(id => items.find(item => item.id === id)?.name ?? id).join(' → ');
        usageList.append(li);
      }
    }
    if (!styleUsages.length) {
      const empty = document.createElement('li');
      empty.textContent = 'Использований нет.';
      usageList.append(empty);
    }
  }

  function resolvePreview(style, theme, seen = new Set()) {
    if (!style || !seen.add(style.id)) return style ? { error: 'Цикл наследования' } : {};
    const result = style.basedOnStyleId ? resolvePreview(items.find(i => i.id === style.basedOnStyleId), theme, seen) : {};
    for (const [field, value] of Object.entries(style.fields ?? {})) {
      if (field === 'typography') {
        const catalog = new Map(tokens().map(item => [item.id, item]));
        const resolved = value?.type === 'token'
          ? resolveTokenValue(value, catalog, theme, 'Typography')
          : resolveInlineTypography(value?.value, catalog, theme);
        result.typography = resolved.error ?? tokenValueText(resolved.value);
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
    epoch++; clearTimeout(timer); drafts.clear(); activeAuto = null; formId = undefined; formSnapshot = null;
    items = []; selectedId = null; busy = false; tokenSignature = '';
    styleUsages = []; styleUsageRequest++;
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
    if (changed && selectedId) loadUsages();
  }

  async function write(endpoint, payload, id = selectedId) {
    if (!editable() || busy) return;
    const startedEpoch = epoch;
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
      if (startedEpoch === epoch && current === getContext().generation && error.name !== 'AbortError') el('styles-error').textContent =
        error.status >= 500 || error instanceof TypeError ? 'Результат неизвестен. Обновите документ.' : error.message;
    } finally {
      if (startedEpoch === epoch) {
        busy = false; render();
        if (current === getContext().generation) startLive();
        schedule(0);
      }
    }
  }

  async function loadUsages() {
    const id = selectedId, doc = getContext().documentId, revision = getContext().revision;
    const generation = ++styleUsageRequest;
    styleUsages = []; render();
    if (!id || !Number.isSafeInteger(revision)) return;
    try {
      const found = []; let total;
      do {
        const response = await request('/api/v1/documents/' + encodeURIComponent(doc) +
          '/styles/' + encodeURIComponent(id) + '/usages?revision=' + revision +
          '&offset=' + found.length + '&limit=100');
        if (response.revision !== revision || response.offset !== found.length ||
            !Array.isArray(response.items)) throw new Error('Некорректный ответ использований стиля.');
        found.push(...response.items); total = response.total;
        if (found.length < total && response.items.length === 0) throw new Error('Неполный список использований.');
      } while (found.length < total);
      if (generation === styleUsageRequest && id === selectedId &&
          revision === getContext().revision && doc === getContext().documentId) {
        styleUsages = found;
        render();
      }
    } catch (error) {
      if (generation === styleUsageRequest) el('styles-error').textContent = error.message;
    }
  }
  function readRow(row) {
    if (!row.active.checked) return null;
    const value = row.source.value === 'alias'
      ? (row.ref.value ? { type: 'token', tokenId: row.ref.value } : null)
      : row.inline ? row.inline.value() : literalOf(row.field, row.direct.value);
    if (!value) throw new Error('Выберите токен для ' + row.label);
    return value;
  }

  function schedule(delay = 500) {
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  }

  function capture(target, immediate, edited = false) {
    const saved = chosen();
    if (rendering || !saved || !editable() || !formSnapshot || formSnapshot.id !== saved.id) return;
    let key, read;
    if (target === el('styles-name')) {
      key = 'name';
      read = () => {
        const name = target.value.trim();
        if (!name || name.length > 256) throw new Error('Введите название стиля.');
        return name;
      };
    } else if (target === el('styles-based-on')) {
      key = 'basedOnStyleId'; read = () => target.value || null;
    } else {
      const row = rows.find(item => item.element.contains(target));
      if (!row) return;
      key = 'fields.' + row.field; read = () => readRow(row);
    }
    let draft = drafts.get(saved.id);
    if (!draft) {
      draft = { id: saved.id, changes: new Map(), invalid: new Set(), blocked: false };
      drafts.set(saved.id, draft);
    }
    try {
      const value = read();
      const previous = draft.changes.get(key);
      // A blur/Enter after a conflict must not silently rebase the rejected value.
      if (draft.blocked && (!edited || previous && equal(previous.value, value))) return;
      const base = draft.blocked ? fieldValue(saved, key) : previous ? previous.base : fieldValue(formSnapshot, key);
      draft.invalid.delete(key);
      target.removeAttribute('aria-invalid');
      const row = rows.find(item => item.element.contains(target));
      row?.element.querySelectorAll('[aria-invalid]').forEach(control => control.removeAttribute('aria-invalid'));
      if (equal(value, base) && !(activeAuto?.id === saved.id && activeAuto.sent.has(key))) draft.changes.delete(key);
      else draft.changes.set(key, { base, value, ready: key !== 'name' || immediate });
      draft.blocked = false;
      if (!draft.invalid.size) el('styles-error').textContent = '';
    } catch (error) {
      draft.changes.delete(key);
      draft.invalid.add(key);
      target.setAttribute('aria-invalid', 'true');
      el('styles-error').textContent = error.message;
    }
    renderPreview(draftStyle(saved, draft));
    if (!draft.changes.size && !draft.invalid.size && activeAuto?.id !== saved.id) drafts.delete(saved.id);
    if (immediate) void flush();
    else if (key !== 'name') schedule(500);
  }

  async function flush() {
    clearTimeout(timer);
    if (busy || !editable()) return;
    const draft = [...drafts.values()].find(item => !item.blocked && [...item.changes.values()].some(change => change.ready));
    if (!draft) return;
    const saved = items.find(item => item.id === draft.id);
    if (!saved) {
      draft.blocked = true;
      el('styles-error').textContent = 'Стиль удалён другим участником.';
      schedule(0);
      return;
    }
    const sent = new Map();
    let style = saved;
    for (const [key, change] of draft.changes) {
      if (!change.ready) continue;
      const current = fieldValue(saved, key);
      if (equal(current, change.value)) { draft.changes.delete(key); continue; }
      if (!equal(current, change.base)) {
        draft.blocked = true;
        el('styles-error').textContent = 'Стиль изменился другим участником. Проверьте значение и отредактируйте его снова.';
        schedule(0);
        return;
      }
      sent.set(key, change);
      style = withValue(style, key, change.value);
    }
    if (!sent.size) {
      if (!draft.changes.size && !draft.invalid.size) drafts.delete(draft.id);
      schedule(0); return;
    }
    const context = getContext(), startedEpoch = epoch;
    // Automatic edits must not cancel an unrelated explicit command or navigation.
    const signal = new AbortController().signal;
    stopLive();
    const op = { id: draft.id, sent };
    activeAuto = op; busy = true;
    el('styles-save').disabled = el('styles-delete').disabled = true;
    el('styles-status').textContent = 'Сохранение…';
    const stillCurrent = () => startedEpoch === epoch && context.documentId === getContext().documentId;
    try {
      const result = await request('/api/v1/documents/' + encodeURIComponent(context.documentId) + '/commands/upsert-style',
        { method: 'POST', body: JSON.stringify({
          commandId: crypto.randomUUID(), expectedRevision: context.revision,
          style: { ...style, type: styleType(style) === 'TextStyle' ? 0 : 1 }
        }) }, signal);
      if (!stillCurrent()) return;
      if (result.status !== 'ACCEPTED' || !Number.isSafeInteger(result.revision))
        throw new Error('Не удалось подтвердить состояние стиля. Обновите документ.');
      const canRead = () => stillCurrent() && getContext().revision <= result.revision;
      if (getContext().revision < result.revision) {
        try { await readPages(signal, 0, result.revision, canRead); }
        catch (error) { if (error.name !== 'AbortError') throw error; }
      }
      if (!stillCurrent()) return;
      if (getContext().revision < result.revision)
        throw new Error('Не удалось обновить состояние стиля. Обновите документ.');
      // Rebase only onto the value we sent, not a later collaborator's value.
      const confirmed = getContext().revision === result.revision
        ? items.find(item => item.id === draft.id) : style;
      for (const [key, change] of sent) {
        const currentChange = draft.changes.get(key);
        const value = fieldValue(confirmed, key);
        if (currentChange === change) draft.changes.delete(key);
        else if (currentChange) currentChange.base = value;
        if (formSnapshot?.id === draft.id) formSnapshot = withValue(formSnapshot, key, value);
      }
      if (!draft.changes.size && !draft.invalid.size) drafts.delete(draft.id);
      el('styles-status').textContent = 'Стиль сохранён.';
    } catch (error) {
      if (startedEpoch === epoch && context.documentId === getContext().documentId) {
        draft.blocked = true;
        el('styles-status').textContent = '';
        el('styles-error').textContent = error.name === 'AbortError' || error.status >= 500 || error instanceof TypeError
          ? 'Результат неизвестен. Обновите документ перед повторной попыткой.' : error.message;
      }
    } finally {
      if (startedEpoch === epoch) {
        activeAuto = null; busy = false;
        if (stillCurrent()) { render(); startLive(); schedule(0); }
      }
    }
  }

  const form = el('styles-form');
  form.addEventListener('input', event => {
    if (!event.isComposing && event.target.matches('input:not([type=checkbox])')) capture(event.target, false, true);
  });
  form.addEventListener('change', event => capture(event.target, true, event.target.matches('select,input[type=checkbox]')));
  form.addEventListener('focusout', event => {
    if (event.target.matches('input:not([type=checkbox])')) capture(event.target, true);
  });
  form.addEventListener('keydown', event => {
    if (event.isComposing || !selectedId || !event.target.matches('input:not([type=checkbox])')) return;
    if (event.key === 'Enter') { event.preventDefault(); capture(event.target, true); }
    else if (event.key === 'Escape' && event.target === el('styles-name')) {
      event.preventDefault(); event.stopPropagation();
      const draft = drafts.get(selectedId);
      const sent = activeAuto?.id === selectedId ? activeAuto.sent.get('name') : null;
      event.target.value = sent?.value ?? chosen().name;
      if (sent) draft?.changes.set('name', sent);
      else draft?.changes.delete('name');
      draft?.invalid.delete('name');
      event.target.removeAttribute('aria-invalid');
      if (draft && !draft.invalid.size && !draft.changes.size) {
        drafts.delete(selectedId);
        el('styles-error').textContent = '';
      }
      renderPreview(draftStyle(chosen(), drafts.get(selectedId)));
    }
  });

  el('styles-list').addEventListener('change', () => {
    const previousDraft = drafts.get(selectedId);
    if (previousDraft) {
      previousDraft.invalid.clear();
      if (!previousDraft.changes.size && activeAuto?.id !== selectedId) drafts.delete(selectedId);
    }
    selectedId = el('styles-list').value || null;
    formId = undefined;
    loadUsages(); schedule(0);
  });
  el('styles-type').addEventListener('change', () => {
    const type = el('styles-type').value;
    choices(el('styles-based-on'), items.filter(style => styleType(style) === type && style.id !== selectedId), 'Без родителя');
    buildFields(chosen(), type);
  });
  el('styles-form').addEventListener('submit', event => {
    event.preventDefault();
    if (chosen()) { schedule(0); return; }
    try {
      const existing = chosen();
      const name = el('styles-name').value.trim();
      if (!name || name.length > 256) throw new Error('Введите название стиля.');
      const type = el('styles-type').value;
      const fields = {};
      for (const row of rows) {
        const value = readRow(row);
        if (value != null) fields[row.field] = value;
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
