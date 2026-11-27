import { useEffect, useLayoutEffect, useRef } from 'react';
import { Ellipsis, ChevronDown, ChevronRight, CornerDownRight, Pencil, Check, X } from 'lucide-react';
import type { ReactElement, ComponentType } from 'react';
import { createViewModel } from '../../app/view-model';
import { Button } from '../../ui/Button';
import { TextInput } from '../../ui/Inputs';
import { ResourceUsages } from '../../ui/ResourceUsages';
import type { DesignToken, TokenType, Theme } from '../../core/tokens/token-model';
import type { TokenGroup } from '../../core/tokens/token-groups';
import { tokenNameDiagnostics, shortTokenName } from '../../core/tokens/token-groups';
import { resolveTokenValue, tokenValueText } from '../../core/tokens/token-resolution';
import type { ValueField } from '../../ui/property-value';
import { FieldValue } from '../../ui/property-value-editor';
import { types, themes, groupKey, typeOf, categoryOf, typographyFields } from './token-values';
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
export type ImportKey='combined'|'light'|'dark';
export type ImportValues=Record<ImportKey|'mapping',string>;
interface TokenPanelProps {
  error:string;status:string;editable:boolean;busy:boolean;detailBusy:boolean;retryVisible:boolean;retry():void;importOpen:boolean;importMode:'combined'|'pair';importValues:ImportValues;importReset:number;
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
      <Button hidden={!p.retryVisible} onClick={p.retry}>Повторить операцию</Button>
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

