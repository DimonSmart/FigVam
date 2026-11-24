import { createTokenValueControl } from './token-value-control.js';
const labels = {
  x: 'X', y: 'Y', width: 'Ширина', height: 'Высота',
  widthMode: 'Режим ширины', heightMode: 'Режим высоты', visible: 'Видимость', opacity: 'Непрозрачность',
  layout: 'Компоновка', paddingTop: 'Отступ сверху', paddingRight: 'Отступ справа',
  paddingBottom: 'Отступ снизу', paddingLeft: 'Отступ слева', gap: 'Между элементами',
  mainAlignment: 'Выравнивание вдоль оси', crossAlignment: 'Выравнивание поперёк оси',
  overflow: 'Переполнение', text: 'Текст', textColor: 'Цвет текста', textAlignment: 'Выравнивание текста',
  fontSize: 'Размер шрифта', fontFamily: 'Семейство шрифта', fontFallback: 'Запасное семейство шрифта',
  fontWeight: 'Толщина шрифта', fontStyle: 'Начертание', lineHeight: 'Межстрочный интервал',
  letterSpacing: 'Межбуквенный интервал', wrap: 'Перенос строк',
  enabled: 'Доступность', placeholder: 'Подсказка', value: 'Демонстрационное значение', multiline: 'Многострочный режим',
  inputType: 'Тип ввода', textStyle: 'Стиль текста', borderStyle: 'Стиль рамки',
  typography: 'Типографика', shadow: 'Drop shadow',
  backgroundColor: 'Цвет фона', borderColor: 'Цвет рамки', borderWidth: 'Толщина рамки', cornerRadius: 'Радиус углов',
  asset: 'Ассет', altText: 'Альтернативное описание', fit: 'Режим отображения'
};

export const propertyLabel = name => Object.hasOwn(labels, name) ? labels[name] : name;
const geometryProperties = new Set(['x', 'y', 'width', 'height']);

function tokenChoices(tokens, expected) {
  return [...tokens.values()]
    .filter(token => expected == null || token.type === expected)
    .map(token => [token.id, token.name]);
}

function selectChoices(choices, placeholder) {
  const select = document.createElement('select');
  if (placeholder) select.add(new Option(placeholder, ''));
  for (const [value, label] of choices) select.add(new Option(label, value));
  return select;
}

function setReference(select, value) {
  if (value && ![...select.options].some(option => option.value === value)) {
    const option = new Option(`Недоступен · ${value}`, value);
    option.disabled = true;
    select.add(option);
  }
  select.value = value ?? '';
}

function colorControl(name, initial, compact = false) {
  const label = propertyLabel(name);
  const color = document.createElement('input'), alpha = document.createElement('input');
  color.type = 'color';
  alpha.type = 'number'; alpha.min = '0'; alpha.max = '255'; alpha.step = '1'; alpha.required = true;
  const rgb = '#' + [initial?.red, initial?.green, initial?.blue]
    .map(channel => (channel ?? 0).toString(16).padStart(2, '0')).join('');
  if (!compact) {
    return {
      content: [labeled('Цвет', color, label), labeled('Альфа (0–255)', alpha, label + ' — альфа')],
      inputs: [color, alpha], initial: [rgb, String(initial?.alpha ?? 255)],
      read: () => [color.value, alpha.value],
      write([hex, opacity]) { color.value = hex; alpha.value = opacity; },
      validate() {
        if (!alpha.validity.valid) return { input: alpha, error: 'Введите целое значение от 0 до 255.' };
        const [red, green, blue] = [1, 3, 5].map(offset => parseInt(color.value.slice(offset, offset + 2), 16));
        return { value: { type: 'color', red, green, blue, alpha: alpha.valueAsNumber } };
      }
    };
  }

  const holder = document.createElement('div');
  holder.className = 'token-color-editor';
  const hex = document.createElement('input');
  hex.type = 'text'; hex.maxLength = 7; hex.spellcheck = false;
  hex.className = 'token-color-hex';
  hex.setAttribute('aria-label', label);
  color.className = 'token-color-picker';
  color.setAttribute('aria-label', label + ' — палитра');
  const alphaButton = document.createElement('button');
  alphaButton.type = 'button';
  alphaButton.textContent = 'A';
  alphaButton.title = 'Изменить Alpha';
  alphaButton.className = 'token-color-alpha-button';
  alphaButton.setAttribute('aria-label', 'Изменить Alpha');
  alphaButton.setAttribute('aria-expanded', 'false');
  const alphaPanel = document.createElement('div');
  alphaPanel.className = 'token-color-alpha-panel';
  alphaPanel.hidden = true;
  alphaPanel.append(labeled('Альфа (0–255)', alpha, label + ' — альфа'));
  holder.append(color, hex, alphaButton, alphaPanel);
  alphaButton.addEventListener('click', () => {
    alphaPanel.hidden = !alphaPanel.hidden;
    alphaButton.setAttribute('aria-expanded', String(!alphaPanel.hidden));
    if (!alphaPanel.hidden) alpha.focus();
  });
  color.addEventListener('input', () => {
    hex.value = color.value;
    hex.dispatchEvent(new Event('input', { bubbles: true }));
  });
  hex.addEventListener('input', () => {
    if (/^#[0-9a-f]{6}$/i.test(hex.value)) color.value = hex.value;
  });
  return {
    content: [holder], inputs: [color, hex, alpha, alphaButton],
    initial: [rgb, String(initial?.alpha ?? 255)],
    read: () => [hex.value, alpha.value],
    write([value, opacity]) {
      hex.value = value ?? '';
      color.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
      alpha.value = opacity ?? '';
    },
    validate() {
      if (!/^#[0-9a-f]{6}$/i.test(hex.value))
        return { input: hex, error: 'Введите цвет в формате #RRGGBB.' };
      if (!alpha.validity.valid || !Number.isInteger(alpha.valueAsNumber))
        return { input: alpha, error: 'Введите целое значение Alpha от 0 до 255.' };
      const [red, green, blue] = [1, 3, 5].map(offset => parseInt(hex.value.slice(offset, offset + 2), 16));
      return { value: { type: 'color', red, green, blue, alpha: alpha.valueAsNumber } };
    }
  };
}

function labeled(name, control, accessibleName) {
  const label = document.createElement('label');
  label.append(name, control);
  if (accessibleName) control.setAttribute('aria-label', accessibleName);
  return label;
}

function fontWeightControl(name, initial) {
  const select = document.createElement('select');
  for (const option of ['Normal', 'Medium', 'Semibold', 'Bold', 'Custom'])
    select.add(new Option(option === 'Custom' ? 'Числовое значение' : option, option));
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1'; input.max = '1000'; input.step = '1'; input.required = true;
  const presets = { Normal: 400, Medium: 500, Semibold: 600, Bold: 700 };
  select.setAttribute('aria-label', propertyLabel(name) + ' — пресет');
  input.setAttribute('aria-label', propertyLabel(name) + ' — числовое значение');
  const read = () => [select.value, input.value];
  const initialMode = initial?.type === 'number' ? 'Custom' : initial?.value ?? 'Normal';
  const initialValue = initial?.type === 'number' ? String(initial.value) : String(presets[initialMode] ?? 400);
  function sync() {
    input.hidden = select.value !== 'Custom';
    if (select.value !== 'Custom') input.value = String(presets[select.value]);
  }
  select.addEventListener('change', sync);
  return {
    content: [labeled(propertyLabel(name), select), input],
    inputs: [select, input], initial: [initialMode, initialValue], read,
    write([mode, value]) { select.value = mode; input.value = value; sync(); if (mode === 'Custom') input.value = value; },
    validate() {
      if (select.value !== 'Custom') return { value: { type: 'enum', value: select.value } };
      if (!input.validity.valid || !Number.isInteger(input.valueAsNumber) ||
          input.valueAsNumber < 1 || input.valueAsNumber > 1000)
        return { input, error: 'Введите целую толщину шрифта от 1 до 1000.' };
      return { value: { type: 'number', value: input.valueAsNumber } };
    }
  };
}

export const shadowPreset = { type: 'shadow', offsetX: 0, offsetY: 4, blurRadius: 8, spreadRadius: 0,
  color: { red: 0, green: 0, blue: 0, alpha: 38 } };

function shadowControl(initial) {
  const value = initial ?? shadowPreset;
  const dimensions = [['offsetX', 'X', -1024, 1024], ['offsetY', 'Y', -1024, 1024],
    ['blurRadius', 'Blur', 0, 256], ['spreadRadius', 'Spread', -256, 256]];
  const inputs = dimensions.map(([key, label, min, max]) => {
    const input = document.createElement('input');
    input.type = 'number'; input.required = true; input.step = 'any';
    input.min = String(min); input.max = String(max);
    return input;
  });
  const colors = colorControl('shadow', value.color, true);
  const geometry = document.createElement('div');
  geometry.className = 'shadow-geometry';
  geometry.append(...dimensions.map(([, label], i) => labeled(label, inputs[i], 'Drop shadow ' + label)));
  return {
    content: [geometry, ...colors.content], inputs: [...inputs, ...colors.inputs],
    initial: [...dimensions.map(([key]) => String(value[key])), ...colors.initial],
    read: () => [...inputs.map(input => input.value), ...colors.read()],
    write(raw) { inputs.forEach((input, i) => { input.value = raw[i]; }); colors.write(raw.slice(4)); },
    validate() {
      for (const input of inputs)
        if (!input.validity.valid || !Number.isFinite(input.valueAsNumber))
          return { input, error: 'Enter a finite value in the indicated range.' };
      const result = colors.validate();
      if (result.error) return result;
      const { type, ...color } = result.value;
      return { value: { type: 'shadow', ...Object.fromEntries(dimensions.map(([key], i) =>
        [key, inputs[i].valueAsNumber])), color } };
    }
  };
}

function scalarControl(name, definition, model, initial, compactGeometry = false) {
  if (definition.numericFontWeight) return fontWeightControl(name, initial);
  const type = definition.type;
  const assets = [...model.assets.values()];
  const choices = {
    Asset: () => assets.map(asset => [asset.id, `PNG ${asset.width} × ${asset.height} · ${asset.id}`]),
    TokenReference: () => tokenChoices(model.tokens, definition.tokenType),
    StyleReference: () => [...(model.styles?.values() ?? [])]
      .filter(style => style.type === definition.styleType)
      .map(style => [style.id, style.name]),
    Enum: () => definition.enumValues.map(option => [option, option])
  }[type]?.();
  const referenceKey = { Asset: 'assetId', TokenReference: 'tokenId', StyleReference: 'styleId' }[type];
  const placeholder = {
    Asset: assets.length ? 'Выберите ассет' : 'В документе нет ассетов',
    TokenReference: choices?.length ? 'Выберите токен' : 'Нет доступных токенов',
    StyleReference: choices?.length ? 'Выберите стиль' : 'Нет стилей данного типа'
  }[type];
  let input;
  if (choices) input = selectChoices(choices, placeholder);
  else if (type === 'String' && !definition.pattern) input = document.createElement('textarea');
  else {
    input = document.createElement('input');
    input.type = { Number: 'number', Boolean: 'checkbox' }[type] ?? 'text';
  }
  input.required = type === 'Number' || Boolean(referenceKey && definition.required);
  if (type === 'Number') {
    input.step = 'any';
    if (definition.minimum != null) input.min = definition.minimum;
    if (definition.maximum != null) input.max = definition.maximum;
    if (compactGeometry) input.addEventListener('blur', () => {
      if (!Number.isFinite(input.valueAsNumber) || !input.validity.valid) return;
      const rounded = String(Number(input.valueAsNumber.toFixed(2)));
      if (input.value !== rounded) {
        input.value = rounded;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }
  if (type === 'String' && definition.maxLength != null) input.maxLength = definition.maxLength;
  const pattern = definition.pattern && new RegExp(definition.pattern, 'u');
  const read = () => type === 'Boolean' ? input.checked : input.value;
  function validate() {
    const raw = read();
    const invalid = error => ({ input, error });
    if (type === 'Number' && (!Number.isFinite(input.valueAsNumber) || !input.validity.valid))
      return invalid(`Введите число от ${definition.minimum ?? '−∞'} до ${definition.maximum ?? '∞'}.`);
    if (type === 'String' && definition.maxLength != null && raw.length > definition.maxLength)
      return invalid(`Максимальная длина — ${definition.maxLength}.`);
    if (pattern && pattern.exec(raw)?.[0] !== raw) return invalid('Проверьте формат значения.');
    if (choices && !choices.some(([value]) => value === raw)) {
      if (referenceKey && !definition.required && !raw) return {};
      return invalid(placeholder ?? 'Выберите допустимое значение.');
    }
    if (input.validity.valueMissing) return invalid('Заполните поле.');
    const value = type === 'Number' ?
      (compactGeometry ? Number(input.valueAsNumber.toFixed(2)) : input.valueAsNumber) : raw;
    return { value: { type: type === 'TokenReference' ? 'token' : type === 'StyleReference' ? 'style' : type.toLowerCase(), [referenceKey ?? 'value']: value } };
  }
  return {
    content: [labeled(propertyLabel(name), input)],
    inputs: [input], initial: initial?.[referenceKey ?? 'value'] ?? (type === 'Boolean' ? false : ''),
    read, validate,
    write(value, preserveInput = false) {
      if (type === 'Boolean') input.checked = value;
      else if (referenceKey) setReference(input, value);
      else if (compactGeometry && !preserveInput && typeof value === 'number' && Number.isFinite(value))
        input.value = String(Number(value.toFixed(2)));
      else input.value = value;
    }
  };
}

export function createPropertyControl(name, definition, model, value, prefix) {
  const initial = value ?? definition.defaultValue;
  const hasTokenChoice = definition.tokenType != null && definition.type !== 'TokenReference';
  const directValue = hasTokenChoice && initial?.type === 'token' ? definition.defaultValue : initial;
  const direct = definition.type === 'Shadow' ? shadowControl(directValue) : definition.type === 'Color' ? colorControl(name, directValue, hasTokenChoice) :
    scalarControl(name, definition, model, directValue,
      prefix === 'visual-property' && geometryProperties.has(name));
  const control = hasTokenChoice ? createTokenValueControl(name, definition, model, initial, direct, propertyLabel(name)) : direct;
  const row = document.createElement('div'), feedback = document.createElement('p');
  row.className = 'node-property';
  if (hasTokenChoice) row.classList.add('node-property--token');
  if (prefix === 'visual-property' && geometryProperties.has(name) && definition.type === 'Number')
    row.classList.add('node-property--geometry');
  feedback.id = `${prefix}-${name}-validation`;
  feedback.className = 'node-property-error';
  feedback.setAttribute('aria-live', 'polite');
  for (const [index, input] of control.inputs.entries()) {
    input.id = `${prefix}-${name}${index ? `-${index}` : ''}`;
    input.setAttribute('aria-describedby', feedback.id);
  }
  row.append(...control.content, feedback);
  control.write(control.initial);
  const resultControl = {
    row, read: control.read, write: control.write, baseline: control.read(),
    setDisabled(disabled) {
      if (control.setDisabled) control.setDisabled(disabled);
      else for (const input of control.inputs) input.disabled = disabled;
    },
    validate(show = true) {
      const result = control.validate();
      if (show) {
        feedback.textContent = result.error ?? '';
        for (const input of control.inputs) {
          if (input === result.input) input.setAttribute('aria-invalid', 'true');
          else input.removeAttribute('aria-invalid');
        }
      }
      return result;
    }
  };
  if (hasTokenChoice && initial?.type === 'token') resultControl.validate();
  return resultControl;
}
