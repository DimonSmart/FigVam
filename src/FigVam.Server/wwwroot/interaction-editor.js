import { interactionObjectName } from './interaction-catalog.js';

export const eventLabels = ['По нажатию', 'При изменении', 'При наведении', 'При уходе указателя', 'При отправке'];
export const actionLabels = {
  navigate: 'Перейти на экран', openOverlay: 'Открыть оверлей', closeOverlay: 'Закрыть оверлей',
  showVariant: 'Переключить вариант', setDemoValue: 'Установить значение',
  selectDataset: 'Выбрать датасет', resetPreview: 'Сбросить Preview'
};
const noValue = '__null__';
const id = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const clone = value => structuredClone(value);
function button(text, name, click) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = text; b.setAttribute('aria-label', name); b.addEventListener('click', click);
  return b;
}
function labelled(text, control, parent) {
  const label = document.createElement('label');
  label.append(text, control); parent.append(label); return control;
}
function setChoices(select, items, value, placeholder = 'Выберите значение') {
  const options = [{ id: '', label: placeholder }, ...items];
  if (value && !options.some(o => o.id === value)) options.push({ id: value, label: 'Недоступное значение' });
  const key = JSON.stringify(options.map(o => [o.id, o.label, o.group ?? '']));
  if (select.dataset.options !== key) {
    select.replaceChildren();
    const groups = new Map();
    for (const item of options) {
      const option = new Option(item.label, item.id);
      if (!item.group) select.append(option);
      else {
        if (!groups.has(item.group)) {
          const group = document.createElement('optgroup'); group.label = item.group;
          select.append(group); groups.set(item.group, group);
        }
        groups.get(item.group).append(option);
      }
    }
    select.dataset.options = key;
  }
  select.value = value ?? '';
}
function objectPicker(parent, label, changed) {
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Поиск по имени';
  labelled('Поиск: ' + label, search, parent);
  const select = labelled(label, document.createElement('select'), parent);
  let options = [], value = '';
  function render() {
    const q = search.value.toLocaleLowerCase().trim();
    setChoices(select, options.filter(o => !q || o.label.toLocaleLowerCase().includes(q) || o.id === value), value);
  }
  search.addEventListener('input', render);
  select.addEventListener('change', () => { value = select.value; changed(value); });
  return { update(items, selected) { options = items; value = selected ?? ''; render(); } };
}
function actionComplete(a) {
  switch (a.type) {
    case 'navigate': case 'openOverlay': return id(a.screenId);
    case 'showVariant': return a.variantId === null || id(a.variantId);
    case 'selectDataset': return a.datasetId === null || id(a.datasetId);
    case 'setDemoValue': return id(a.nodeId) && (a.value === null || typeof a.value === 'string' && a.value.length <= 4096);
    case 'closeOverlay': case 'resetPreview': return true;
    default: return false;
  }
}
function emptyAction(type) {
  if (type === 'setDemoValue') return { type, value: null };
  return { type };
}

export function createInteractionEditor({ element, request, current, catalog, sourceName, submit, pending, onClose }) {
  let draft = null, rows = [], controller = null, generation = 0, validationTimer = null;
  const form = element('scenario-edit'), fields = element('scenario-edit-fields');
  const event = element('scenario-edit-event'), status = element('scenario-edit-validation');
  const sameContext = d => draft === d && current().doc === d.doc && current().screen === d.screen && current().token === d.token;
  const active = d => sameContext(d) && current().revision === d.revision && current().editable && !d.conflict;
  const dirty = () => !!draft && JSON.stringify(draft.scenario) !== draft.original;
  const canSave = () => !!draft && active(draft) && draft.valid && !pending();
  const contextError = 'Документ изменился. Загрузите актуальное состояние или откажитесь от черновика.';

  function refreshControls() {
    if (!draft) return;
    const unavailable = !active(draft) || pending();
    fields.disabled = unavailable;
    element('scenario-edit-add').disabled = draft.scenario.actions.length >= 32;
    element('scenario-edit-submit').disabled = !canSave();
    element('scenario-edit-reload').hidden = !draft.conflict;
    element('scenario-edit-conflict').textContent = draft.conflict ? contextError : '';
    element('scenario-edit-cancel').disabled = pending();
  }

  function close(restoreFocus = false) {
    const old = draft;
    controller?.abort(); clearTimeout(validationTimer); generation++;
    draft = null; rows = [];
    form.hidden = true; fields.disabled = false;
    element('scenario-edit-actions').replaceChildren();
    if (restoreFocus) old?.opener?.focus();
    onClose();
  }

  function open(scenario, opener, creating = false) {
    const ctx = current();
    if (!ctx.editable || pending()) return;
    if (draft) close();
    const model = clone(scenario);
    if (creating && !model.actions.length) model.actions.push(emptyAction(''));
    draft = { ...ctx, scenario: model, creating, opener, original: JSON.stringify(model), conflict: false, valid: false };
    form.hidden = false;
    element('scenario-edit-title').textContent = creating ? 'Новое взаимодействие' : 'Редактирование взаимодействия';
    element('scenario-edit-source').textContent = 'Элемент: ' + sourceName(model.nodeId);
    event.replaceChildren();
    renderRows();
    element('scenario-edit-title').focus();
    validate();
  }

  function changed(immediate = false) {
    if (!draft) return;
    draft.valid = false; generation++; controller?.abort();
    clearTimeout(validationTimer); refreshControls();
    status.textContent = 'Проверка взаимодействия…';
    if (immediate) validate();
    else validationTimer = setTimeout(validate, 180);
  }

  function renderRows(focusIndex) {
    const list = element('scenario-edit-actions'), actions = draft.scenario.actions;
    rows = [];
    list.replaceChildren();
    actions.forEach((action, index) => {
      const row = document.createElement('li'); row.className = 'interaction-action';
      const tools = document.createElement('div'); tools.className = 'interaction-action-tools';
      const number = document.createElement('strong'); number.textContent = 'Действие ' + (index + 1);
      const move = direction => {
        const destination = index + direction;
        [actions[index], actions[destination]] = [actions[destination], actions[index]];
        renderRows(destination); changed(true);
      };
      const up = button('↑', 'Поднять действие ' + (index + 1), () => move(-1)); up.disabled = index === 0;
      const down = button('↓', 'Опустить действие ' + (index + 1), () => move(1)); down.disabled = index === actions.length - 1;
      const remove = button('Удалить', 'Удалить действие ' + (index + 1), () => {
        actions.splice(index, 1); renderRows(Math.min(index, actions.length - 1)); changed(true);
      });
      tools.append(number, up, down, remove); row.append(tools);
      const type = labelled('Тип действия ' + (index + 1), document.createElement('select'), row);
      type.dataset.actionType = String(index);
      type.addEventListener('change', () => {
        actions[index] = emptyAction(type.value);
        renderRows(index); changed(true);
      });
      const params = document.createElement('div'); row.append(params);
      const set = (key, value) => { actions[index][key] = value; changed(); };
      let picker = null;
      if (['navigate', 'openOverlay'].includes(action.type)) picker = objectPicker(params, 'Целевой экран', value => set('screenId', value || undefined));
      if (action.type === 'showVariant') picker = objectPicker(params, 'Вариант', value => set('variantId', value === noValue ? null : value || undefined));
      if (action.type === 'selectDataset') picker = objectPicker(params, 'Датасет', value => set('datasetId', value === noValue ? null : value || undefined));
      if (action.type === 'setDemoValue') {
        picker = objectPicker(params, 'Целевой элемент', value => { set('nodeId', value || undefined); refreshPassword(); });
        const nullBox = document.createElement('input'); nullBox.type = 'checkbox'; nullBox.checked = action.value === null;
        labelled('Значение null', nullBox, params);
        const value = document.createElement('textarea'); value.maxLength = 4096; value.rows = 2; value.value = action.value ?? '';
        // Password values are never displayed as plain text, including when reopening the action.
        const password = document.createElement('input'); password.type = 'password'; password.maxLength = 4096; password.value = action.value ?? '';
        const plainLabel = document.createElement('label'), passwordLabel = document.createElement('label');
        plainLabel.append('Демонстрационное значение', value); passwordLabel.append('Демонстрационное значение', password);
        params.append(plainLabel, passwordLabel);
        function refreshPassword() {
          const secret = catalog()?.nodes.find(n => n.id === actions[index].nodeId)?.properties?.inputType?.value === 'Password';
          plainLabel.hidden = !!secret; passwordLabel.hidden = !secret;
          value.disabled = password.disabled = nullBox.checked;
        }
        nullBox.addEventListener('change', () => { set('value', nullBox.checked ? null : (plainLabel.hidden ? password.value : value.value)); refreshPassword(); });
        value.addEventListener('input', () => { password.value = value.value; if (!nullBox.checked) set('value', value.value); });
        password.addEventListener('input', () => { value.value = password.value; if (!nullBox.checked) set('value', password.value); });
        refreshPassword();
      }
      const error = document.createElement('p'); error.className = 'interaction-action-error'; error.setAttribute('role', 'status'); row.append(error);
      list.append(row); rows.push({ type, picker, error });
    });
    refreshControls();
    if (focusIndex !== undefined) (rows[focusIndex]?.type ?? element('scenario-edit-add')).focus();
  }

  async function capabilities(d, prefix, values = {}) {
    const { targetId, screenId, variantId, datasetId, demoNodeId, demoValue = null } = values;
    const q = new URLSearchParams({ revision: String(d.revision), nodeId: d.scenario.nodeId });
    for (const [key, value] of Object.entries({ targetId, screenId, variantId, datasetId, demoNodeId })) if (value) q.set(key, value);
    const response = await request('/api/v1/documents/' + encodeURIComponent(d.doc) + '/scenario-capabilities?' + q, {
      method: 'POST', body: JSON.stringify({ demoValue, sourceScreenId: d.screen, prefix })
    }, controller.signal);
    if (response.documentId !== d.doc || response.nodeId !== d.scenario.nodeId || response.revision !== d.revision ||
        !Array.isArray(response.events) || !Array.isArray(response.actions) || !Array.isArray(response.potentialActions) ||
        !Array.isArray(response.demoTargetIds) || !Object.hasOwn(response, 'navigationScreenId') || !Object.hasOwn(response, 'demoScreenId'))
      throw new TypeError('Некорректный ответ о возможностях');
    return response;
  }

  function choices(action, ctx, objects) {
    switch (action.type) {
      case 'navigate': case 'openOverlay': return objects.screens.map(s => ({ ...s, group: s.pageName }));
      case 'showVariant': return [{ id: noValue, label: 'Базовое состояние' }, ...objects.variants.filter(v => !ctx.navigationScreenId || v.screenId === ctx.navigationScreenId)];
      case 'selectDataset': return [{ id: noValue, label: 'Без датасета' }, ...objects.datasets];
      case 'setDemoValue': return objects.nodes.filter(n => (!ctx.demoScreenId || n.screenId === ctx.demoScreenId) && ctx.demoTargetIds.includes(n.id));
      default: return [];
    }
  }
  function parameter(action) {
    if (action.type === 'navigate' || action.type === 'openOverlay') return action.screenId;
    if (action.type === 'showVariant') return action.variantId === null ? noValue : action.variantId;
    if (action.type === 'selectDataset') return action.datasetId === null ? noValue : action.datasetId;
    if (action.type === 'setDemoValue') return action.nodeId;
    return '';
  }
  function exact(action, ctx, objects, d) {
    switch (action.type) {
      case 'navigate': case 'openOverlay': return { targetId: action.screenId };
      case 'showVariant': return { screenId: ctx.navigationScreenId ?? objects.variants.find(v => v.id === action.variantId)?.screenId ?? d.screen, variantId: action.variantId };
      case 'selectDataset': return { datasetId: action.datasetId };
      case 'setDemoValue': return { screenId: ctx.demoScreenId ?? objects.nodes.find(n => n.id === action.nodeId)?.screenId, demoNodeId: action.nodeId, demoValue: action.value };
      default: return {};
    }
  }

  async function validate() {
    const d = draft, objects = catalog();
    if (!d || !active(d) || !objects) { refreshControls(); return; }
    controller?.abort(); controller = new AbortController();
    const version = ++generation;
    const live = () => active(d) && version === generation;
    d.valid = false; refreshControls(); status.textContent = 'Проверка взаимодействия…'; element('scenario-edit-recheck').hidden = true;
    try {
      let ctx = await capabilities(d, []);
      if (!live()) return;
      if (d.creating && d.scenario.event === null && ctx.events.length) {
        d.scenario.event = ctx.events.includes(0) ? 0 : ctx.events[0];
        if (JSON.parse(d.original).event === null) {
          const initial = JSON.parse(d.original); initial.event = d.scenario.event; d.original = JSON.stringify(initial);
        }
      }
      setChoices(event, ctx.events.map(v => ({ id: String(v), label: eventLabels[v] })), d.scenario.event == null ? '' : String(d.scenario.event), 'Выберите событие');
      let valid = ctx.events.includes(d.scenario.event) && d.scenario.actions.length > 0;
      let prefixValid = true;
      for (let i = 0; i < d.scenario.actions.length; i++) {
        const action = d.scenario.actions[i], controls = rows[i];
        if (i > 0 && prefixValid) {
          ctx = await capabilities(d, d.scenario.actions.slice(0, i));
          if (!live()) return;
        }
        setChoices(controls.type, ctx.potentialActions.filter(t => Object.hasOwn(actionLabels, t)).map(t => ({ id: t, label: actionLabels[t] })), action.type, 'Выберите действие');
        const options = prefixValid ? choices(action, ctx, objects) : [];
        controls.picker?.update(options, parameter(action));
        controls.error.textContent = '';
        let error = '';
        if (!prefixValid) error = 'Сначала исправьте предыдущее действие.';
        else if (!ctx.potentialActions.includes(action.type)) error = action.type ? 'Действие не поддерживается профилем.' : 'Выберите действие.';
        else if (!actionComplete(action)) error = 'Заполните параметры действия.';
        else if (controls.picker && !options.some(o => o.id === parameter(action))) error = 'Цель недоступна в текущем контексте.';
        else {
          const checked = await capabilities(d, d.scenario.actions.slice(0, i), exact(action, ctx, objects, d));
          if (!live()) return;
          if (!checked.actions.includes(action.type)) error = 'Параметры не поддерживаются профилем.';
        }
        if (!error && !ctx.navigationScreenId && action.type === 'showVariant') controls.error.textContent = 'Экран определяется состоянием Preview.';
        else if (!error && !ctx.demoScreenId && action.type === 'setDemoValue') controls.error.textContent = 'Активный экран определяется состоянием Preview.';
        else controls.error.textContent = error;
        if (error) { valid = false; prefixValid = false; }
      }
      if (!live()) return;
      d.valid = valid && d.scenario.actions.length <= 32;
      status.textContent = d.valid ? '' : 'Заполните событие и исправьте отмеченные действия.';
    } catch (error) {
      if (!live()) return;
      status.textContent = 'Не удалось проверить взаимодействие.';
      element('scenario-edit-recheck').hidden = false;
    } finally { if (live()) refreshControls(); }
  }

  event.addEventListener('change', () => {
    if (!draft) return;
    draft.scenario.event = event.value === '' ? null : Number(event.value);
    changed(true);
  });
  element('scenario-edit-add').addEventListener('click', () => {
    if (!draft || draft.scenario.actions.length >= 32) return;
    draft.scenario.actions.push(emptyAction('')); renderRows(draft.scenario.actions.length - 1); changed(true);
  });
  element('scenario-edit-recheck').addEventListener('click', validate);
  element('scenario-edit-cancel').addEventListener('click', () => close(true));
  form.addEventListener('submit', e => { e.preventDefault(); save(); });
  function save() {
    if (!canSave()) return false;
    submit(draft, clone(draft.scenario));
    return true;
  }
  function revisionChanged() {
    if (!draft) return;
    if (current().revision !== draft.revision && !pending()) {
      if (!dirty()) { close(); return; }
      draft.conflict = true; draft.valid = false; controller?.abort(); generation++;
    }
    refreshControls();
  }

  return { open, close, save, dirty, canSave, validate, refreshControls, revisionChanged,
    get draft() { return draft; } };
}
