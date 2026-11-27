import { useEffect, useLayoutEffect, useRef } from 'react';
import { Ellipsis, ChevronDown, ChevronRight, CornerDownRight, Pencil, Check, X } from 'lucide-react';
import type { ReactElement, ComponentType } from 'react';
import { createViewModel } from '../../app/view-model';
import { Button } from '../../ui/Button';
import { TextInput } from '../../ui/Inputs';
import { postDocumentCommand } from '../../api/document-commands';
import { ResourceUsages } from '../../ui/ResourceUsages';
import type { ApiClient } from '../../api/api-client';
import { ApiError } from '../../api/api-client';
import { requiredRecord, record, array, text, errorMessage, aborted } from '../../api/decode';
import { token as readToken } from '../../canvas/render-model';
import type { DesignToken, TokenType, TokenCategory, Theme, TokenValue, TokenExpression, TypographyFieldsValue, TypographyField, ResolvableValue } from '../../core/tokens/token-model';
import { tokenTypes, tokenCategories } from '../../core/tokens/token-model';
import type { TokenGroup } from '../../core/tokens/token-groups';
import { createShadowSpec,createReferenceSpec,createValueField,type ValueSpec,type ValueField,type EditKind,type CompositeSpec } from '../../ui/property-value';
import { FieldValue } from '../../ui/property-value-editor';
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
interface Options {models:ReturnType<typeof createTokenModels>;selectLayer(id:string):void;showEditor():void;request:ApiClient;getContext():Context;startRequest():{signal:AbortSignal;current:number};stopLive():void;startLive():void;readPages(signal:AbortSignal):Promise<unknown>}
interface Usage {label?:string;kind:string;property?:string|null;theme?:number|string|null;indirect:boolean;ownerId:string;chain:string[]}
interface UsageSnapshot {selection:string|null;usages:Usage[]}
interface Snapshot extends UsageSnapshot {items:DesignToken[]}
interface ThemeSave {tokenId:string;theme:Theme;index:number;value:TokenExpression;documentId:string|null}
interface TypographyPart {name:TypographyField;label:string;type:TokenType;category:TokenCategory|null;initial:string}
function usage(value:unknown):Usage{const v=requiredRecord(value);return{kind:text(v.kind),ownerId:text(v.ownerId),label:v.label==null?undefined:text(v.label),property:v.property==null?null:text(v.property),theme:v.theme==null?null:typeof v.theme==='number'?v.theme:text(v.theme),indirect:v.indirect===true,chain:array(v.chain??[],text)};}
function knownType(value:unknown):TokenType{const type=normalizedTokenType(value);if(!type)throw new TypeError('Неизвестный тип токена');return type;}
function literalValue(value:ResolvableValue|undefined):TokenValue{
  if(!value)throw new Error('Заполните значение токена.');
  switch(value.type){case 'color':case 'shadow':case 'geometry':case 'spacing':case 'dimension':case 'fontFamily':case 'fontWeight':case 'number':case 'typographyFields':return value;case 'typography':if(!('value' in value))return value;}
  throw new TypeError('Некорректное значение токена.');
}
import { splitTokenBundle } from '../../core/tokens/token-exchange';
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
            aria-expanded={expanded} onClick={()=>toggle(key)}>{expanded?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</Button> : <span aria-hidden="true"/>}
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
          {alias?<><Button className="token-alias-link" aria-label={'↳ '+nameOf(expression.tokenId)} title={value} disabled={!index.has(expression.tokenId)} onClick={()=>{
            selectAlias(expression.tokenId);
          }}><CornerDownRight size={12} aria-hidden="true"/>{nameOf(expression.tokenId)}</Button>{' · '+value}</>:value}
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
interface TokenMenuProps {
  editable:boolean; selectedTypes:ReadonlySet<TokenType>;toggleAll():void;toggleType(type:TokenType,checked:boolean):void;
  create():void;importTokens():void;exportTokens(theme?:Theme):void;
}
function TokenMenu({editable,selectedTypes,toggleAll,toggleType,create,importTokens,exportTokens}:TokenMenuProps){
  const menu=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),all=useRef<HTMLInputElement>(null);
  const allSelected=selectedTypes.size===types.length;
  useLayoutEffect(()=>{if(all.current)all.current.indeterminate=selectedTypes.size>0&&!allSelected;},[selectedTypes,allSelected]);
  function position(){
    const popover=menu.current,button=trigger.current;
    if(!popover?.matches(':popover-open')||!button)return;
    const rect=button.getBoundingClientRect(),margin=8;
    popover.style.left=Math.max(margin,Math.min(rect.right-popover.offsetWidth,window.innerWidth-popover.offsetWidth-margin))+'px';
    const below=window.innerHeight-rect.bottom-margin,above=rect.top-margin;
    const openAbove=below<popover.scrollHeight&&above>below;
    popover.style.maxHeight=Math.max(0,openAbove?above:below)+'px';
    popover.style.top=(openAbove?rect.top-popover.offsetHeight:rect.bottom)+'px';
  }
  useEffect(()=>{window.addEventListener('resize',position);return()=>window.removeEventListener('resize',position);},[]);
  function run(action:()=>void){if(menu.current?.matches(':popover-open'))menu.current.hidePopover();trigger.current?.focus();action();}
  return <>
    <button ref={trigger} id="token-menu-open" type="button" className="token-menu-button" data-filtered={String(!allSelected)}
      aria-label={allSelected?'Управление токенами':'Управление токенами (активен фильтр)'} popoverTarget="token-menu"><Ellipsis size={16} aria-hidden="true"/></button>
    <div ref={menu} className="token-menu" id="token-menu" popover="auto" role="group" aria-label="Управление токенами" onToggle={position}>
      <Button id="new-token-open" hidden={!editable} onClick={()=>run(create)}>+ Новый токен…</Button><hr/>
      <Button id="token-import-open" hidden={!editable} onClick={()=>run(importTokens)}>Импорт токенов…</Button>
      <Button id="token-export" disabled={!editable} onClick={()=>run(()=>exportTokens())}>Экспорт токенов…</Button>
      <Button id="token-export-light" disabled={!editable} onClick={()=>run(()=>exportTokens('Light'))}>Экспорт Light</Button>
      <Button id="token-export-dark" disabled={!editable} onClick={()=>run(()=>exportTokens('Dark'))}>Экспорт Dark</Button><hr/>
      <div id="token-type-filter" className="token-type-filter" role="group" aria-label="Отображаемые типы">
        <div className="token-filter-heading" aria-hidden="true">Отображаемые типы</div>
        <label><input ref={all} type="checkbox" value="" checked={allSelected} onChange={toggleAll}/>Все типы</label>
        {types.map(type=><label key={type}><input type="checkbox" value={type} checked={selectedTypes.has(type)} onChange={event=>toggleType(type,event.currentTarget.checked)}/>{type}</label>)}
      </div>
    </div>
  </>;
}

function ThemeFields({fields}:{fields:ValueField[]}){
  return <>{fields.map((field,index)=><div className="token-theme-row" key={field.id} data-theme={themes[index]} onKeyDown={event=>{if(!event.nativeEvent.isComposing&&event.key==='Enter'&&event.target instanceof HTMLInputElement&&event.target.matches('input:not([type=search]):not([type=color])')){event.preventDefault();event.target.blur();}}}><FieldValue field={field}/></div>)}</>;
}
type ImportKey='combined'|'light'|'dark';
type ImportValues=Record<ImportKey|'mapping',string>;
interface TokenPanelProps {
  error:string;status:string;editable:boolean;busy:boolean;detailBusy:boolean;importOpen:boolean;importMode:'combined'|'pair';importValues:ImportValues;importReset:number;
  search:string;creating:boolean;selected:boolean;placeholder:string;newName:string;newType:string;newCategory:string;categoryOptions:readonly string[];
  title:string;type:string;diagnostic:string;renaming:boolean;renameName:string;usagesReady:boolean;usageCount:number;
  Menu:ComponentType;Groups:ComponentType;Table:ComponentType;CreateFields:ComponentType;DetailFields:ComponentType;Usage:ComponentType;
  changeSearch(value:string):void;changeImport(key:keyof ImportValues,value:string):void;setImportMode(mode:'combined'|'pair'):void;loadImportFile(key:ImportKey,file:File|null):void;
  submitImport():void;closeImport():void;changeNewName(value:string):void;changeType(type:string):void;changeCategory(category:string):void;create():void;cancelCreate():void;
  beginRename():void;cancelRename():void;changeRenameName(name:string):void;rename():void;remove():void;
}
function TokenPanel(p:TokenPanelProps){
  const createName=useRef<HTMLInputElement>(null),renameName=useRef<HTMLInputElement>(null);
  useLayoutEffect(()=>{if(p.creating)createName.current?.focus();},[p.creating]);
  useLayoutEffect(()=>{if(p.renaming){renameName.current?.focus();renameName.current?.select();}},[p.renaming]);
  return <>
      <p id="tokens-status" role="status" aria-live="polite">{p.status}</p>
      <p id="tokens-error" role="alert">{p.error}</p>
      <form id="token-import-form" className="token-import-form" hidden={!p.importOpen} inert={p.busy} onSubmit={event=>{event.preventDefault();p.submitImport();}}>
        <label>
          {"Формат импорта"}
          <select id="token-import-mode" value={p.importMode} onChange={event=>p.setImportMode(event.currentTarget.value==='pair'?'pair':'combined')}>
            <option value="combined">{"FigVam — обе темы"}</option>
            <option value="pair">{"Два файла DTCG"}</option>
          </select>
        </label>
        <label id="token-import-combined-label" hidden={p.importMode!=='combined'}>
          {"FigVam JSON"}
          <textarea id="token-import-combined" rows={4} required={p.importMode==='combined'} value={p.importValues.combined} onChange={event=>p.changeImport('combined',event.currentTarget.value)}/>
          <input type="file" accept=".json,application/json" key={p.importReset} id="token-import-combined-file" onChange={event=>p.loadImportFile('combined',event.currentTarget.files?.[0]??null)} aria-label="Файл токенов FigVam"/>
        </label>
        <label id="token-import-light-label" hidden={p.importMode==='combined'}>
          {"DTCG JSON · Light"}
          <textarea id="token-import-light" rows={4} required={p.importMode!=='combined'} value={p.importValues.light} onChange={event=>p.changeImport('light',event.currentTarget.value)}/>
          <input type="file" accept=".json,application/json" key={p.importReset} id="token-import-light-file" onChange={event=>p.loadImportFile('light',event.currentTarget.files?.[0]??null)} aria-label="Файл токенов Light"/>
        </label>
        <label id="token-import-dark-label" hidden={p.importMode==='combined'}>
          {"DTCG JSON · Dark"}
          <textarea id="token-import-dark" rows={4} required={p.importMode!=='combined'} value={p.importValues.dark} onChange={event=>p.changeImport('dark',event.currentTarget.value)}/>
          <input type="file" accept=".json,application/json" key={p.importReset} id="token-import-dark-file" onChange={event=>p.loadImportFile('dark',event.currentTarget.files?.[0]??null)} aria-label="Файл токенов Dark"/>
        </label>
        <label>
          {"Сопоставление типов/категорий (JSON, необязательно)"}
          <textarea id="token-import-mapping" rows={3} value={p.importValues.mapping} onChange={event=>p.changeImport('mapping',event.currentTarget.value)} placeholder={'{"dimensionTypes":{"space":"Spacing"}}'}/>
        </label>
        <Button type="submit">{"Импортировать токены"}</Button>
        <Button type="button" onClick={p.closeImport}>{"Отмена"}</Button>
      </form>
      <div className="token-workspace-grid">
        <div className="token-sidebar">
          <div className="token-tree-toolbar">
            <TextInput id="token-search" value={p.search} onChange={event=>p.changeSearch(event.currentTarget.value)} type="search" placeholder="Поиск токенов" aria-label="Поиск токенов"/>
            <p.Menu/>
          </div>
          <nav id="token-groups" className="token-groups" aria-label="Группы токенов"><p.Groups/></nav>
        </div>
        <div className="token-table-area">
          <table className="token-table" aria-label="Токены документа">
            <thead>
              <tr>
                <th scope="col">{"Имя"}</th>
                <th scope="col">{"Тип"}</th>
                <th scope="col">{"Light"}</th>
                <th scope="col">{"Dark"}</th>
                <th scope="col">{"Источник"}</th>
                <th scope="col">{"Usages"}</th>
                <th scope="col">{"Статус"}</th>
              </tr>
            </thead>
            <tbody id="tokens-list"><p.Table/></tbody>
          </table>
        </div>
        <aside className="token-details-area">
          <p id="token-placeholder" className="token-placeholder" hidden={p.creating||p.selected}>{"Выберите токен или создайте новый."}</p>
          <form id="token-create" hidden={!p.creating||!p.editable} inert={p.busy} onSubmit={event=>{event.preventDefault();p.create();}}>
            <h3>{"Новый токен"}</h3>
            <label htmlFor="new-token-name">{"Имя токена"}</label>
            <TextInput id="new-token-name" ref={createName} required maxLength={256} placeholder={p.placeholder} value={p.newName} onChange={event=>p.changeNewName(event.currentTarget.value)}/>
            <label htmlFor="new-token-type">{"Тип токена"}</label>
            <select id="new-token-type" value={p.newType} onChange={event=>p.changeType(event.currentTarget.value)}>
              <option value="Color">{"Color"}</option>
              <option value="Typography">{"Typography"}</option>
              <option value="Dimension">{"Dimension"}</option>
              <option value="Number">{"Number"}</option>
              <option value="FontFamily">{"FontFamily"}</option>
              <option value="FontWeight">{"FontWeight"}</option>
              <option value="Shadow">{"Shadow"}</option>
              <option value="Spacing">{"Spacing (legacy)"}</option>
              <option value="Geometry">{"Geometry (legacy)"}</option>
            </select>
            <label id="new-token-category-label" htmlFor="new-token-category" hidden={!p.categoryOptions.length}>{"Назначение"}</label>
            <select id="new-token-category" hidden={!p.categoryOptions.length} value={p.newCategory} onChange={event=>p.changeCategory(event.currentTarget.value)}>{p.categoryOptions.map(option=><option key={option}>{option}</option>)}</select>
            <div id="new-token-values" className="token-theme-values"><p.CreateFields/></div>
            <Button type="submit">{"Создать токен"}</Button>
            <Button id="new-token-cancel" type="button" onClick={p.cancelCreate}>{"Отмена"}</Button>
          </form>
          <div id="token-detail" hidden={p.creating||!p.selected} inert={p.detailBusy}>
            <div className="token-name-header">
              <h3 id="token-detail-title" hidden={p.renaming}>{p.title}</h3>
              <Button id="token-rename-open" hidden={!p.editable||p.renaming} onClick={p.beginRename} className="token-rename-action" type="button" aria-label="Переименовать токен" title="Переименовать токен"><Pencil size={14} strokeWidth={1.8} aria-hidden="true"/></Button>
              <form id="token-rename" hidden={!p.renaming} onSubmit={event=>{event.preventDefault();p.rename();}}>
                <TextInput id="token-name" ref={renameName} aria-label="Новое имя токена" required maxLength={256} value={p.renameName} onChange={event=>p.changeRenameName(event.currentTarget.value)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();p.cancelRename();}}}/>
                <Button type="submit" className="token-rename-confirm" aria-label="Сохранить имя токена" title="Сохранить имя"><Check size={14} strokeWidth={1.8} aria-hidden="true"/></Button>
                <Button type="button" id="token-rename-cancel" onClick={p.cancelRename} aria-label="Отменить переименование" title="Отмена"><X size={14} strokeWidth={1.8} aria-hidden="true"/></Button>
              </form>
            </div>
            <p id="token-detail-type">{p.type}</p>
            <p className="token-invalid" id="token-detail-diagnostic" role="status">{p.diagnostic}</p>
            <div id="token-values" className="token-theme-values"><p.DetailFields/></div>
            <div id="token-edit" hidden={!p.editable}>
              <Button id="token-delete" type="button" disabled={!p.usagesReady||p.usageCount>0} title={p.usageCount?'У токена есть зависимости: '+p.usageCount:'Удалить токен'} onClick={p.remove}>{"Удалить неиспользуемый токен"}</Button>
            </div>
            <h4>{"Использования"+(p.usagesReady?' · '+p.usageCount:' · загрузка…')}</h4>
            <ul id="token-usages" aria-label="Прямые и косвенные использования токена"><p.Usage/></ul>
          </div>
        </aside>
      </div>

  </>;
}
export function createTokenModels(){return {panel:createViewModel(TokenPanel),menu:createViewModel(TokenMenu),groups:createViewModel(TokenGroups),table:createViewModel(TokenTable),usage:createViewModel(ResourceUsages),createFields:createViewModel(ThemeFields),detailFields:createViewModel(ThemeFields)};}

export function createTokens({ models, selectLayer, showEditor, request, getContext, startRequest, stopLive, startLive, readPages }:Options) {
  let tokenItems:DesignToken[]=[],selectedToken:string|null=null,tokenUsages:Usage[]=[],tokenLoad=0,rendered=false;
  const editable=()=>['Owner','Editor'].includes(getContext().documentRole??'');
  let group:string[]=[],collapsed=new Set<string>(), creating = false, usagesReady = false;
  let importEpoch = 0;
  let selectedTypes=new Set<TokenType>(types);
  let createControls:ValueField[]=[],detailControls:ValueField[]=[],renaming=false;
  const pendingThemeValues=new Map<Theme,ThemeSave>();
  let activeThemeSave:ThemeSave|null=null;
  let commandBusy=false,detailBusy=false,importOpen=false,importMode:'combined'|'pair'='combined';
  const emptyImport=():ImportValues=>({combined:'',light:'',dark:'',mapping:''});
  let importValues=emptyImport(),importReset=0,search='',newName='',newType='Color',newCategory='',renameName='',status='',error='',diagnostic='';
  const selected = () => tokenItems.find(t => t.id === selectedToken);
  const busy = () => commandBusy;
  function publishPanel(){
    const item=selected();
    models.panel.publish({error,status,editable:editable(),busy:commandBusy,detailBusy,importOpen,importMode,importValues:{...importValues},importReset,
      search,creating,selected:!!item,placeholder:group.length?group.join('.')+'.…':'Имя токена',newName,newType,newCategory,categoryOptions:allowedCategories[newType]??[],
      title:item?.name??'',type:item?[typeOf(item),categoryOf(item)].filter(Boolean).join(' · '):'',diagnostic,renaming,renameName,usagesReady,usageCount:tokenUsages.length,
      Menu:models.menu.Component,Groups:models.groups.Component,Table:models.table.Component,CreateFields:models.createFields.Component,DetailFields:models.detailFields.Component,Usage:models.usage.Component,
      changeSearch:value=>{search=value;group=[];renderTokens(false);},changeImport:(key,value)=>{importValues[key]=value;publishPanel();},
      setImportMode:mode=>{importMode=mode;publishPanel();},loadImportFile:(key,file)=>{void loadImportFile(key,file);},
      submitImport,closeImport:()=>{importOpen=false;publishPanel();},changeNewName:value=>{newName=value;publishPanel();},
      changeType:type=>{newType=type;updateCategoryOptions();},changeCategory:category=>{newCategory=category;updateCreateMode();publishPanel();},
      create:createToken,cancelCreate:()=>{creating=false;publishPanel();},beginRename,cancelRename:endRename,changeRenameName:name=>{renameName=name;publishPanel();},rename:()=>{void renameToken();},remove:deleteToken});
  }
  function setError(value:string){error=value;publishPanel();}
  function resetImport(){importMode='combined';importValues=emptyImport();importReset++;importOpen=false;}
  function clearBusy(){commandBusy=false;detailBusy=false;publishPanel();}
  function refreshAccess() {
    syncTypeFilter();
    if (!editable()) { creating=false;pendingThemeValues.clear();importOpen=false;endRename(); }
    detailControls.forEach(control => control.setDisabled?.(!editable()));
    publishPanel();
  }
  function updateDetailVisibility(){publishPanel();}
  function beginCreate() {
    if (!editable() || busy()) return;
    creating = true;newType='Color';newCategory='';newName=group.length?group.join('.')+'.':'';
    endRename();updateCategoryOptions();publishPanel();
  }
  function syncTypeFilter(writable=editable()){
    models.menu.publish({editable:writable,selectedTypes:new Set(selectedTypes),create:beginCreate,importTokens:toggleImport,exportTokens:theme=>void exportTokens(theme),
      toggleAll:()=>{selectedTypes=selectedTypes.size===types.length?new Set():new Set(types);syncTypeFilter();renderTokens(false);},
      toggleType:(type,checked)=>{if(checked)selectedTypes.add(type);else selectedTypes.delete(type);syncTypeFilter();renderTokens(false);}});
  }
  syncTypeFilter();
  function toggleImport(){if(editable()&&!busy()){importOpen=!importOpen;publishPanel();}}
  const fileLoads:Record<ImportKey,number>={combined:0,light:0,dark:0};
  async function loadImportFile(theme:ImportKey,file:File|null){
    const documentId=getContext().documentId,epoch=importEpoch,load=++fileLoads[theme];
    if(!file)return;
    const current=()=>epoch===importEpoch&&load===fileLoads[theme]&&documentId===getContext().documentId;
    try{
      if(file.size>(theme==='combined'?2*1024*1024+4096:1024*1024))throw new Error('Файл токенов слишком большой.');
      const value=await file.text();
      if(current()){importValues[theme]=value;publishPanel();}
    }catch(failure){if(current())setError(errorMessage(failure));}
  }
  function submitImport(){
    try {
      let lightJson:string,darkJson:string;
      if (importMode === 'combined') {
        ({ lightJson, darkJson } = splitTokenBundle(importValues.combined));
      } else {
        lightJson = importValues.light; darkJson = importValues.dark;
        JSON.parse(lightJson); JSON.parse(darkJson);
      }
      const mapping=requiredRecord(JSON.parse(importValues.mapping||'{}'));
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
    } catch (error) { setError(errorMessage(error)); }
  }
  async function exportTokens(theme?:Theme) {
    const { documentId, revision, navigationEpoch } = getContext();
    const active = () => documentId === getContext().documentId && navigationEpoch === getContext().navigationEpoch;
    if (!editable() || !documentId || !Number.isSafeInteger(revision)) return;
    setError('');
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
    } catch (error) { if (active()) setError(errorMessage(error)); }
  }
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
  function makeTokenSpec(prefix:string,label:string,type:TokenType,category:TokenCategory|null,theme:Theme,expression?:TokenExpression|null,ownerId?:string,initialText=''):ValueSpec {
    const literal=expression?.expression==='literal'?expression.value:null;
    let direct:ValueSpec;
    if(type==='Shadow')direct=createShadowSpec(literal?.type==='shadow'?literal:null);
    else if(type==='Typography'){
      const children=typographyFields.map(field=>makeTokenSpec(prefix+'-'+field.name+'-value',field.label,field.type,field.category,theme,typographyPart(literal,field),ownerId,field.initial));
      const composite:CompositeSpec={
        kind:'composite',label,id:prefix+'-typography',children,count:children.reduce((n,child)=>n+child.count,0),
        initial:children.map(child=>child.initial),
        validate(raw){
          const values=rawArray(raw),value:TypographyFieldsValue={type:'typographyFields'};
          let offset=0;
          for(const [i,child] of children.entries()){
            const result=child.validate(values[i]??null),field=typographyFields[i];
            if(!field)throw new Error('Missing typography field');
            if(result.error)return {...result,index:offset+(result.index??0)};
            value[field.name]=asExpression(result.value);offset+=child.count;
          }
          return {value};
        },
        resolvedRaw(result){
          return typographyFields.map(field=>[field.type.toLowerCase(),result.error||result.value?.type!=='typography'||'value' in result.value?'':String(result.value[field.name]??0),'']);
        }
      };
      direct=composite;
    }else{
      direct={kind:'token-scalar',label,inputId:prefix,color:type==='Color',weight:type==='FontWeight',count:type==='Color'||type==='FontWeight'?2:1,
        initial:literal?directText(expression):initialText,
        validate(raw){try{return{value:literalExpression(type,category,rawText(raw).trim()).value};}catch(error){return{index:0,error:errorMessage(error)};}},
        resolvedRaw:result=>result.error?'':tokenValueText(result.value).replace(/ px$/,'')};
    }
    return createReferenceSpec({type,tokenType:type,tokenCategory:category},{tokens:tokenIndex()},
      expression?.expression==='alias'?{type:'token',tokenId:expression.tokenId}:null,direct,label,label,{
        theme,customDirect:true,validateChoices:true,getToken:id=>tokenItems.find(item=>item.id===id),
        getCompatible:()=>allowedAliases(type,category,ownerId??null).filter(item=>!dependsOn(item.id,ownerId,theme)),
        resolve:id=>dependsOn(id,ownerId,theme)?{value:null,error:'Цикл ссылок дизайн-токенов.'}:
          resolveTokenValue({type:'token',tokenId:id},tokenIndex(),theme,type,category)
      });
  }
  function typographyPart(value:TokenValue|null,field:TypographyPart):TokenExpression|null|undefined{
    if(value?.type==='typographyFields')return value[field.name];
    if(value?.type==='typography')return literalExpression(field.type,field.category,String(value[field.name]??(field.name==='letterSpacing'?0:field.initial)));
    return null;
  }
  const asExpression=(value:ResolvableValue|undefined):TokenExpression=>value?.type==='token'?{expression:'alias',tokenId:value.tokenId}:{expression:'literal',value:literalValue(value)};
  function readExpression(control:ValueField) {
    const result=control.validate();
    if(result.error)throw new Error(result.error);
    return asExpression(result.value);
  }
  function replaceThemeControls(hostId:string,_previous:ValueField[],type:TokenType,category:TokenCategory|null,item:DesignToken|null):ValueField[] {
    const fields=themes.map((theme,index)=>{
      const prefix=(item?'token-':'new-token-')+theme.toLowerCase();
      const spec=makeTokenSpec(prefix,theme,type,category,theme,item?.values?.[theme],item?.id);
      let field:ValueField;
      function onEdit(kind:EditKind){
        if(!item||kind==='input'||kind==='color-preview'||(busy()&&!activeThemeSave)||!editable()||selectedToken!==item.id)return;
        try{const value=readExpression(field);setError('');queueThemeSave(item.id,theme,index,value);}
        catch(error){pendingThemeValues.delete(theme);setError(errorMessage(error));}
      }
      field=createValueField(spec,prefix,{onEdit,disabled:!!item&&!editable()});
      return field;
    });
    const view=hostId==='new-token-values'?models.createFields:models.detailFields;
    view.publish({fields});
    return fields;
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
  function endRename(){renaming=false;publishPanel();}
  function beginRename(){const item=selected();if(!item||!editable()||busy())return;renaming=true;renameName=item.name;publishPanel();}
  function resetTokens() {
    tokenLoad++;importEpoch++;tokenItems=[];tokenUsages=[];selectedToken=null;rendered=false;
    pendingThemeValues.clear();activeThemeSave=null;group=[];collapsed=new Set();creating=false;usagesReady=false;
    search='';selectedTypes=new Set(types);models.groups.clear();resetImport();syncTypeFilter(false);
    showEditor();commandBusy=false;detailBusy=false;models.table.clear();models.usage.clear();error='';status='';diagnostic='';
    newType='Color';newCategory='';newName='';renaming=false;renameName='';detailControls=[];models.detailFields.clear();
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
  function updateCategoryOptions(){
    const choices=allowedCategories[newType]??[];
    if(!choices.includes(newCategory))newCategory=choices[0]??'';
    updateCreateMode();publishPanel();
  }
  function updateCreateMode(){
    createControls=replaceThemeControls('new-token-values',createControls,knownType(newType),normalizedTokenCategory(newCategory),null);
  }
  function renderTokens(refreshDetail = true, refreshEditor = true) {
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
    const diagnostics=[nameDiagnostics.get(item.id)].filter((x):x is string=>!!x);
    for(const selectedTheme of themes) {
      const resolved = resolveTokenValue({ type: 'token', tokenId: item.id }, index, selectedTheme, item.type, item.category);
      if (resolved.error) diagnostics.push(selectedTheme + ': ' + resolved.error);
    }
    diagnostic=diagnostics.join(' · ');publishPanel();
    if (refreshEditor) {
      detailControls = replaceThemeControls('token-values', detailControls, typeOf(item), categoryOf(item), item);
    } else detailControls.forEach(control => control.refresh?.());
    models.usage.publish({usages:tokenUsages,ready:usagesReady,name:id=>tokenItems.find(t=>t.id===id)?.name??id,
      selectLayer:id=>{showEditor();selectLayer(id);}});
  }
  function clearSelection() {
    selectedToken = null; tokenLoad++; tokenUsages = []; usagesReady = false;
    // A presentation filter must not discard theme edits already queued for saving.
    endRename();
    detailControls=[];models.detailFields.clear();
  }
  function revealToken(item:DesignToken|undefined,navigate=false){
    if(!item)return;
    const hidden = !selectedTypes.has(typeOf(item)) || !matchesTokenSearch(item, search) ||
      !tokensInGroup([item], group).length;
    selectedTypes.add(typeOf(item)); syncTypeFilter();
    if (!matchesTokenSearch(item, search)) search = '';
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
      tokenUsages = items; usagesReady = true; setError(''); renderTokens(true, false);
    } catch (error) {
      if (current === tokenLoad && doc === getContext().documentId) setError(errorMessage(error));
    }
  }
  async function tokenCommand(command:Command,data:CommandData,selection?:string):Promise<boolean|undefined> {
    const doc=getContext().documentId;if(!doc||!editable()||busy())return;
    stopLive(); const { signal, current } = startRequest();
    commandBusy=true;detailBusy=command!=='set-token-value';error='';status='Сохранение…';publishPanel();
    try {
      await postDocumentCommand(request,doc,command,{commandId:crypto.randomUUID(),...data},signal);
      if (signal.aborted || current !== getContext().generation) return;
      if(selection&&'name' in data&&'type' in data){revealToken({id:selection,name:data.name,type:data.type});selectedToken=selection;creating=false;}
      if(command==='import-design-tokens'){importEpoch++;resetImport();publishPanel();}
      await readPages(signal);
      if (current === getContext().generation) { status='';publishPanel();return true; }
    } catch (error) {
      if(!aborted(error)&&current===getContext().generation){
        const diagnostics=error instanceof ApiError&&Array.isArray(error.diagnostics)?error.diagnostics.filter(record).map(d=>String(d.path??'')+': '+String(d.message??'')).join('; '):'';
        setError(error instanceof TypeError||(error instanceof ApiError&&error.status>=500)?'Результат неизвестен. Обновите документ перед повтором.':diagnostics||(error instanceof ApiError&&error.code==='INVALID_TOKEN'&&error.detail?error.message+' '+error.detail:errorMessage(error)));
      }
    } finally {
      if (current === getContext().generation) {
        status='';clearBusy();startLive();
      }
    }
  }

  function createToken(){
    try {
      const type=newType,category=allowedCategories[type]?newCategory:null;
      const name = qualifyTokenName(newName.trim(), group);
      const error = tokenNameError(name, tokenItems); if (error) throw new Error(error);
      const id=crypto.randomUUID();const [light,dark]=createControls;if(!light||!dark)throw new Error('Отсутствуют значения тем.');
      const values:Record<Theme,TokenExpression>={Light:readExpression(light),Dark:readExpression(dark)};
      tokenCommand('add-token', { tokenId: id, name, type: typeIndex(type),
        category: categoryIndex(category), values }, id);
    } catch (error) { setError(errorMessage(error)); }
  }
  function deleteToken(){
    const revision=getContext().revision;if(!selectedToken||!usagesReady||tokenUsages.length||revision===null)return;
    tokenCommand('delete-token',{tokenId:selectedToken,expectedRevision:revision});
  }
  async function renameToken(){
    const item=selected();if(!item||!editable()||busy())return;
    const name=renameName.trim();
    if (name === item.name) { endRename(); return; }
    const error = tokenNameError(name, tokenItems, item.id);
    if (error) { setError(error); return; }
    if (await tokenCommand('rename-token', { tokenId: item.id, name }) && selectedToken === item.id) endRename();
  }
  updateCategoryOptions();
  return { reset: resetTokens, read: readTokens, apply: applyTokens,
    readSelectedUsages, applySelectedUsages, refreshAccess, clearBusy, get items() { return tokenItems; } };
}
