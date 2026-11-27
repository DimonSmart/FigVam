import type { ReactElement } from 'react';
import { createViewModel } from '../../app/view-model';
import { Button } from '../../ui/Button';
import { ResourceUsages } from '../../ui/ResourceUsages';
import type { ApiClient } from '../../api/api-client';
import { ApiError } from '../../api/api-client';
import { requiredRecord, record, array, text, errorMessage, aborted } from '../../api/decode';
import { token as readToken } from '../../canvas/render-model';
import type { DesignToken, TokenType, TokenCategory, Theme, TokenValue, TokenExpression, TypographyFieldsValue, TypographyField, ResolvableValue } from '../../core/tokens/token-model';
import { tokenTypes, tokenCategories } from '../../core/tokens/token-model';
import type { TokenGroup } from '../../core/tokens/token-groups';
import type { PropertyControl, ControlInput } from '../../ui/property-control-contract';
import { rawArray, rawText } from '../../ui/property-control-contract';
import type { components } from '../../api/schema.generated';
type Schema=components['schemas'];
type Command='add-token'|'set-token-value'|'delete-token'|'rename-token'|'import-design-tokens';
type CommandData=Omit<Schema['AddTokenRequest'],'commandId'|'values'> & {values:Record<Theme,TokenExpression>}
  | Omit<Schema['SetTokenValueRequest'],'commandId'|'value'> & {value:TokenExpression}
  | Omit<Schema['DeleteTokenRequest'],'commandId'>
  | Omit<Schema['RenameTokenRequest'],'commandId'>
  | Omit<Schema['ImportDesignTokensRequest'],'commandId'>;
interface Context {documentId:string|null;documentRole:string|null;revision:number|null;generation:number;navigationEpoch:number}
interface Options {models:ReturnType<typeof createTokenModels>;selectLayer(id:string):void;showEditor():void;element(id:string):HTMLElement;request:ApiClient;getContext():Context;startRequest():{signal:AbortSignal;current:number};stopLive():void;startLive():void;readPages(signal:AbortSignal):Promise<unknown>}
interface Usage {label?:string;kind:string;property?:string|null;theme?:number|string|null;indirect:boolean;ownerId:string;chain:string[]}
interface UsageSnapshot {selection:string|null;usages:Usage[]}
interface Snapshot extends UsageSnapshot {items:DesignToken[]}
interface ThemeSave {tokenId:string;theme:Theme;index:number;value:TokenExpression;documentId:string|null}
interface TypographyPart {name:TypographyField;label:string;type:TokenType;category:TokenCategory|null;initial:string}
function checked<T extends HTMLElement>(value:HTMLElement,ctor:{new():T}):T{if(!(value instanceof ctor))throw new Error('Unexpected token control: '+value.id);return value;}
function usage(value:unknown):Usage{const v=requiredRecord(value);return{kind:text(v.kind),ownerId:text(v.ownerId),label:v.label==null?undefined:text(v.label),property:v.property==null?null:text(v.property),theme:v.theme==null?null:typeof v.theme==='number'?v.theme:text(v.theme),indirect:v.indirect===true,chain:array(v.chain??[],text)};}
function knownType(value:unknown):TokenType{const type=normalizedTokenType(value);if(!type)throw new TypeError('Неизвестный тип токена');return type;}
function literalValue(value:ResolvableValue|undefined):TokenValue{
  if(!value)throw new Error('Заполните значение токена.');
  switch(value.type){case 'color':case 'shadow':case 'geometry':case 'spacing':case 'dimension':case 'fontFamily':case 'fontWeight':case 'number':case 'typographyFields':return value;case 'typography':if(!('value' in value))return value;}
  throw new TypeError('Некорректное значение токена.');
}
import { splitTokenBundle } from '../../core/tokens/token-exchange';
import { shadowControl } from '../../ui/node-property-controls';
import { createTokenValueControl } from '../../ui/token-value-control';
import { tokenSegments, buildTokenGroups, shortTokenName, tokenNameError, tokenNameDiagnostics, filteredTokens, tokensInGroup, matchesTokenSearch, qualifyTokenName } from '../../core/tokens/token-groups';
import { normalizedTokenType, normalizedTokenCategory, resolveTokenValue, tokenValueText } from '../../core/tokens/token-resolution';

const types=tokenTypes;const themes:Theme[]=['Light','Dark'];
const categories=tokenCategories;
const allowedCategories:Partial<Record<string,readonly string[]>> = {
  Dimension: ['Spacing', 'FontSize', 'Radius', 'BorderWidth', 'Size', 'LetterSpacing'],
  Number: ['LineHeight', 'Opacity']
};
const typeIndex=(type:unknown)=>types.indexOf(knownType(type));
const categoryIndex=(category:unknown)=>{const c=normalizedTokenCategory(category);return c==null?null:categories.indexOf(c);};

function literalExpression(type:TokenType,category:TokenCategory|null,raw:string):Extract<TokenExpression,{expression:'literal'}> {
  const valueType = normalizedTokenType(type);
  if (valueType === 'Color') {
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(raw))
      throw new Error('Введите цвет как #RRGGBB или #RRGGBBAA.');
    const hex = raw.slice(1) + (raw.length === 7 ? 'FF' : '');
    const [red=0, green=0, blue=0, alpha=255] = [0, 2, 4, 6].map(i => parseInt(hex.slice(i, i + 2), 16));
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
  const names:Partial<Record<TokenType,'spacing'|'geometry'|'dimension'|'number'|'fontWeight'>>={Spacing:'spacing',Geometry:'geometry',Dimension:'dimension',Number:'number',FontWeight:'fontWeight'};
  const name=valueType?names[valueType]:undefined;
  if (!name) throw new Error('Неподдерживаемый тип токена.');
  return { expression: 'literal', value: name === 'geometry'
    ? { type: name, radius: value } : { type: name, value } };
}

function directText(expression:TokenExpression|null|undefined) {
  if (expression?.expression !== 'literal') return '';
  return tokenValueText(expression.value).replace(/ px$/, '');
}

const typeOf=(token:Pick<DesignToken,'type'>)=>knownType(token.type);
const categoryOf = (token:DesignToken) => normalizedTokenCategory(token?.category);
const typographyFields:TypographyPart[] = [
  { name: 'fontFamily', label: 'Шрифт', type: 'FontFamily', category: null, initial: 'Arial' },
  { name: 'fontSize', label: 'Размер, px', type: 'Dimension', category: 'FontSize', initial: '16' },
  { name: 'fontWeight', label: 'Толщина', type: 'FontWeight', category: null, initial: '400' },
  { name: 'lineHeight', label: 'Интерлиньяж', type: 'Number', category: 'LineHeight', initial: '1.25' },
  { name: 'letterSpacing', label: 'Межбуквенный интервал, px', type: 'Dimension', category: 'LetterSpacing', initial: '0' }
];

const groupKey = (segments:readonly string[]) => JSON.stringify(segments);
function TokenGroups({tree,group,collapsed,toggle,select}:{tree:TokenGroup;group:string[];collapsed:ReadonlySet<string>;toggle(key:string):void;select(segments:string[]):void}){
    function drawGroup(node:TokenGroup):ReactElement {
      const key=groupKey(node.segments), expanded=!collapsed.has(key);
      return <div key={key} className="token-group-branch" style={{display:'contents'}}>
        <div className="token-group-row">
          {node.children.size ? <Button aria-label={(expanded?'Свернуть ':'Раскрыть ')+(node.segments.join('.')||'все группы')}
            aria-expanded={expanded} onClick={()=>toggle(key)}>{expanded?'▾':'▸'}</Button> : <span aria-hidden="true"/>}
          <Button className="token-group-select" aria-pressed={key===groupKey(group)} onClick={()=>select(node.segments)}>{node.segments.at(-1)??'Все токены'}</Button>
        </div>
        {expanded && <div className="token-group-children">{[...node.children.values()].sort((a,b)=>(a.segments.at(-1)??'').localeCompare(b.segments.at(-1)??'')).map(drawGroup)}</div>}
      </div>;
    }

  return drawGroup(tree);
}
interface TableProps {
  tokenItems:DesignToken[]; displayed:DesignToken[];group:string[];search:string;selectedToken:string|null;usagesReady:boolean;usageCount:number;hasTypes:boolean;
  selectToken(id:string):void;selectAlias(id:string):void;
}
function TokenTable({tokenItems,displayed,group,search,selectedToken,usagesReady,usageCount,hasTypes,selectToken,selectAlias}:TableProps){
  const index=new Map(tokenItems.map(token=>[token.id,token]));
  const nameDiagnostics=tokenNameDiagnostics(tokenItems);
  const nameOf=(id:string)=>index.get(id)?.name??'Удалённый токен';
    const rows=displayed.map(item=>{
      const type=typeOf(item),category=categoryOf(item);
      const problems=[nameDiagnostics.get(item.id)].filter((x):x is string=>!!x);
      const sources:string[]=[];
      const cells=themes.map(currentTheme=>{
        const expression=item.values?.[currentTheme];
        const resolved=resolveTokenValue({type:'token',tokenId:item.id},index,currentTheme,item.type,item.category);
        const alias=expression?.expression==='alias';
        const nested=expression?.expression==='literal'&&expression.value.type==='typographyFields'&&typographyFields.some(field=>expression.value.type==='typographyFields'&&expression.value[field.name]?.expression==='alias');
        sources.push(alias?'alias':nested?'mixed':'literal');
        if(resolved.error)problems.push(currentTheme+': '+resolved.error);
        const color=type==='Color'&&!resolved.error&&resolved.value?.type==='color'?resolved.value:undefined;
        const value=resolved.error??tokenValueText(resolved.value);
        return <td key={currentTheme}>
          {color&&<span className="token-color-swatch" style={{backgroundColor:'rgba('+[color.red,color.green,color.blue,color.alpha/255].join(',')+')'}}/>}
          {alias?<><Button className="token-alias-link" title={value} disabled={!index.has(expression.tokenId)} onClick={()=>{
            selectAlias(expression.tokenId);
          }}>{'↳ '+nameOf(expression.tokenId)}</Button>{' · '+value}</>:value}
        </td>;
      });
      return <tr key={item.id} data-selected={String(item.id===selectedToken)}>
        <td><Button title={item.name} aria-pressed={item.id===selectedToken} onClick={()=>selectToken(item.id)}>{shortTokenName(item.name,search.trim()?[]:group)}</Button></td>
        <td>{category?type+'.'+category:type}</td>{cells}
        <td>{sources[0]===sources[1]?(sources[0]??''):'mixed'}</td>
        <td>{item.id===selectedToken&&usagesReady?String(usageCount):'—'}</td>
        <td className={problems.length?'token-invalid':undefined} title={problems.join('\n')}>{problems.length?'Ошибка':'—'}</td>
      </tr>;
    });

  return <>{rows.length?rows:<tr><td colSpan={7}>{hasTypes?'Нет токенов, соответствующих фильтрам.':'Не выбраны типы токенов'}</td></tr>}</>;
}
export function createTokenModels(){return {groups:createViewModel(TokenGroups),table:createViewModel(TokenTable),usage:createViewModel(ResourceUsages)};}

export function createTokens({ models, selectLayer, showEditor, element, request, getContext, startRequest, stopLive, startLive, readPages }:Options) {
  let tokenItems:DesignToken[]=[],selectedToken:string|null=null,tokenUsages:Usage[]=[],tokenLoad=0,rendered=false;
  const el=element,editable=()=>['Owner','Editor'].includes(getContext().documentRole??'');
  const input=(id:string)=>checked(el(id),HTMLInputElement),select=(id:string)=>checked(el(id),HTMLSelectElement),form=(id:string)=>checked(el(id),HTMLFormElement),area=(id:string)=>checked(el(id),HTMLTextAreaElement),btn=(id:string)=>checked(el(id),HTMLButtonElement);
  let group:string[]=[],collapsed=new Set<string>(), creating = false, usagesReady = false;
  let importEpoch = 0;
  let selectedTypes=new Set<TokenType>(types);
  let createControls:PropertyControl[]=[],detailControls:PropertyControl[]=[],renaming=false;
  const pendingThemeValues=new Map<Theme,ThemeSave>();
  let activeThemeSave:ThemeSave|null=null;
  const busy = () => el('token-create').inert;
  function refreshAccess() {
    el('new-token-open').hidden = el('token-import-open').hidden = !editable();
    for (const id of ['token-export','token-export-light','token-export-dark']) btn(id).disabled = !editable();
    if (!editable()) { creating = false; pendingThemeValues.clear(); el('token-import-form').hidden = true; }
    el('token-edit').hidden = !editable();
    if (!editable()) endRename();
    el('token-rename-open').hidden = !editable() || renaming;
    detailControls.forEach(control => control.setDisabled?.(!editable()));
    updateDetailVisibility();
  }
  const selected = () => tokenItems.find(t => t.id === selectedToken);
  function updateDetailVisibility() {
    el('token-create').hidden = !creating || !editable();
    el('token-detail').hidden = creating || !selected();
    el('token-placeholder').hidden = creating || !!selected();
  }
  function beginCreate() {
    if (!editable() || busy()) return;
    creating = true; form('token-create').reset();
    endRename();
    updateCategoryOptions();
    input('new-token-name').placeholder = group.length ? group.join('.') + '.…' : 'Имя токена';
    input('new-token-name').value = group.length ? group.join('.') + '.' : '';
    updateDetailVisibility(); el('new-token-name').focus();
  }
  el('new-token-open').addEventListener('click', beginCreate);
  el('new-token-cancel').addEventListener('click', () => { creating = false; updateDetailVisibility(); });
  const filter = el('token-type-filter');
  const checks=new Map<TokenType,HTMLInputElement>();
  const filterHeading = document.createElement('div');
  filterHeading.className = 'token-filter-heading'; filterHeading.textContent = 'Отображаемые типы';
  filterHeading.setAttribute('aria-hidden', 'true'); filter.append(filterHeading);
  function checkbox(label:string,value:string,change:()=>void) {
    const wrapper = document.createElement('label'), input = document.createElement('input');
    input.type = 'checkbox'; input.value = value; input.addEventListener('change', change);
    wrapper.append(input, label); filter.append(wrapper); return input;
  }
  const allTypes = checkbox('Все типы', '', () => {
    selectedTypes = selectedTypes.size === types.length ? new Set() : new Set(types);
    syncTypeFilter(); renderTokens(false);
  });
  for (const type of types) checks.set(type, checkbox(type, type, () => {
    if (checks.get(type)?.checked) selectedTypes.add(type); else selectedTypes.delete(type);
    syncTypeFilter(); renderTokens(false);
  }));
  function syncTypeFilter() {
    allTypes.checked = selectedTypes.size === types.length;
    allTypes.indeterminate = selectedTypes.size > 0 && !allTypes.checked;
    for (const [type, input] of checks) input.checked = selectedTypes.has(type);
    el('token-menu-open').dataset.filtered = String(!allTypes.checked);
    el('token-menu-open').setAttribute('aria-label', allTypes.checked ? 'Управление токенами' : 'Управление токенами (активен фильтр)');
  }
  syncTypeFilter();
  el('token-search').addEventListener('input', () => { group = []; renderTokens(false); });
  function syncImportMode() {
    const combined = select('token-import-mode').value === 'combined';
    for (const key of ['combined','light','dark']) {
      const visible = (key === 'combined') === combined;
      el('token-import-' + key + '-label').hidden = !visible;
      area('token-import-'+key).required = visible;
    }
  }
  el('token-import-mode').addEventListener('change', syncImportMode);
  syncImportMode();
  el('token-import-open').addEventListener('click', () => {
    if (editable() && !busy()) el('token-import-form').hidden = !el('token-import-form').hidden;
  });
  for (const theme of ['combined','light','dark']) {
    const field=area('token-import-'+theme),fileInput=input('token-import-'+theme+'-file');
    let fileLoad = 0;
    fileInput.addEventListener('change',async()=>{
      const file=fileInput.files?.[0], documentId = getContext().documentId, epoch = importEpoch, load = ++fileLoad;
      if (!file) return;
      try {
        if (file.size > (theme === 'combined' ? 2 * 1024 * 1024 + 4096 : 1024 * 1024)) throw new Error('Файл токенов слишком большой.');
        const value = await file.text();
        if (epoch === importEpoch && load === fileLoad && documentId === getContext().documentId && fileInput.files?.[0] === file) field.value = value;
      } catch (error) {
        if (epoch === importEpoch && load === fileLoad && documentId === getContext().documentId) el('tokens-error').textContent = errorMessage(error);
      }
    });
  }
  el('token-import-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      let lightJson:string,darkJson:string;
      if (select('token-import-mode').value === 'combined') {
        ({ lightJson, darkJson } = splitTokenBundle(area('token-import-combined').value));
      } else {
        lightJson = area('token-import-light').value; darkJson = area('token-import-dark').value;
        JSON.parse(lightJson); JSON.parse(darkJson);
      }
      const mapping=requiredRecord(JSON.parse(area('token-import-mapping').value||'{}'));
      const convert=(values:unknown,names:readonly string[])=>Object.fromEntries(Object.entries(values==null?{}:requiredRecord(values)).map(([key,value])=>{
        const index=typeof value==='number'?value:typeof value==='string'?names.indexOf(value):-1;
        if (!Number.isInteger(index) || index < 0 || index >= names.length) throw new Error('Неизвестный тип или категория: ' + value);
        return [key,index];
      }));
      const revision=getContext().revision;if(revision===null)throw new Error('Документ не открыт.');
      tokenCommand('import-design-tokens', { expectedRevision: revision, lightJson, darkJson,
        dimensionTypes: convert(mapping.dimensionTypes, types),
        dimensionCategories: convert(mapping.dimensionCategories, categories),
        numberCategories: convert(mapping.numberCategories, categories) });
    } catch (error) { el('tokens-error').textContent = errorMessage(error); }
  });
  async function exportTokens(theme?:Theme) {
    const { documentId, revision, navigationEpoch } = getContext();
    const active = () => documentId === getContext().documentId && navigationEpoch === getContext().navigationEpoch;
    if (!editable() || !documentId || !Number.isSafeInteger(revision)) return;
    el('tokens-error').textContent = '';
    try {
      async function readTheme(name:Theme){
        const result=requiredRecord(await request('/api/v1/documents/'+encodeURIComponent(documentId??'')+'/token-export?theme='+name+'&revision='+revision));
        const diagnostics=array(result.diagnostics??[],d=>text(requiredRecord(d).message));
        if(!result.tokens||diagnostics.length||result.revision!==revision)throw new Error(diagnostics.join('; ')||'Экспорт темы '+name+' недоступен.');
        return result.tokens;
      }
      let data;
      if (theme) data = await readTheme(theme);
      else {
        const [Light, Dark] = await Promise.all([readTheme('Light'), readTheme('Dark')]);
        data = { format: 'figvam-tokens', version: 1, themes: { Light, Dark } };
      }
      if (!active()) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = theme ? 'tokens-' + theme.toLowerCase() + '.json' : 'figvam-tokens.json';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { if (active()) el('tokens-error').textContent = errorMessage(error); }
  }
  el('token-export').addEventListener('click', () => exportTokens());
  el('token-export-light').addEventListener('click', () => exportTokens('Light'));
  el('token-export-dark').addEventListener('click', () => exportTokens('Dark'));
  const nameOf = (id:string) => tokenItems.find(t => t.id === id)?.name ?? 'Удалённый токен';
  // The shared control owns the literal/reference interaction; this adapter only
  // translates its values to the token command's literal/alias expression.
  const tokenIndex = () => new Map(tokenItems.map(token => [token.id, token]));
  function dependsOn(id:string|undefined,ownerId:string|undefined,theme:Theme,visited=new Set<string>()):boolean {
    if (!ownerId || !id || visited.has(id)) return false;
    if (id === ownerId) return true;
    visited.add(id);
    const expression = tokenItems.find(item => item.id === id)?.values?.[theme];
    if (expression?.expression === 'alias') return dependsOn(expression.tokenId, ownerId, theme, visited);
    if(expression?.expression==='literal'&&expression.value.type==='typographyFields'){
      const value=expression.value;return typographyFields.some(field=>{const part=value[field.name];return part?.expression==='alias'&&dependsOn(part.tokenId,ownerId,theme,visited);});
    }
    return false;
  }
  function makeTokenControl(prefix:string,label:string,type:TokenType,category:TokenCategory|null,theme:Theme,expression?:TokenExpression|null,ownerId?:string,initialText=''):PropertyControl {
    const literal = expression?.expression === 'literal' ? expression.value : null;
    let direct:PropertyControl;
    if (type === 'Shadow') {
      direct=shadowControl(literal?.type==='shadow'?literal:null);
      if(direct.writeResolved)direct.writeResolved=direct.writeResolved.bind(direct);
    } else if (type === 'Typography') {
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
        write: raw => children.forEach((child,i)=>child.write(rawArray(raw)[i]??null)),
        validate() {
          const value:TypographyFieldsValue={type:'typographyFields'};
          for (const [i, child] of children.entries()) {
            const result = child.validate();
            if (result.error) return result;
            const field=typographyFields[i];if(!field)throw new Error('Missing typography field');
            value[field.name]=asExpression(result.value);
          }
          return { value };
        },
        setDisabled: disabled => children.forEach(child => child.setDisabled?.(disabled)),
        refresh: () => children.forEach(child => child.refresh?.()),
        dispose: () => children.forEach(child => child.dispose?.())
      };
      direct.writeResolved = result => children.forEach((child, i) => {
        const field=typographyFields[i];if(!field)return;
        const resolved=result.value;child.write([field.type.toLowerCase(),result.error||resolved?.type!=='typography'||'value' in resolved?'':String(resolved[field.name]??0),'']);
      });
    } else {
      const holder = document.createElement('div'); holder.className = 'token-scalar-direct';
      const input = document.createElement('input'); input.id = prefix;
      input.setAttribute('aria-label', prefix.startsWith('token-') ? label + ' — значение токена' : label); input.autocomplete = 'off';
      const inputs:ControlInput[]=[input];let picker:HTMLInputElement|undefined,preset:HTMLSelectElement|undefined;
      if (type === 'Color') {
        picker = document.createElement('input'); picker.type = 'color';
        picker.setAttribute('aria-label', 'Выбрать цвет ' + label);
        picker.addEventListener('input', () => {
          input.value = (picker?.value??'#000000') + (/^#[0-9a-f]{8}$/i.test(input.value) ? input.value.slice(7) : 'FF');
        });
        input.placeholder = '#RRGGBBAA'; inputs.push(picker); holder.append(picker);
      }
      if (type === 'FontWeight') {
        preset = document.createElement('select'); preset.setAttribute('aria-label', 'Пресет толщины ' + label);
        for (const [v, text] of [['','Custom'],['400','Normal'],['500','Medium'],['600','Semibold'],['700','Bold']])
          preset.add(new Option(text, v));
        preset.addEventListener('change', () => { if(preset?.value)input.value=preset.value; });
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
        write: value => { input.value=rawText(value);sync(); },
        validate() {
          try { return { value: literalExpression(type, category, input.value.trim()).value }; }
          catch (error) { return { input, error:errorMessage(error) }; }
        },
        writeResolved: result => { direct.write(result.error ? '' : tokenValueText(result.value).replace(/ px$/, '')); }
      };
    }
    const control = createTokenValueControl(prefix, { type, tokenType: type, tokenCategory: category },
      { tokens: tokenIndex() }, expression?.expression === 'alias' ? { type: 'token', tokenId: expression.tokenId } : null,
      direct, label, label, {
        theme, customDirect: true, validateChoices: true,
        getToken: id => tokenItems.find(item => item.id === id),
        getCompatible: () => allowedAliases(type, category, ownerId??null).filter(item => !dependsOn(item.id, ownerId, theme)),
        resolve: id => dependsOn(id, ownerId, theme)
          ? { value:null,error: 'Цикл ссылок дизайн-токенов.' }
          : resolveTokenValue({ type: 'token', tokenId: id }, tokenIndex(), theme, type, category),
        writeResolved: direct.writeResolved
      });
    control.write(control.initial);
    return control;
  }
  function typographyPart(value:TokenValue|null,field:TypographyPart):TokenExpression|null|undefined{
    if(value?.type==='typographyFields')return value[field.name];
    if(value?.type==='typography')return literalExpression(field.type,field.category,String(value[field.name]??(field.name==='letterSpacing'?0:field.initial)));
    return null;
  }
  const asExpression=(value:ResolvableValue|undefined):TokenExpression=>value?.type==='token'?{expression:'alias',tokenId:value.tokenId}:{expression:'literal',value:literalValue(value)};
  function readExpression(control:PropertyControl) {
    const result = control.validate();
    if (result.error) { result.input?.setAttribute('aria-invalid', 'true'); throw new Error(result.error); }
    return asExpression(result.value);
  }
  function replaceThemeControls(hostId:string,previous:PropertyControl[],type:TokenType,category:TokenCategory|null,item:DesignToken|null):PropertyControl[] {
    previous.forEach(control => control.dispose?.());
    const host = el(hostId); host.replaceChildren();
    return themes.map((theme,index) => {
      const prefix = (item ? 'token-' : 'new-token-') + theme.toLowerCase();
      const control = makeTokenControl(prefix, theme, type, category, theme, item?.values?.[theme], item?.id);
      const row = document.createElement('div'); row.className = 'token-theme-row'; row.dataset.theme = theme;
      row.append(...control.content); host.append(row);
      if (item) {
        control.setDisabled?.(!editable());
        row.addEventListener('change', () => {
          if ((busy() && !activeThemeSave) || !editable() || selectedToken !== item.id) return;
          try {
            control.inputs.forEach(input => input.removeAttribute('aria-invalid'));
            const value = readExpression(control);
            el('tokens-error').textContent = '';
            queueThemeSave(item.id, theme, index, value);
          } catch (error) {
            pendingThemeValues.delete(theme);
            el('tokens-error').textContent = errorMessage(error);
          }
        });
        row.addEventListener('keydown', event => {
          if (!event.isComposing && event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.matches('input:not([type=search]):not([type=color])')) {
            event.preventDefault(); event.target.blur();
          }
        });
      }
      return control;
    });
  }
  // Keep the two theme drafts independent. The existing document command pipeline
  // remains serialized, but saving Light must not discard an edit made in Dark.
  function queueThemeSave(tokenId:string,theme:Theme,index:number,value:TokenExpression) {
    const baseline = activeThemeSave?.tokenId === tokenId && activeThemeSave.theme === theme
      ? activeThemeSave.value : selected()?.values?.[theme];
    if (JSON.stringify(value) === JSON.stringify(baseline)) pendingThemeValues.delete(theme);
    else pendingThemeValues.set(theme, { tokenId, theme, index, value, documentId: getContext().documentId });
    void flushThemeSaves();
  }
  async function flushThemeSaves() {
    if (activeThemeSave || busy() || !editable() || !pendingThemeValues.size) return;
    const operation=pendingThemeValues.values().next().value;if(!operation)return;
    pendingThemeValues.delete(operation.theme);
    if (operation.documentId !== getContext().documentId || !tokenItems.some(item => item.id === operation.tokenId)) {
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
    const item=selected();if(!item||!editable()||busy())return;
    renaming=true; el('token-rename').hidden = false; el('token-detail-title').hidden = true;
    el('token-rename-open').hidden = true;
    const field=input('token-name');field.value=item.name;field.focus();field.select();
  }

  function resetTokens() {
    tokenLoad++; importEpoch++; tokenItems = []; tokenUsages = []; selectedToken = null; rendered = false;
    pendingThemeValues.clear(); activeThemeSave = null;
    group = []; collapsed = new Set(); creating = false; usagesReady = false;
    input('token-search').value = ''; selectedTypes = new Set(types); syncTypeFilter();
    models.groups.clear(); form('token-import-form').reset(); syncImportMode(); el('token-import-form').hidden = true; el('token-import-form').inert = false;
    el('new-token-open').hidden = el('token-import-open').hidden = true; for (const id of ['token-export','token-export-light','token-export-dark']) btn(id).disabled = true;
    showEditor(); updateDetailVisibility();
    el('token-create').inert = el('token-detail').inert = false;
    models.table.clear();models.usage.clear();
    el('token-detail').hidden = true; el('token-create').hidden = true;
    el('tokens-error').textContent = ''; el('tokens-status').textContent = '';
    form('token-create').reset(); endRename();
    detailControls.forEach(control => control.dispose?.()); detailControls = []; el('token-values').replaceChildren();
    updateCategoryOptions();
  }
  async function readAllTokenPages<T>(path:string,revision:number,decode:(v:unknown)=>T,signal?:AbortSignal,isCurrent?:()=>boolean):Promise<T[]>{
    const items:T[]=[];let total:number;
    do {
      const result=requiredRecord(await request(`${path}?revision=${revision}&offset=${items.length}&limit=100`,{},signal,isCurrent));
      if (result.revision !== revision || !Array.isArray(result.items) || typeof result.total!=='number'||!Number.isInteger(result.total))
        throw new Error('Некорректный ответ о токенах.');
      items.push(...result.items.map(decode)); total=result.total;
      if (!result.items.length && items.length < total) throw new Error('Неполный ответ о токенах.');
    } while (items.length < total);
    return items;
  }
  async function readTokens(base:string,revision:number,signal:AbortSignal,isCurrent:()=>boolean):Promise<Snapshot> {
    const items = await readAllTokenPages(`${base}/tokens`,revision,readToken,signal,isCurrent);
    const selection = selectedToken;
    const usages = selection && items.some(item => item.id === selection)
      ? await readAllTokenPages(`${base}/tokens/${encodeURIComponent(selection)}/usages`, revision,usage,signal,isCurrent) : [];
    return { items, selection, usages };
  }
  async function readSelectedUsages(base:string,revision:number,signal:AbortSignal,isCurrent:()=>boolean):Promise<UsageSnapshot> {
    const selection = selectedToken;
    const usages = selection ? await readAllTokenPages(`${base}/tokens/${encodeURIComponent(selection)}/usages`,
      revision,usage,signal,isCurrent) : [];
    return { selection, usages };
  }
  function applySelectedUsages({selection,usages}:UsageSnapshot) {
    if (selection !== selectedToken) { if (selectedToken) selectToken(selectedToken); return; }
    if (!usagesReady || JSON.stringify(tokenUsages) !== JSON.stringify(usages)) { usagesReady = true; tokenUsages = usages; renderTokens(true, false); }
  }
  function applyTokens(snapshot:Snapshot) {
    const before = JSON.stringify([tokenItems, tokenUsages, selectedToken]), previousItem = JSON.stringify(selected());
    tokenItems = snapshot.items;
    createControls.forEach(control => control.refresh?.());
    detailControls.forEach(control => control.refresh?.());
    if (selectedToken && selectedToken !== snapshot.selection) { selectToken(selectedToken); return; }
    if (selectedToken && !tokenItems.some(item => item.id === selectedToken)) clearSelection();
    tokenUsages = selectedToken ? snapshot.usages : []; usagesReady = !!selectedToken;
    if (!rendered || before !== JSON.stringify([tokenItems, tokenUsages, selectedToken])) {
      rendered = true;
      renderTokens(true, !activeThemeSave && previousItem !== JSON.stringify(selected()));
    }
  }

  function allowedAliases(type:TokenType,category:TokenCategory|null,excludeId:string|null=null) {
    const t = normalizedTokenType(type), c = normalizedTokenCategory(category);
    return tokenItems.filter(item => item.id !== excludeId && typeOf(item) === t && categoryOf(item) === c);
  }
  function updateCategoryOptions() {
    const type = select('new-token-type').value, choices = allowedCategories[type] ?? [];
    const category = select('new-token-category'), current = category.value;
    category.replaceChildren();
    for (const option of choices) category.add(new Option(option, option));
    if (choices.includes(current)) category.value = current;
    category.hidden = el('new-token-category-label').hidden = !choices.length;
    updateCreateMode();
  }
  function updateCreateMode() {
    createControls = replaceThemeControls('new-token-values', createControls,
      knownType(select('new-token-type').value),normalizedTokenCategory(select('new-token-category').value),null);
  }
  function renderTokens(refreshDetail = true, refreshEditor = true) {
    const search = input('token-search').value;
    const filtered = filteredTokens(tokenItems, search, selectedTypes, typeOf);
    const tree = buildTokenGroups(filtered);
    let active:TokenGroup|undefined=tree;
    for(const segment of group) active=active?.children.get(segment);
    if(!active)group=[];
    const displayed=tokensInGroup(filtered,group);
    if(selectedToken&&!displayed.some(item=>item.id===selectedToken))clearSelection();
    models.groups.publish({tree,group:[...group],collapsed:new Set(collapsed),
      toggle:key=>{if(collapsed.has(key))collapsed.delete(key);else collapsed.add(key);renderTokens(false);},
      select:segments=>{group=segments;renderTokens(false);}});
    models.table.publish({tokenItems,displayed,group:[...group],search,selectedToken,usagesReady,usageCount:tokenUsages.length,
      hasTypes:selectedTypes.size>0,selectToken:id=>{if(!busy())void selectToken(id);},
      selectAlias:id=>{if(busy())return;revealToken(tokenItems.find(item=>item.id===id),true);void selectToken(id);}});
    const index=new Map(tokenItems.map(token=>[token.id,token]));
    const nameDiagnostics=tokenNameDiagnostics(tokenItems);
    const item = selected();
    updateDetailVisibility();
    if (!item || refreshDetail === false) return;
    el('token-detail-type').textContent = [typeOf(item), categoryOf(item)].filter(Boolean).join(' · ');
    el('token-detail-title').textContent = item.name;
    const diagnostics=[nameDiagnostics.get(item.id)].filter((x):x is string=>!!x);
    for(const selectedTheme of themes) {
      const resolved = resolveTokenValue({ type: 'token', tokenId: item.id }, index, selectedTheme, item.type, item.category);
      if (resolved.error) diagnostics.push(selectedTheme + ': ' + resolved.error);
    }
    el('token-detail-diagnostic').textContent = diagnostics.join(' · ');
    el('token-edit').hidden = !editable();
    el('token-rename-open').hidden = !editable() || renaming;
    btn('token-delete').disabled = !usagesReady || tokenUsages.length > 0;
    el('token-delete').title = tokenUsages.length ? 'У токена есть зависимости: ' + tokenUsages.length : 'Удалить токен';
    if (refreshEditor) {
      detailControls = replaceThemeControls('token-values', detailControls, typeOf(item), categoryOf(item), item);
    } else detailControls.forEach(control => control.refresh?.());
    const usageTitle=el('token-usages').previousElementSibling;
    if(usageTitle)usageTitle.textContent='Использования'+(usagesReady?' · '+tokenUsages.length:' · загрузка…');
    models.usage.publish({usages:tokenUsages,ready:usagesReady,name:id=>tokenItems.find(t=>t.id===id)?.name??id,
      selectLayer:id=>{showEditor();selectLayer(id);}});
  }
  function clearSelection() {
    selectedToken = null; tokenLoad++; tokenUsages = []; usagesReady = false;
    // A presentation filter must not discard theme edits already queued for saving.
    endRename();
    detailControls.forEach(control => control.dispose?.()); detailControls = []; el('token-values').replaceChildren();
  }
  function revealToken(item:DesignToken|undefined,navigate=false){
    if(!item)return;
    const hidden = !selectedTypes.has(typeOf(item)) || !matchesTokenSearch(item, input('token-search').value) ||
      !tokensInGroup([item], group).length;
    selectedTypes.add(typeOf(item)); syncTypeFilter();
    if (!matchesTokenSearch(item, input('token-search').value)) input('token-search').value = '';
    if (navigate || hidden) group = tokenSegments(item.name).slice(0,-1);
    const path = tokenSegments(item.name).slice(0,-1);
    for (let i = 0; i <= path.length; i++) collapsed.delete(groupKey(path.slice(0,i)));
  }
  async function selectToken(id:string) {
    endRename();
    pendingThemeValues.clear();
    selectedToken = id; tokenUsages = []; creating = false; usagesReady = false;
    const current = ++tokenLoad, doc = getContext().documentId, revision = getContext().revision;
    renderTokens();
    if(!id||!doc||revision===null||!Number.isSafeInteger(revision))return;
    try {
      const items = await readAllTokenPages(`/api/v1/documents/${encodeURIComponent(doc)}/tokens/${encodeURIComponent(id)}/usages`,revision,usage);
      if (current !== tokenLoad || doc !== getContext().documentId || revision !== getContext().revision) return;
      tokenUsages = items; usagesReady = true; el('tokens-error').textContent = ''; renderTokens(true, false);
    } catch (error) {
      if (current === tokenLoad && doc === getContext().documentId) el('tokens-error').textContent = errorMessage(error);
    }
  }
  async function tokenCommand(command:Command,data:CommandData,selection?:string):Promise<boolean|undefined> {
    const doc=getContext().documentId;if(!doc||!editable()||busy())return;
    stopLive(); const { signal, current } = startRequest();
    el('token-create').inert = el('token-import-form').inert = true;
    el('token-detail').inert = command !== 'set-token-value';
    el('tokens-error').textContent = ''; el('tokens-status').textContent = 'Сохранение…';
    try {
      await request(`/api/v1/documents/${encodeURIComponent(doc)}/commands/${command}`,
        { method: 'POST', body: JSON.stringify({ commandId: crypto.randomUUID(), ...data }) }, signal);
      if (signal.aborted || current !== getContext().generation) return;
      if(selection&&'name' in data&&'type' in data){revealToken({id:selection,name:data.name,type:data.type});selectedToken=selection;creating=false;}
      if (command === 'import-design-tokens') { importEpoch++; el('token-import-form').hidden = true; form('token-import-form').reset(); syncImportMode(); }
      await readPages(signal);
      if (current === getContext().generation) { el('tokens-status').textContent = ''; return true; }
    } catch (error) {
      if(!aborted(error)&&current===getContext().generation){
        const diagnostics=error instanceof ApiError&&Array.isArray(error.diagnostics)?error.diagnostics.filter(record).map(d=>String(d.path??'')+': '+String(d.message??'')).join('; '):'';
        el('tokens-error').textContent=error instanceof TypeError||(error instanceof ApiError&&error.status>=500)?'Результат неизвестен. Обновите документ перед повтором.':diagnostics||(error instanceof ApiError&&error.code==='INVALID_TOKEN'&&error.detail?error.message+' '+error.detail:errorMessage(error));
      }
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
      const type = select('new-token-type').value, category = allowedCategories[type] ? select('new-token-category').value : null;
      const name = qualifyTokenName(input('new-token-name').value.trim(), group);
      const error = tokenNameError(name, tokenItems); if (error) throw new Error(error);
      const id=crypto.randomUUID();const [light,dark]=createControls;if(!light||!dark)throw new Error('Отсутствуют значения тем.');
      const values:Record<Theme,TokenExpression>={Light:readExpression(light),Dark:readExpression(dark)};
      tokenCommand('add-token', { tokenId: id, name, type: typeIndex(type),
        category: categoryIndex(category), values }, id);
    } catch (error) { el('tokens-error').textContent = errorMessage(error); }
  });
  el('token-delete').addEventListener('click', () => {
    const revision=getContext().revision;if(!selectedToken||!usagesReady||tokenUsages.length||revision===null)return;
    tokenCommand('delete-token',{tokenId:selectedToken,expectedRevision:revision});
  });
  el('token-rename-open').addEventListener('click', beginRename);
  el('token-rename-cancel').addEventListener('click', endRename);
  el('token-name').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); endRename(); }
  });
  el('token-rename').addEventListener('submit', async event => {
    event.preventDefault();
    const item=selected();if(!item||!editable()||busy())return;
    const name=input('token-name').value.trim();
    if (name === item.name) { endRename(); return; }
    const error = tokenNameError(name, tokenItems, item.id);
    if (error) { el('tokens-error').textContent = error; return; }
    if (await tokenCommand('rename-token', { tokenId: item.id, name }) && selectedToken === item.id) endRename();
  });
  updateCategoryOptions();
  return { reset: resetTokens, read: readTokens, apply: applyTokens,
    readSelectedUsages, applySelectedUsages, refreshAccess, get items() { return tokenItems; } };
}
