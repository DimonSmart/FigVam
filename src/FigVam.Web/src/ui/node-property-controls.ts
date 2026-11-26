import type { ColorChannels, NodePropertyValue, ShadowValue, TokenMap, TokenType, ResolvableValue } from '../core/tokens/token-model';
import type { ControlDefinition, PropertyControl, PropertyModel, RawValue, Validation } from './property-control-contract';
import { rawArray, rawText } from './property-control-contract';
import { createTokenValueControl } from './token-value-control.js';
const labels:Record<string,string> = {
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

export const propertyLabel = (name:string) => labels[name] ?? name;
const geometryProperties = new Set(['x', 'y', 'width', 'height']);
const compactGeometryLabel = (name:string) => name === 'width' ? 'W' : name === 'height' ? 'H' : propertyLabel(name);

function tokenChoices(tokens:TokenMap, expected:TokenType|number|null|undefined):[string,string][] {
  return [...tokens.values()]
    .filter(token => expected == null || token.type === expected)
    .map(token => [token.id, token.name]);
}

function selectChoices(choices:readonly (readonly [string,string])[], placeholder?:string) {
  const select = document.createElement('select');
  if (placeholder) select.add(new Option(placeholder, ''));
  for (const [value, label] of choices) select.add(new Option(label, value));
  return select;
}

function setReference(select:HTMLSelectElement, value:string) {
  if (value && ![...select.options].some(option => option.value === value)) {
    const option = new Option(`Недоступен · ${value}`, value);
    option.disabled = true;
    select.add(option);
  }
  select.value = value ?? '';
}

function colorControl(name:string, initial:ColorChannels|null|undefined, compact=false):PropertyControl {
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
      write(raw) { const [hex,opacity]=rawArray(raw); color.value=rawText(hex); alpha.value=rawText(opacity); },
      validate() {
        if (!alpha.validity.valid) return { input: alpha, error: 'Введите целое значение от 0 до 255.' };
        const [red=0, green=0, blue=0] = [1, 3, 5].map(offset => parseInt(color.value.slice(offset, offset + 2), 16));
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
    // The original color input event bubbles; do not emit a second synthetic event.
  });
  hex.addEventListener('input', () => {
    if (/^#[0-9a-f]{6}$/i.test(hex.value)) color.value = hex.value;
  });
  return {
    content: [holder], inputs: [color, hex, alpha, alphaButton],
    initial: [rgb, String(initial?.alpha ?? 255)],
    read: () => [hex.value, alpha.value],
    write(raw) {
      const [colorValue,opacity]=rawArray(raw),value=rawText(colorValue);
      hex.value = value;
      color.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
      alpha.value = rawText(opacity);
    },
    validate() {
      if (!/^#[0-9a-f]{6}$/i.test(hex.value))
        return { input: hex, error: 'Введите цвет в формате #RRGGBB.' };
      if (!alpha.validity.valid || !Number.isInteger(alpha.valueAsNumber))
        return { input: alpha, error: 'Введите целое значение Alpha от 0 до 255.' };
      const [red=0, green=0, blue=0] = [1, 3, 5].map(offset => parseInt(hex.value.slice(offset, offset + 2), 16));
      return { value: { type: 'color', red, green, blue, alpha: alpha.valueAsNumber } };
    }
  };
}

function labeled(name:string, control:HTMLElement, accessibleName?:string) {
  const label = document.createElement('label');
  label.append(name, control);
  if (accessibleName) control.setAttribute('aria-label', accessibleName);
  return label;
}

function fontWeightControl(name:string, initial:NodePropertyValue|null|undefined):PropertyControl {
  const select = document.createElement('select');
  for (const option of ['Normal', 'Medium', 'Semibold', 'Bold', 'Custom'])
    select.add(new Option(option === 'Custom' ? 'Числовое значение' : option, option));
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1'; input.max = '1000'; input.step = '1'; input.required = true;
  const presets:Record<string,number> = { Normal: 400, Medium: 500, Semibold: 600, Bold: 700 };
  select.setAttribute('aria-label', propertyLabel(name) + ' — пресет');
  input.setAttribute('aria-label', propertyLabel(name) + ' — числовое значение');
  const read = () => [select.value, input.value];
  const initialMode = initial?.type === 'number' ? 'Custom' : initial?.type==='enum' ? initial.value : 'Normal';
  const initialValue = initial?.type === 'number' ? String(initial.value) : String(presets[initialMode] ?? 400);
  function sync() {
    input.hidden = select.value !== 'Custom';
    if (select.value !== 'Custom') input.value = String(presets[select.value]);
  }
  select.addEventListener('change', sync);
  return {
    content: [labeled(propertyLabel(name), select), input],
    inputs: [select, input], initial: [initialMode, initialValue], read,
    write(raw) { const [m,v]=rawArray(raw), mode=rawText(m),value=rawText(v);select.value = mode; input.value = value; sync(); if (mode === 'Custom') input.value = value; },
    validate() {
      if (select.value !== 'Custom') return { value: { type: 'enum', value: select.value } };
      if (!input.validity.valid || !Number.isInteger(input.valueAsNumber) ||
          input.valueAsNumber < 1 || input.valueAsNumber > 1000)
        return { input, error: 'Введите целую толщину шрифта от 1 до 1000.' };
      return { value: { type: 'number', value: input.valueAsNumber } };
    }
  };
}

export const shadowPreset:ShadowValue = { type: 'shadow', offsetX: 0, offsetY: 4, blurRadius: 8, spreadRadius: 0,
  color: { red: 0, green: 0, blue: 0, alpha: 38 } };

export function shadowControl(initial:ShadowValue|null|undefined):PropertyControl {
  const value = initial ?? shadowPreset;
  const dimensions = [['offsetX', 'X', -1024, 1024], ['offsetY', 'Y', -1024, 1024],
    ['blurRadius', 'Blur', 0, 256], ['spreadRadius', 'Spread', -256, 256]] as const;
  const inputs = dimensions.map(([key, label, min, max]) => {
    const input = document.createElement('input');
    input.type = 'number'; input.required = true; input.step = 'any';
    input.min = String(min); input.max = String(max);
    return input;
  });
  function inputAt(index:number):HTMLInputElement{const field=inputs[index];if(!field)throw new Error('Missing shadow field');return field;}
  const colors = colorControl('shadow', value.color, true);
  const geometry = document.createElement('div');
  geometry.className = 'shadow-geometry';
  geometry.append(...dimensions.map(([, label], i) => labeled(label, inputAt(i), 'Drop shadow ' + label)));
  return {
    content: [geometry, ...colors.content], inputs: [...inputs, ...colors.inputs],
    initial: [...dimensions.map(([key]) => String(value[key])), ...rawArray(colors.initial)],
    read: () => [...inputs.map(input => input.value), ...rawArray(colors.read())],
    write(raw) { const values=rawArray(raw); inputs.forEach((input,i)=>{input.value=rawText(values[i]);});colors.write(values.slice(4)); },
    writeResolved(result) {
      if (result.error || result.value?.type!=='shadow') { this.write(['', '', '', '', '', '']); return; }
      const value = result.value;
      this.write([...dimensions.map(([key]) => String(value[key])), '#' + [value.color.red, value.color.green, value.color.blue].map(v => v.toString(16).padStart(2, '0')).join(''), String(value.color.alpha)]);
    },
    validate() {
      for (const input of inputs)
        if (!input.validity.valid || !Number.isFinite(input.valueAsNumber))
          return { input, error: 'Enter a finite value in the indicated range.' };
      const result = colors.validate();
      if (result.error || result.value?.type!=='color') return result;
      const { type, ...color } = result.value;
      return {value:{type:'shadow',offsetX:inputAt(0).valueAsNumber,offsetY:inputAt(1).valueAsNumber,blurRadius:inputAt(2).valueAsNumber,spreadRadius:inputAt(3).valueAsNumber,color}};
    }
  };
}

function initialRaw(initial:NodePropertyValue|null|undefined,key:'assetId'|'tokenId'|'styleId'|undefined,type:string):RawValue{
  if(key==='assetId'&&initial?.type==='asset')return initial.assetId;
  if(key==='tokenId'&&initial?.type==='token')return initial.tokenId;
  if(key==='styleId'&&initial?.type==='style')return initial.styleId;
  if(initial&&'value' in initial&&(typeof initial.value==='string'||typeof initial.value==='number'||typeof initial.value==='boolean'))return initial.value;
  return type==='Boolean'?false:'';
}
function scalarControl(name:string, definition:ControlDefinition, model:PropertyModel, initial:NodePropertyValue|null|undefined, compactGeometry=false):PropertyControl {
  if (definition.numericFontWeight) return fontWeightControl(name, initial);
  const type = definition.type;
  const assets = [...model.assets.values()];
  const choiceFactories:Record<string,()=>[string,string][]> = {
    Asset: () => assets.map(asset => [asset.id, `PNG ${asset.width} × ${asset.height} · ${asset.id}`]),
    TokenReference: () => tokenChoices(model.tokens, definition.tokenType),
    StyleReference: () => [...(model.styles?.values() ?? [])]
      .filter(style => style.type === definition.styleType)
      .map(style => [style.id, style.name]),
    Enum: () => (definition.enumValues??[]).map(option => [option, option])
  };
  const choices=choiceFactories[type]?.();
  const referenceKeys:Record<string,'assetId'|'tokenId'|'styleId'>={Asset:'assetId',TokenReference:'tokenId',StyleReference:'styleId'};
  const referenceKey=referenceKeys[type];
  const placeholders:Record<string,string> = {
    Asset: assets.length ? 'Выберите ассет' : 'В документе нет ассетов',
    TokenReference: choices?.length ? 'Выберите токен' : 'Нет доступных токенов',
    StyleReference: choices?.length ? 'Выберите стиль' : 'Нет стилей данного типа'
  };
  const placeholder=placeholders[type];
  let input:HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement;
  if (choices) input = selectChoices(choices, placeholder);
  else if (type === 'String' && !definition.pattern) input = document.createElement('textarea');
  else {
    input = document.createElement('input');
    input.type = type==='Number'?'number':type==='Boolean'?'checkbox':'text';
  }
  input.required = type === 'Number' || Boolean(referenceKey && definition.required);
  if (type === 'Number' && input instanceof HTMLInputElement) {
    const numeric=input;
    input.step = 'any';
    if (definition.minimum != null) input.min = String(definition.minimum);
    if (definition.maximum != null) input.max = String(definition.maximum);
    if (compactGeometry) input.addEventListener('blur', () => {
      if (!Number.isFinite(numeric.valueAsNumber) || !numeric.validity.valid) return;
      const rounded = String(Number(numeric.valueAsNumber.toFixed(2)));
      if (input.value !== rounded) {
        input.value = rounded;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }
  if (type === 'String' && definition.maxLength != null && !(input instanceof HTMLSelectElement)) input.maxLength = definition.maxLength;
  const pattern = definition.pattern && new RegExp(definition.pattern, 'u');
  const read = () => type === 'Boolean' && input instanceof HTMLInputElement ? input.checked : input.value;
  function validate():Validation {
    const raw = read();
    const invalid = (error:string) => ({ input, error });
    if (type === 'Number' && (!(input instanceof HTMLInputElement) || !Number.isFinite(input.valueAsNumber) || !input.validity.valid))
      return invalid(`Введите число от ${definition.minimum ?? '−∞'} до ${definition.maximum ?? '∞'}.`);
    if (type === 'String' && definition.maxLength != null && typeof raw==='string' && raw.length > definition.maxLength)
      return invalid(`Максимальная длина — ${definition.maxLength}.`);
    if (pattern && pattern.exec(String(raw))?.[0] !== raw) return invalid('Проверьте формат значения.');
    if (choices && !choices.some(([value]) => value === raw)) {
      if (referenceKey && !definition.required && !raw) return {};
      return invalid(placeholder ?? 'Выберите допустимое значение.');
    }
    if (input.validity.valueMissing) return invalid('Заполните поле.');
    switch(type){
      case 'Number': {if(!(input instanceof HTMLInputElement))return invalid('Введите число.');const value=compactGeometry?Number(input.valueAsNumber.toFixed(2)):input.valueAsNumber;return{value:{type:'number',value}};}
      case 'Boolean':return{value:{type:'boolean',value:raw===true}};
      case 'String':return{value:{type:'string',value:String(raw)}};
      case 'Enum':return{value:{type:'enum',value:String(raw)}};
      case 'Asset':return{value:{type:'asset',assetId:String(raw)}};
      case 'TokenReference':return{value:{type:'token',tokenId:String(raw)}};
      case 'StyleReference':return{value:{type:'style',styleId:String(raw)}};
      default:return invalid('Неподдерживаемый тип свойства: '+type);
    }
  }
  return {
    content: [labeled(compactGeometry ? compactGeometryLabel(name) : propertyLabel(name), input,
      compactGeometry ? propertyLabel(name) : undefined)],
    inputs: [input], initial: initialRaw(initial,referenceKey,type),
    read, validate,
    write(value, preserveInput = false) {
      if (type === 'Boolean' && input instanceof HTMLInputElement) input.checked = value===true;
      else if (referenceKey && input instanceof HTMLSelectElement) setReference(input, rawText(value));
      else if (compactGeometry && !preserveInput && typeof value === 'number' && Number.isFinite(value))
        input.value = String(Number(value.toFixed(2)));
      else input.value = rawText(value);
    }
  };
}

export function createPropertyControl(name:string, definition:ControlDefinition, model:PropertyModel, value:NodePropertyValue|null|undefined, prefix:string) {
  const initial = value ?? definition.defaultValue;
  const hasTokenChoice = definition.tokenType != null && definition.type !== 'TokenReference';
  const directValue = hasTokenChoice && initial?.type === 'token' ? definition.defaultValue : initial;
  const compactGeometry = prefix === 'visual-property' && geometryProperties.has(name) && definition.type === 'Number';
  const direct = definition.type === 'Shadow' ? shadowControl(directValue?.type==='shadow'?directValue:null) : definition.type === 'Color' ? colorControl(name, directValue?.type==='color'?directValue:null, hasTokenChoice) :
    scalarControl(name, definition, model, directValue,
      compactGeometry);
  const control = hasTokenChoice ? createTokenValueControl(name, definition, model, initial, direct, propertyLabel(name),
    compactGeometry ? compactGeometryLabel(name) : propertyLabel(name), { theme: model.theme ?? 'Light', ...(definition.type === 'Shadow' ? { customDirect: true, writeResolved: result => direct.writeResolved?.(result) } : {}) }) : direct;
  const row = document.createElement('div'), feedback = document.createElement('p');
  row.className = 'node-property';
  if (hasTokenChoice) row.classList.add('node-property--token');
  if (compactGeometry) row.classList.add('node-property--geometry');
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
    setDisabled(disabled:boolean) {
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
