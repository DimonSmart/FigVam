const labels = {
  x: 'X', y: 'Y', width: 'Ширина', height: 'Высота',
  widthMode: 'Режим ширины', heightMode: 'Режим высоты', visible: 'Видимость', opacity: 'Непрозрачность',
  layout: 'Компоновка', paddingTop: 'Отступ сверху', paddingRight: 'Отступ справа',
  paddingBottom: 'Отступ снизу', paddingLeft: 'Отступ слева', gap: 'Промежуток',
  mainAlignment: 'Выравнивание вдоль оси', crossAlignment: 'Выравнивание поперёк оси',
  overflow: 'Переполнение', text: 'Текст', textColor: 'Цвет текста', textAlignment: 'Выравнивание текста',
  fontSize: 'Размер шрифта', fontFamily: 'Семейство шрифта', fontFallback: 'Запасное семейство шрифта',
  fontWeight: 'Толщина шрифта', fontStyle: 'Начертание', lineHeight: 'Межстрочный интервал', wrap: 'Перенос строк',
  enabled: 'Доступность', placeholder: 'Подсказка', value: 'Демонстрационное значение', multiline: 'Многострочный режим',
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

function tokenControl(name, definition, model, initial, direct) {
  const label = propertyLabel(name);
  const tokenList = tokenChoices(model.tokens, definition.tokenType);
  const group = document.createElement('fieldset'), legend = document.createElement('legend');
  legend.textContent = label;
  const directType = definition.type.toLowerCase();
  const mode = selectChoices([[directType, definition.type === 'Color' ? 'Цвет' : 'Число'], ['token', 'Токен']]);
  const token = selectChoices(tokenList, tokenList.length ? 'Выберите токен' : 'Нет доступных токенов');
  const tokenLabel = labeled('Токен', token, `${label} — токен`);
  group.append(legend, labeled('Источник', mode, `${label} — источник`), ...direct.content, tokenLabel);
  function showMode() {
    const isDirect = mode.value !== 'token';
    for (const control of direct.content) control.hidden = !isDirect;
    tokenLabel.hidden = isDirect;
  }
  mode.addEventListener('change', showMode);
  return {
    content: [group], inputs: [mode, ...direct.inputs, token],
    initial: [initial?.type === 'token' ? 'token' : directType, direct.initial, initial?.tokenId ?? ''],
    read: () => [mode.value, direct.read(), token.value],
    write([source, value, tokenId]) {
      mode.value = source;
      direct.write(value);
      setReference(token, tokenId);
      showMode();
    },
    validate() {
      if (mode.value === 'token') {
        if (!tokenList.some(([id]) => id === token.value)) return { input: token, error: 'Выберите доступный токен.' };
        return { value: { type: 'token', tokenId: token.value } };
      }
      return direct.validate();
    }
  };
}

function colorControl(name, initial) {
  const label = propertyLabel(name);
  const color = document.createElement('input'), alpha = document.createElement('input');
  color.type = 'color';
  alpha.type = 'number'; alpha.min = '0'; alpha.max = '255'; alpha.step = '1'; alpha.required = true;
  const hex = [initial?.red, initial?.green, initial?.blue].map(channel => (channel ?? 0).toString(16).padStart(2, '0')).join('');
  return {
    content: [labeled('Цвет', color, label), labeled('Альфа (0–255)', alpha, `${label} — альфа`)],
    inputs: [color, alpha], initial: [`#${hex}`, String(initial?.alpha ?? 255)],
    read: () => [color.value, alpha.value],
    write([rgb, opacity]) {
      color.value = rgb;
      alpha.value = opacity;
    },
    validate() {
      if (!alpha.validity.valid) return { input: alpha, error: 'Введите целое значение от 0 до 255.' };
      const [red, green, blue] = [1, 3, 5].map(offset => parseInt(color.value.slice(offset, offset + 2), 16));
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

function scalarControl(name, definition, model, initial, compactGeometry = false) {
  const type = definition.type;
  const assets = [...model.assets.values()];
  const choices = {
    Asset: () => assets.map(asset => [asset.id, `PNG ${asset.width} × ${asset.height} · ${asset.id}`]),
    TokenReference: () => tokenChoices(model.tokens, definition.tokenType),
    Enum: () => definition.enumValues.map(option => [option, option])
  }[type]?.();
  const referenceKey = { Asset: 'assetId', TokenReference: 'tokenId' }[type];
  const placeholder = {
    Asset: assets.length ? 'Выберите ассет' : 'В документе нет ассетов',
    TokenReference: choices?.length ? 'Выберите токен' : 'Нет доступных токенов'
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
    return { value: { type: type === 'TokenReference' ? 'token' : type.toLowerCase(), [referenceKey ?? 'value']: value } };
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
  const direct = definition.type === 'Color' ? colorControl(name, directValue) :
    scalarControl(name, definition, model, directValue,
      prefix === 'visual-property' && geometryProperties.has(name));
  const control = hasTokenChoice ? tokenControl(name, definition, model, initial, direct) : direct;
  const row = document.createElement('div'), feedback = document.createElement('p');
  row.className = 'node-property';
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
  return {
    row, read: control.read, write: control.write, baseline: control.read(),
    setDisabled(disabled) {
      for (const input of control.inputs) input.disabled = disabled;
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
}
