import { flushSync } from 'react-dom';
import { createPanelRoot } from '../../app/react-panels';
import { ResourceUsages } from '../../ui/ResourceUsages';
import type { ApiClient } from '../../api/api-client';
import { ApiError } from '../../api/api-client';
import { requiredRecord, array, text, errorMessage, aborted } from '../../api/decode';
import { nodeProperty } from '../../canvas/render-model';
import type { DesignToken, NodePropertyValue, TokenType, TokenCategory, Theme, TokenValue, TypographyFieldsValue, TypographyField } from '../../core/tokens/token-model';

type StyleType='TextStyle'|'BorderStyle';
interface DesignStyle {id:string;name:string;type:number|string;fields:Record<string,NodePropertyValue>;basedOnStyleId:string|null}
interface Usage {label?:string;kind:string;property?:string;theme?:string|number|null;indirect?:boolean;ownerId:string;chain?:string[]}
interface Context {documentId:string|null;documentRole:string|null;revision:number|null;generation:number}
interface Options {element(id:string):HTMLElement;request:ApiClient;getContext():Context;getTokens():DesignToken[];startRequest():{signal:AbortSignal;current:number};stopLive():void;startLive():void;readPages(signal:AbortSignal):Promise<unknown>}
function checked<T extends HTMLElement>(node:HTMLElement,ctor:{new():T}):T{if(!(node instanceof ctor))throw new Error('Unexpected style field: '+node.id);return node;}
function style(value:unknown):DesignStyle{const s=requiredRecord(value);return{id:text(s.id),name:text(s.name),type:typeof s.type==='number'?s.type:text(s.type),fields:Object.fromEntries(Object.entries(requiredRecord(s.fields)).map(([name,v])=>[name,nodeProperty(v)])),basedOnStyleId:s.basedOnStyleId==null?null:text(s.basedOnStyleId)};}
function usage(value:unknown):Usage{const v=requiredRecord(value);return{kind:text(v.kind),ownerId:text(v.ownerId),label:v.label==null?undefined:text(v.label),property:v.property==null?undefined:text(v.property),theme:v.theme==null?null:typeof v.theme==='number'?v.theme:text(v.theme),indirect:v.indirect===true,chain:array(v.chain??[],text)};}
import { normalizedTokenType, normalizedTokenCategory, resolveTokenValue, resolveInlineTypography, tokenValueText } from '../../core/tokens/token-resolution';

const definitions:Record<StyleType,Record<string,[string,TokenType|null,TokenCategory|null]>> = {
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
const typographyParts:Record<TypographyField,[string,TokenType,TokenCategory|null,string]> = {
  fontFamily: ['Семейство', 'FontFamily', null, 'Arial'],
  fontSize: ['Размер', 'Dimension', 'FontSize', '16'],
  fontWeight: ['Толщина', 'FontWeight', null, '400'],
  lineHeight: ['Интерлиньяж', 'Number', 'LineHeight', '1.25'],
  letterSpacing: ['Межбуквенный интервал', 'Dimension', 'LetterSpacing', '0']
};
const palette:Record<string,string[]> = {
  fontStyle: ['Normal', 'Italic'],
  fontFallback: ['SansSerif', 'Serif', 'Monospace']
};
const styleType = (style:DesignStyle|null|undefined):StyleType => !style || style.type === 0 || style.type === 'TextStyle' ? 'TextStyle' : 'BorderStyle';

function literalOf(field:string, text:string):NodePropertyValue {
  if (field === 'textColor' || field === 'borderColor') {
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(text)) throw new Error('Введите цвет в формате #RRGGBB или #RRGGBBAA.');
    const hex = text.slice(1) + (text.length === 7 ? 'FF' : '');
    const [red=0, green=0, blue=0, alpha=255] = [0, 2, 4, 6].map(i => parseInt(hex.slice(i, i + 2), 16));
    return { type: 'color', red, green, blue, alpha };
  }
  const options=palette[field];
  if (options) {
    if (!options.includes(text)) throw new Error('Выберите допустимое значение.');
    return { type: 'enum', value: text };
  }
  if (!text.trim() || !Number.isFinite(Number(text))) throw new Error('Введите число.');
  const number = Number(text);
  if (number < 0 || number > 1000000) throw new Error('Значение вне допустимого диапазона.');
  return { type: 'number', value: number };
}

function literalText(_field:string, value:NodePropertyValue|null|undefined) {
  if (!value) return '';
  if (value.type === 'color') return '#' + [value.red, value.green, value.blue, value.alpha]
    .map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase();
  return String('value' in value?value.value??'':'');
}

export function createStyles({ element, request, getContext, getTokens, startRequest, stopLive, startLive, readPages }:Options) {
  const el = element;
  let items:DesignStyle[]=[], selectedId:string|null=null,busy=false,tokenSignature='';
  const select=(id:string)=>checked(el(id),HTMLSelectElement),fieldInput=(id:string)=>checked(el(id),HTMLInputElement),btn=(id:string)=>checked(el(id),HTMLButtonElement);
  let styleUsages:Usage[]=[],styleUsageRequest=0;
  const usageRoot=createPanelRoot(el('styles-usages'));
  const editable = () => ['Owner', 'Editor'].includes(getContext().documentRole??'');
  const chosen = () => items.find(style => style.id === selectedId);
  const tokens = () => getTokens() ?? [];
  const candidates = (type:TokenType,category:TokenCategory|null) => tokens().filter(token =>
    normalizedTokenType(token.type) === type && normalizedTokenCategory(token.category) === category);
  const choices = (source:HTMLSelectElement,options:readonly {id:string;name:string}[],empty='Выберите токен') => {
    source.replaceChildren(new Option(empty, ''));
    for (const item of options) source.add(new Option(item.name, item.id));
  };
  function input<K extends 'input'|'select'>(type:K,name:string,initial=''):HTMLElementTagNameMap[K] {
    const element = document.createElement(type);
    element.setAttribute('aria-label', name);
    if (element instanceof HTMLInputElement) element.value=initial;
    return element;
  }
  const rows:{field:string;label:string;active:HTMLInputElement;source:HTMLSelectElement;direct:HTMLInputElement|HTMLSelectElement|HTMLFieldSetElement;ref:HTMLSelectElement;inline:ReturnType<typeof makeInlineTypography>|null}[]=[];
  const editor = el('styles-fields');

  function choose(select:HTMLSelectElement,value:string|null|undefined) {
    if (value && ![...select.options].some(option => option.value === value)) {
      const missing = new Option('Недоступная ссылка', value);
      missing.disabled = true; select.add(missing);
    }
    select.value = value ?? '';
  }

  function makeInlineTypography(existing:TokenValue|null|undefined) {
    const group = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = 'Поля типографики';
    group.append(legend);
    const entries:{field:TypographyField;type:TokenType;category:TokenCategory|null;mode:HTMLSelectElement;direct:HTMLInputElement;alias:HTMLSelectElement}[]=[];
    for (const field of Object.keys(typographyParts) as TypographyField[]) {
      const [label,type,category,fallback]=typographyParts[field];
      const part = existing?.type === 'typographyFields' ? existing[field] : null;
      const old = existing?.type === 'typography' ? existing[field] : null;
      const row = document.createElement('div');
      row.className = 'token-typography-row';
      const mode = input('select', label + ': источник');
      mode.add(new Option('Прямое', 'literal')); mode.add(new Option('Токен', 'alias'));
      mode.value = part?.expression === 'alias' ? 'alias' : 'literal';
      const direct = input('input', label + ': значение', part?.expression === 'literal'
        ? String('value' in part.value ? part.value.value??fallback : fallback) : old == null ? fallback : String(old));
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
        const value:TypographyFieldsValue={type:'typographyFields'};
        for (const { field, type, mode, direct, alias } of entries) {
          if (mode.value === 'alias') {
            if (!alias.value) throw new Error('Выберите токен для ' + field + '.');
            value[field] = { expression: 'alias', tokenId: alias.value };
          } else {
            const raw = direct.value.trim();
            let data:TokenValue;
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
              data={type:type==='Dimension'?'dimension':type==='FontWeight'?'fontWeight':'number',value:number};
            }
            value[field] = { expression: 'literal', value: data };
          }
        }
        return { type: 'typography' as const, value };
      }
    };
  }

  function buildFields(style:DesignStyle|null|undefined,type:StyleType) {
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
      const inline = field === 'typography' ? makeInlineTypography(saved?.type==='typography'?saved.value:null) : null;
      const direct = inline?.element ?? (palette[field] ? input('select',label) : input('input',label + ': значение'));
      if (direct instanceof HTMLSelectElement) {
        const options=palette[field]??[];
        for (const value of options) direct.add(new Option(value,value));
        direct.value=saved?.type==='enum'?saved.value:options[0]??'';
      } else if (direct instanceof HTMLInputElement) direct.value = saved && saved.type !== 'token' ? literalText(field, saved)
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
    const list = select('styles-list');
    choices(list, items, 'Новый стиль');
    choose(list, selectedId);
    el('styles-total').textContent = 'Стили: ' + items.length;
    const writable = editable();
    el('styles-form').hidden = !writable;
    el('styles-delete').hidden = !writable || !selected;
    btn('styles-save').disabled = !writable || busy;
    btn('styles-delete').disabled = busy;
    fieldInput('styles-name').value = selected?.name ?? '';
    select('styles-type').value = type;
    select('styles-type').disabled = Boolean(selected);
    const parent = select('styles-based-on');
    choices(parent, items.filter(item => styleType(item) === type && item.id !== selected?.id), 'Без родителя');
    choose(parent, selected?.basedOnStyleId);
    buildFields(selected, type);
    renderPreview(selected);
    flushSync(()=>usageRoot.render(<ResourceUsages usages={styleUsages}
      name={id=>items.find(item=>item.id===id)?.name??id} selectLayer={id=>{
        const node=[...document.querySelectorAll<HTMLElement>('#layers [role="treeitem"]')].find(row=>row.dataset.id===id);
        node?.querySelector<HTMLElement>('.layer-label')?.click();
      }}/>));
  }

  function resolvePreview(style:DesignStyle|null|undefined,theme:Theme,seen=new Set<string>()):Record<string,string> {
    if(!style)return {};if(seen.has(style.id))return {error:'Цикл наследования'};seen.add(style.id);
    const result = style.basedOnStyleId ? resolvePreview(items.find(i => i.id === style.basedOnStyleId), theme, seen) : {};
    for (const [field, value] of Object.entries(style.fields ?? {})) {
      if (field === 'typography') {
        const catalog = new Map(tokens().map(item => [item.id, item]));
        const resolved = value?.type === 'token'
          ? resolveTokenValue(value, catalog, theme, 'Typography')
          : resolveInlineTypography(value?.type==='typography'?value.value:null,catalog,theme);
        result.typography = resolved.error ?? tokenValueText(resolved.value);
      } else if (value?.type === 'token') {
        const token = resolveTokenValue(value, new Map(tokens().map(t => [t.id, t])), theme);
        result[field] = token.error ?? tokenValueText(token.value);
      } else result[field] = literalText(field, value);
    }
    return result;
  }

  function renderPreview(style:DesignStyle|null|undefined) {
    const box = el('styles-preview');
    if (!style) { box.textContent = 'Выберите стиль или создайте новый.'; return; }
    const summarize = (theme:Theme) => {
      const result = resolvePreview(style, theme);
      return theme + ': ' + Object.entries(result).map(([key, value]) => key + ' = ' + value).join('; ');
    };
    box.textContent = summarize('Light') + '\n' + summarize('Dark');
  }

  function reset() {
    items = []; selectedId = null; busy = false; tokenSignature = '';
    styleUsages = []; styleUsageRequest++;
    el('styles-error').textContent = ''; el('styles-status').textContent = '';
    render();
  }

  async function read(base:string,revision:number,signal:AbortSignal,isCurrent:()=>boolean) {
    const all:DesignStyle[]=[];let total:number;
    do {
      const response=requiredRecord(await request(base+'/styles?revision='+revision+'&offset='+all.length+'&limit=100',{},signal,isCurrent));
      if (response.revision !== revision || !Array.isArray(response.items) ||
          typeof response.total!=='number'||!Number.isInteger(response.total) || response.offset !== all.length)
        throw new Error('Некорректный ответ списка стилей.');
      all.push(...response.items.map(style));
      total = response.total;
      if (all.length < total && response.items.length === 0) throw new Error('Неполный список стилей.');
    } while (all.length < total);
    return all;
  }

  function apply(next:DesignStyle[]) {
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

  async function write(endpoint:'upsert-style'|'delete-style',payload:{style?:DesignStyle;styleId?:string},id:string|null=selectedId) {
    if (!editable() || busy) return;
    busy = true;
    const { signal, current } = startRequest();
    stopLive();
    btn('styles-save').disabled = btn('styles-delete').disabled = true;
    el('styles-error').textContent = '';
    try {
      const context=getContext();if(!context.documentId)throw new Error('No document');
      await request('/api/v1/documents/' + encodeURIComponent(context.documentId) + '/commands/' + endpoint,
        { method: 'POST', body: JSON.stringify({ commandId: crypto.randomUUID(), expectedRevision: context.revision, ...payload }) },
        signal);
      if (signal.aborted || current !== getContext().generation) return;
      selectedId = id;
      await readPages(signal);
      el('styles-status').textContent = 'Стиль сохранён.';
    } catch (error) {
      if (!aborted(error)) el('styles-error').textContent =
        (error instanceof ApiError&&error.status>=500)||error instanceof TypeError ? 'Результат неизвестен. Обновите документ.' : errorMessage(error);
    } finally {
      busy = false; render(); startLive();
    }
  }

  async function loadUsages() {
    const id = selectedId, doc = getContext().documentId, revision = getContext().revision;
    const generation = ++styleUsageRequest;
    styleUsages = []; render();
    if (!id || !doc || !Number.isSafeInteger(revision)) return;
    try {
      const found:Usage[]=[];let total:number;
      do {
        const response=requiredRecord(await request('/api/v1/documents/'+encodeURIComponent(doc)+'/styles/'+encodeURIComponent(id)+'/usages?revision='+revision+'&offset='+found.length+'&limit=100'));
        if (response.revision !== revision || response.offset !== found.length ||
            !Array.isArray(response.items)||typeof response.total!=='number')throw new Error('Некорректный ответ использований стиля.');
        found.push(...response.items.map(usage)); total = response.total;
        if (found.length < total && response.items.length === 0) throw new Error('Неполный список использований.');
      } while (found.length < total);
      if (generation === styleUsageRequest && id === selectedId &&
          revision === getContext().revision && doc === getContext().documentId) {
        styleUsages = found;
        render();
      }
    } catch (error) {
      if (generation === styleUsageRequest) el('styles-error').textContent = errorMessage(error);
    }
  }
  el('styles-list').addEventListener('change', () => {
    selectedId = select('styles-list').value || null;
    loadUsages();
  });
  el('styles-type').addEventListener('change', () => {
    const type:StyleType=select('styles-type').value==='TextStyle'?'TextStyle':'BorderStyle';
    choices(select('styles-based-on'), items.filter(style => styleType(style) === type && style.id !== selectedId), 'Без родителя');
    buildFields(chosen(), type);
  });
  el('styles-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const existing = chosen();
      const name = fieldInput('styles-name').value.trim();
      if (!name || name.length > 256) throw new Error('Введите название стиля.');
      const type:StyleType=select('styles-type').value==='TextStyle'?'TextStyle':'BorderStyle';
      const fields:Record<string,NodePropertyValue>={};
      for (const row of rows) {
        if (!row.active.checked) continue;
        const value = row.source.value === 'alias'
          ? (row.ref.value ? { type: 'token' as const, tokenId: row.ref.value } : null)
          : row.inline ? row.inline.value() : literalOf(row.field, row.direct instanceof HTMLFieldSetElement?'':row.direct.value);
        if (!value) throw new Error('Выберите токен для ' + row.label);
        fields[row.field] = value;
      }
      const id = existing?.id ?? crypto.randomUUID();
      write('upsert-style', { style: { id, name, type: type === 'TextStyle' ? 0 : 1,
        fields, basedOnStyleId: select('styles-based-on').value || null } }, id);
    } catch (error) { el('styles-error').textContent = errorMessage(error); }
  });
  el('styles-delete').addEventListener('click', () => {
    if (selectedId) write('delete-style', { styleId: selectedId }, null);
  });
  render();
  return { reset, read, apply, get items() { return items; } };
}
