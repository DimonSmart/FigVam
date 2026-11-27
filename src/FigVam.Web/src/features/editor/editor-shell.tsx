import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Ellipsis, PanelLeft, PanelRight, Redo2, Undo2 } from 'lucide-react';
import { createPanelStore } from '../../app/panel-store';
import type { ApplicationViews } from '../../app/application-views';
import { DrawingTools, type DrawingToolKind } from './drawing-tools';
import { Button } from '../../ui/Button';

interface ShellActions {
  beforePrototypeLeave(resume:()=>void):boolean;
  addTool(kind:DrawingToolKind):boolean;
  signOut():void;
  createPage():void;
}
export function createEditorShell(actions:ShellActions) {
  const drawingTools=createPanelStore<readonly string[]>([]);
  const signoutLabel=createPanelStore('Выйти');
  const mode=createPanelStore(false);
  return {...actions, drawingTools, signoutLabel, mode, showEditor:()=>mode.publish(false),
    setSignoutLabel(label:string){signoutLabel.publish(label);},
    setDrawingTools(available:readonly string[]){
      const current=drawingTools.getSnapshot();
      if(current.length!==available.length||current.some((kind,index)=>kind!==available[index]))drawingTools.publish(available);
    }
  };
}
export type EditorShellController=ReturnType<typeof createEditorShell>;
const leftTabs=[['layers','Слои'],['components','Компоненты'],['assets','Ресурсы']] as const;
const rightTabs=[['design','Дизайн'],['prototype','Prototype'],['diagnostics','Проверка']] as const;
type LeftTab=typeof leftTabs[number][0];
type RightTab=typeof rightTabs[number][0];
function TabBar<K extends string>({entries,label,selected,select}:{entries:readonly (readonly [K,string])[];label:string;selected:K;select(key:K,focus?:boolean):void}){
  function onKeyDown(event:ReactKeyboardEvent<HTMLDivElement>){
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const active=entries.findIndex(([key])=>event.target instanceof HTMLElement&&event.target.id==='tab-'+key);
    if(active<0)return;
    const next=event.key==='Home'?0:event.key==='End'?entries.length-1:(active+(event.key==='ArrowRight'?1:-1)+entries.length)%entries.length;
    const entry=entries[next];event.preventDefault();if(entry)select(entry[0],true);
  }
  return <div className="editor-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
    {entries.map(([id,name])=><Button key={id} id={'tab-'+id} className="editor-tab" role="tab" aria-controls={'shell-'+id} aria-selected={id===selected} tabIndex={id===selected?0:-1} onClick={()=>select(id)}>{name}</Button>)}
  </div>;
}
function clampSplit(value:number){return Math.round(Math.min(72,Math.max(22,value)));}

function TokenWorkspace({active,views}:{active:boolean;views:ApplicationViews}){
  const menu=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),importForm=useRef<HTMLFormElement>(null);
  function closeMenu(){if(menu.current?.matches(':popover-open'))menu.current.hidePopover();trigger.current?.focus();}
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
  useEffect(()=>{if(!active&&menu.current?.matches(':popover-open'))menu.current.hidePopover();},[active]);
  return (
    <section id="token-workspace" className="token-workspace" aria-label="Токены" hidden={!active}>
      <p id="tokens-status" role="status" aria-live="polite"/>
      <p id="tokens-error" role="alert"/>
      <form id="token-import-form" className="token-import-form" hidden ref={importForm}>
        <label>
          {"Формат импорта"}
          <select id="token-import-mode">
            <option value="combined">{"FigVam — обе темы"}</option>
            <option value="pair">{"Два файла DTCG"}</option>
          </select>
        </label>
        <label id="token-import-combined-label">
          {"FigVam JSON"}
          <textarea id="token-import-combined" rows={4}/>
          <input type="file" accept=".json,application/json" id="token-import-combined-file" aria-label="Файл токенов FigVam"/>
        </label>
        <label id="token-import-light-label">
          {"DTCG JSON · Light"}
          <textarea id="token-import-light" rows={4}/>
          <input type="file" accept=".json,application/json" id="token-import-light-file" aria-label="Файл токенов Light"/>
        </label>
        <label id="token-import-dark-label">
          {"DTCG JSON · Dark"}
          <textarea id="token-import-dark" rows={4}/>
          <input type="file" accept=".json,application/json" id="token-import-dark-file" aria-label="Файл токенов Dark"/>
        </label>
        <label>
          {"Сопоставление типов/категорий (JSON, необязательно)"}
          <textarea id="token-import-mapping" rows={3} placeholder={'{"dimensionTypes":{"space":"Spacing"}}'}/>
        </label>
        <Button type="submit">{"Импортировать токены"}</Button>
        <Button type="button" onClick={()=>{if(importForm.current)importForm.current.hidden=true;}}>{"Отмена"}</Button>
      </form>
      <div className="token-workspace-grid">
        <div className="token-sidebar">
          <div className="token-tree-toolbar">
            <input id="token-search" type="search" placeholder="Поиск токенов" aria-label="Поиск токенов"/>
            <button id="token-menu-open" className="token-menu-button" type="button" aria-label="Управление токенами" popoverTarget="token-menu" ref={trigger}>
              <Ellipsis size={16} aria-hidden="true"/>
            </button>
            <div className="token-menu" id="token-menu" popover="auto" role="group" aria-label="Управление токенами" ref={menu} onToggle={position}>
              <button id="new-token-open" type="button" hidden onClick={closeMenu}>{"+ Новый токен…"}</button>
              <hr/>
              <button id="token-import-open" type="button" hidden onClick={closeMenu}>{"Импорт токенов…"}</button>
              <button id="token-export" type="button" onClick={closeMenu}>{"Экспорт токенов…"}</button>
              <button id="token-export-light" type="button" onClick={closeMenu}>{"Экспорт Light"}</button>
              <button id="token-export-dark" type="button" onClick={closeMenu}>{"Экспорт Dark"}</button>
              <hr/>
              <div id="token-type-filter" className="token-type-filter" role="group" aria-label="Отображаемые типы"/>
            </div>
          </div>
          <nav id="token-groups" className="token-groups" aria-label="Группы токенов"><views.tokens.groups.Component/></nav>
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
            <tbody id="tokens-list"><views.tokens.table.Component/></tbody>
          </table>
        </div>
        <aside className="token-details-area">
          <p id="token-placeholder" className="token-placeholder">{"Выберите токен или создайте новый."}</p>
          <form id="token-create" hidden>
            <h3>{"Новый токен"}</h3>
            <label htmlFor="new-token-name">{"Имя токена"}</label>
            <input id="new-token-name" required maxLength={256}/>
            <label htmlFor="new-token-type">{"Тип токена"}</label>
            <select id="new-token-type">
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
            <label id="new-token-category-label" htmlFor="new-token-category" hidden>{"Назначение"}</label>
            <select id="new-token-category" hidden/>
            <div id="new-token-values" className="token-theme-values"/>
            <button type="submit">{"Создать токен"}</button>
            <Button id="new-token-cancel" type="button">{"Отмена"}</Button>
          </form>
          <div id="token-detail" hidden>
            <div className="token-name-header">
              <h3 id="token-detail-title"/>
              <button id="token-rename-open" className="token-rename-action" type="button" aria-label="Переименовать токен" title="Переименовать токен">{"✎"}</button>
              <form id="token-rename" hidden>
                <input id="token-name" aria-label="Новое имя токена" required maxLength={256}/>
                <button type="submit" className="token-rename-confirm" aria-label="Сохранить имя токена" title="Сохранить имя">{"✓"}</button>
                <button type="button" id="token-rename-cancel" aria-label="Отменить переименование" title="Отмена">{"×"}</button>
              </form>
            </div>
            <p id="token-detail-type"/>
            <p className="token-invalid" id="token-detail-diagnostic" role="status"/>
            <div id="token-values" className="token-theme-values"/>
            <div id="token-edit" hidden>
              <button id="token-delete" type="button">{"Удалить неиспользуемый токен"}</button>
            </div>
            <h4>{"Использования"}</h4>
            <ul id="token-usages" aria-label="Прямые и косвенные использования токена"><views.tokens.usage.Component/></ul>
          </div>
        </aside>
      </div>
    </section>
  );
}
export function EditorShell({shell,views}:{shell:EditorShellController;views:ApplicationViews}){
  const availableTools=useSyncExternalStore(shell.drawingTools.subscribe,shell.drawingTools.getSnapshot);
  const signoutLabel=useSyncExternalStore(shell.signoutLabel.subscribe,shell.signoutLabel.getSnapshot);
  const [leftTab,setLeftTab]=useState<LeftTab>('layers'),[rightTab,setRightTab]=useState<RightTab>('design');
  const tokensMode=useSyncExternalStore(shell.mode.subscribe,shell.mode.getSnapshot);
  const setTokensMode=shell.mode.publish;
  const [leftCollapsed,setLeftCollapsed]=useState(()=>matchMedia('(max-width: 1050px)').matches);
  const [rightCollapsed,setRightCollapsed]=useState(()=>matchMedia('(max-width: 1050px)').matches);
  const [split,setSplit]=useState(42);
  const dragging=useRef(false),layersPage=useRef<HTMLDivElement>(null);
  const preset=useRef<HTMLSelectElement>(null),screenWidth=useRef<HTMLInputElement>(null),screenHeight=useRef<HTMLInputElement>(null);
  const screenMenu=useRef<HTMLDetailsElement>(null),screenMenuBody=useRef<HTMLDivElement>(null),navigatorToolbar=useRef<HTMLDivElement>(null),paletteMenu=useRef<HTMLDetailsElement>(null);
  function focusTab(key:string){requestAnimationFrame(()=>document.getElementById('tab-'+key)?.focus());}
  function selectLeft(key:LeftTab,focus=false){setLeftTab(key);if(focus)focusTab(key);}
  function selectRight(key:RightTab,focus=false){
    const apply=()=>{setRightTab(key);if(focus)focusTab(key);};
    if(rightTab==='prototype'&&key!=='prototype'&&!shell.beforePrototypeLeave(apply))return;
    apply();
  }
  function selectMode(tokens:boolean){
    if(tokens&&!tokensMode&&rightTab==='prototype'&&!shell.beforePrototypeLeave(()=>setTokensMode(true)))return;
    setTokensMode(tokens);
  }
  function resizeAt(y:number){const bounds=layersPage.current?.getBoundingClientRect();if(bounds?.height)setSplit(clampSplit((y-bounds.top)/bounds.height*100));}
  function applyPreset(){const value=preset.current?.value;if(!value||value==='custom'||!screenWidth.current||!screenHeight.current)return;const [width='',height='']=value.split('x');screenWidth.current.value=width;screenHeight.current.value=height;}
  function syncPreset(){if(!preset.current||!screenWidth.current||!screenHeight.current)return;const dimensions=screenWidth.current.value+'x'+screenHeight.current.value;preset.current.value=[...preset.current.options].some(option=>option.value===dimensions)?dimensions:'custom';}
  function positionNavigatorMenu(){
    const menu=screenMenu.current,body=screenMenuBody.current,trigger=menu?.querySelector('summary');
    if(!menu||!body||!trigger)return;
    if(!menu.open||!trigger.getClientRects().length){if(body.matches(':popover-open'))body.hidePopover();return;}
    if(!body.matches(':popover-open'))body.showPopover();
    const anchor=trigger.getBoundingClientRect(),margin=8,gap=6;
    const selectedPageRow=document.querySelector('#pages > li > .page-select[aria-pressed="true"]')?.parentElement;
    const emptyPage=selectedPageRow&&!selectedPageRow.querySelector('.screen-row');
    const lowerEdge=emptyPage?Math.max(anchor.bottom,selectedPageRow.getBoundingClientRect().bottom):anchor.bottom;
    const below=Math.max(0,window.innerHeight-lowerEdge-gap-margin),above=Math.max(0,anchor.top-gap-margin);
    body.style.maxHeight='';
    const openAbove=body.offsetHeight>below&&above>below;
    body.style.maxHeight=`${openAbove?above:below}px`;
    body.style.left=`${Math.max(margin,Math.min(anchor.left,window.innerWidth-body.offsetWidth-margin))}px`;
    body.style.top=`${openAbove?anchor.top-gap-body.offsetHeight:lowerEdge+gap}px`;
  }
  function onScreenMenuToggle(){
    if(screenMenu.current?.open)for(const rowMenu of document.querySelectorAll<HTMLDetailsElement>('.navigator-context-menu[open]'))rowMenu.open=false;
    positionNavigatorMenu();
  }
  function openCreateScreen(){
    if(!document.getElementById('page-edit')?.hidden&&!document.querySelector('#pages [aria-pressed=true]')){shell.createPage();return;}
    if(!screenMenu.current||document.getElementById('screen-create')?.hidden)return;
    setLeftTab('layers');setLeftCollapsed(false);screenMenu.current.open=true;
    requestAnimationFrame(()=>{positionNavigatorMenu();screenWidth.current?.focus();});
  }
  function addFromToolbar(kind:DrawingToolKind){
    if(!shell.addTool(kind)&&paletteMenu.current){paletteMenu.current.open=true;paletteMenu.current.querySelector<HTMLElement>('#visual-required-properties input, #visual-required-properties select, #visual-required-properties textarea')?.focus();}
  }
  useEffect(()=>{
    const compact=matchMedia('(max-width: 1050px)');
    const onChange=(event:MediaQueryListEvent)=>{setLeftCollapsed(event.matches);setRightCollapsed(event.matches);};
    compact.addEventListener('change',onChange);
    const observer=new ResizeObserver(positionNavigatorMenu);
    if(navigatorToolbar.current)observer.observe(navigatorToolbar.current);
    window.addEventListener('resize',positionNavigatorMenu);window.addEventListener('scroll',positionNavigatorMenu,true);
    const pointer=(event:PointerEvent)=>{
      if(!(event.target instanceof Element))return;
      const clicked=event.target.closest('details.editor-menu, .navigator-toolbar details, .navigator-context-menu');
      for(const details of document.querySelectorAll<HTMLDetailsElement>('details.editor-menu[open], .navigator-toolbar details[open], .navigator-context-menu[open]'))if(details!==clicked&&!details.contains(event.target))details.open=false;
    };
    const key=(event:KeyboardEvent)=>{
      if(event.key!=='Escape')return;
      const last=[...document.querySelectorAll<HTMLDetailsElement>('details.editor-menu[open], .navigator-toolbar details[open], .navigator-context-menu[open]')].at(-1);
      if(!last)return;last.open=false;last.querySelector<HTMLElement>('summary')?.focus();event.preventDefault();
    };
    document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',key);
    return()=>{compact.removeEventListener('change',onChange);observer.disconnect();window.removeEventListener('resize',positionNavigatorMenu);window.removeEventListener('scroll',positionNavigatorMenu,true);document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key);};
  },[]);
  return (
    <div id="editor-design" className="app-shell">
      <header className="document-panel app-toolbar" aria-label="Панель документа">
        <span className="editor-brand">{"FigVam"}</span>
        <a href="/" data-navigation="">{"← Документы"}</a>
        <h1 id="document-title"/>
        <span id="revision"/>
        <div className="app-header-actions">
          <Button className="icon-action sidebar-toggle" title="Показать или скрыть слои" aria-label="Показать или скрыть слои" aria-expanded={!leftCollapsed} hidden={tokensMode} onClick={()=>setLeftCollapsed(value=>!value)}><PanelLeft size={18} aria-hidden="true"/></Button>
          <Button className="icon-action sidebar-toggle" title="Показать или скрыть инспектор" aria-label="Показать или скрыть инспектор" aria-expanded={!rightCollapsed} hidden={tokensMode} onClick={()=>setRightCollapsed(value=>!value)}><PanelRight size={18} aria-hidden="true"/></Button>
          <button id="undo" type="button" className="icon-action" title="Отменить действие" aria-label="Отменить действие">
            <Undo2 size={18} strokeWidth={1.8} aria-hidden="true"/>
          </button>
          <button id="redo" type="button" className="icon-action" title="Повторить действие" aria-label="Повторить действие">
            <Redo2 size={18} strokeWidth={1.8} aria-hidden="true"/>
          </button>
          <button id="open-preview" type="button" disabled>{"Preview"}</button>
          <ul id="presence-list" aria-label="Присутствующие участники" className="presence-chips"><views.presence.list.Component/></ul>
          <p id="connection-status" aria-live="polite"/>
          <details className="editor-menu share-menu">
            <summary className="menu-trigger">{"Поделиться"}</summary>
            <div className="menu-body">
              <section className="editor-group">
                <h3 className="editor-group-title">{"Совместная работа"}</h3>
                <views.members.Component/>
                <section aria-labelledby="presence-title">
                  <p className="visually-hidden">{"Настройки присутствия"}</p>
                  <h2 id="presence-title">{"Участники в документе"}</h2>
                  <label htmlFor="presence-name">{"Ваше имя для участников"}</label>
                  <input id="presence-name" maxLength={128} defaultValue="Участник" autoComplete="off"/>
                  <label htmlFor="presence-color">{"Ваш цвет"}</label>
                  <input id="presence-color" type="color" defaultValue="#2455a4"/>
                  <p id="presence-status" role="status" aria-live="polite"/>
                </section>
              </section>
            </div>
          </details>
          <details className="editor-menu mcp-menu" id="mcp-access-menu">
            <summary className="menu-trigger">{"MCP-доступ"}</summary>
            <div className="menu-body" id="mcp-access-body"><views.mcp.Component/></div>
          </details>
          <details className="editor-menu document-menu">
            <summary className="menu-trigger">{"Файл"}</summary>
            <div className="menu-body">
              <section className="editor-group">
                <h3 className="editor-group-title">{"Документ"}</h3>
                <form id="document-rename" hidden>
                  <label htmlFor="rename-document-name">{"Имя документа"}</label>
                  <input id="rename-document-name" required maxLength={256} autoComplete="off"/>
                  <button type="submit">{"Переименовать документ"}</button>
                  <p id="document-rename-status" role="status" aria-live="polite"/>
                  <p id="document-rename-error" role="alert"/>
                </form>
                <button id="delete-document" type="button" hidden>{"Удалить документ"}</button>
              </section>
              <section className="editor-group">
                <h3 className="editor-group-title">{"Экспорт"}</h3>
                <section aria-labelledby="export-title">
                  <h2 id="export-title">{"Экспорт документа"}</h2>
                  <p id="export-access"/>
                  <button id="export-json" type="button">{"Скачать document.json"}</button>
                  <button id="export-container" type="button">{"Скачать container.figvam"}</button>
                  <p id="export-status" role="status" aria-live="polite"/>
                  <p id="export-error" role="alert"/>
                </section>
              </section>
              <section className="editor-group">
                <h3 className="editor-group-title">{"Версии"}</h3>
                <views.history.form.Component/>
                <section aria-labelledby="versions-title"><views.history.list.Component/></section>
              </section>
              <section className="editor-group">
                <h3 className="editor-group-title">{"История команд"}</h3>
                <span id="history-access"/>
                <p id="history-action-status" role="status" aria-live="polite"/>
                <p id="history-action-error" role="alert"/>
                <button id="history-action-retry" type="button" hidden>{"Повторить неподтверждённую команду"}</button>
              </section>
              <section className="editor-group">
                <h3 className="editor-group-title">{"Аккаунт"}</h3>
                <Button id="editor-signout-menu" type="button" className="mobile-signout" onClick={shell.signOut}>
                  {signoutLabel}
                </Button>
              </section>
            </div>
          </details>
          <Button id="editor-signout" type="button" className="subtle-action" onClick={shell.signOut}>
            {signoutLabel}
          </Button>
        </div>
      </header>
      <div className="document-mode-switch" role="group" aria-label="Режим документа">
        <Button id="document-mode-editor" type="button" className="editor-tab" aria-pressed={!tokensMode} onClick={()=>selectMode(false)}>{"Редактор"}</Button>
        <Button id="document-mode-tokens" type="button" className="editor-tab" aria-pressed={tokensMode} onClick={()=>selectMode(true)}>{"Токены"}</Button>
      </div>
      <div className={'workspace'+(leftCollapsed?' left-collapsed':'')+(rightCollapsed?' right-collapsed':'')} hidden={tokensMode}>
        <aside className="layers-sidebar" aria-labelledby="tree-title">
          <h2 id="tree-title" className="visually-hidden">{"Страницы и слои"}</h2>
          <TabBar entries={leftTabs} label="Разделы документа" selected={leftTab} select={selectLeft}/>
          <div className="panel-stage">
            <div className="layers-page panel-page" ref={layersPage} id="shell-layers" role="tabpanel" aria-labelledby="tab-layers" hidden={leftTab!=="layers"}>
              <div className="layers-master" style={{flexBasis: split+'%'}}>
                <section className="editor-group">
                  <h3 className="editor-group-title">{"Страницы и экраны"}</h3>
                  <div className="navigator-toolbar" ref={navigatorToolbar}>
                    <div id="page-edit" hidden>
                      <button id="page-create" type="button" className="add-page-action" aria-label="Создать страницу" title="Создать страницу" onClick={shell.createPage}>{"Создать страницу"}</button>
                    </div>
                    <details className="editor-menu inline-menu screen-options" ref={screenMenu} onToggle={onScreenMenuToggle}>
                      <summary className="menu-trigger">{"+ Экран"}</summary>
                      <div className="screen-options-body" popover="manual" ref={screenMenuBody}>
                        <select id="screen-preset" ref={preset} aria-label="Типовой размер экрана" onChange={applyPreset} defaultValue="1440x900">
                          <option value="1440x900">{"Desktop · 1440 × 900"}</option>
                          <option value="390x844">{"Mobile · 390 × 844"}</option>
                          <option value="768x1024">{"Tablet · 768 × 1024"}</option>
                          <option value="custom">{"Другой размер"}</option>
                        </select>
                        <form id="screen-create" hidden onReset={()=>{if(preset.current)preset.current.value='1440x900';}}>
                          <label htmlFor="screen-width">{"Ширина экрана"}</label>
                          <input id="screen-width" type="number" min="0" step="any" required defaultValue="1440" ref={screenWidth} onInput={syncPreset}/>
                          <label htmlFor="screen-height">{"Высота экрана"}</label>
                          <input id="screen-height" type="number" min="0" step="any" required defaultValue="900" ref={screenHeight} onInput={syncPreset}/>
                          <button type="submit">{"Создать экран"}</button>
                        </form>
                      </div>
                    </details>
                    <button id="page-refresh" type="button" title="Обновить страницы">{"Обновить страницы"}</button>
                  </div>
                  <div className="navigator-tree-host"><views.navigator.Component/></div>
                  <p id="page-access"/>
                </section>
              </div>
              <div className="layers-splitter" role="separator" tabIndex={0} aria-label="Изменить высоту навигации и дерева слоёв" aria-orientation="horizontal" aria-valuemin={22} aria-valuemax={72} aria-valuenow={split}
          onPointerDown={event=>{if(event.button!==0)return;dragging.current=true;event.currentTarget.setPointerCapture(event.pointerId);resizeAt(event.clientY);event.preventDefault();}}
          onPointerMove={event=>{if(dragging.current)resizeAt(event.clientY);}} onPointerUp={()=>{dragging.current=false;}} onPointerCancel={()=>{dragging.current=false;}} onLostPointerCapture={()=>{dragging.current=false;}}
          onKeyDown={event=>{if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;event.preventDefault();setSplit(value=>clampSplit(value+(event.key==='ArrowDown'?5:-5)));}}/>
              <div className="layers-detail">
                <section aria-labelledby="layers-title" className="layer-tree-group">
                  <h2 id="layers-title">{"Слои выбранного экрана"}</h2>
                  <p id="layers-status" role="status" aria-live="polite">{"Выберите экран."}</p>
                  <div id="layers" role="tree" aria-label="Слои экрана"><views.layers.Component/></div>
                  <p id="node-order-status" role="status" tabIndex={-1}/>
                  <button id="node-order-retry" type="button" hidden>{"Повторить перемещение слоя"}</button>
                </section>
              </div>
            </div>
            <div className="components-page panel-page" id="shell-components" role="tabpanel" aria-labelledby="tab-components" hidden={leftTab!=="components"}>
              <section aria-labelledby="components-title"><views.components.Component/></section>
            </div>
            <div className="assets-page panel-page" id="shell-assets" role="tabpanel" aria-labelledby="tab-assets" hidden={leftTab!=="assets"}>
              <section className="editor-group">
                <h3 className="editor-group-title">{"Изображения"}</h3>
                <form id="asset-upload-form">
                  <label>
                    {"Изображение PNG "}
                    <input id="asset-upload-file" type="file" accept="image/png" required/>
                  </label>
                  <button id="asset-upload" type="submit">{"Загрузить изображение"}</button>
                </form>
                <p>{"PNG до 5 МиБ; сервер проверяет формат и размеры изображения."}</p>
                <p id="asset-upload-status" role="status"/>
                <p id="asset-upload-error" role="alert"/>
                <button id="asset-upload-retry" type="button" hidden>{"Повторить загрузку изображения"}</button>
              </section>
              <section aria-labelledby="datasets-title"><views.datasets.Component/></section>
              <section className="editor-group">
                <div id="styles-panel">
                  <h3>{"Стили оформления"}</h3>
                  <p id="styles-total" role="status"/>
                  <p id="styles-error" role="alert"/>
                  <p id="styles-status" role="status" aria-live="polite"/>
                  <label htmlFor="styles-list">{"TextStyle и BorderStyle"}</label>
                  <select id="styles-list" aria-label="Выбрать стиль или создать новый"/>
                  <form id="styles-form" hidden>
                    <label htmlFor="styles-name">{"Имя стиля"}</label>
                    <input id="styles-name" maxLength={256} required/>
                    <label htmlFor="styles-type">{"Тип"}</label>
                    <select id="styles-type">
                      <option value="TextStyle">{"TextStyle"}</option>
                      <option value="BorderStyle">{"BorderStyle"}</option>
                    </select>
                    <label htmlFor="styles-based-on">{"Основан на (BasedOn)"}</label>
                    <select id="styles-based-on"/>
                    <div id="styles-fields"><views.styles.fields.Component/></div>
                    <button id="styles-save" type="submit">{"Сохранить стиль"}</button>
                  </form>
                  <button id="styles-delete" type="button" hidden>{"Удалить неиспользуемый стиль"}</button>
                  <pre id="styles-preview" aria-label="Вычисленное оформление Light и Dark"/>
                  <h4>{"Использования стиля"}</h4>
                  <ul id="styles-usages" aria-label="Прямые и косвенные использования стиля"><views.styles.usage.Component/></ul>
                </div>
              </section>
              <section aria-labelledby="screen-variants-title"><views.screenVariants.Component/></section>
            </div>
          </div>
        </aside>
        <section className="canvas design-canvas" aria-labelledby="canvas-title">
          <div className="drawing-toolbar">
            <DrawingTools available={availableTools} onSelect={()=>document.getElementById('viewport')?.focus()} onAdd={addFromToolbar}/>
            <details className="editor-menu palette-options" ref={paletteMenu}>
              <summary className="menu-trigger">{"Параметры добавления"}</summary>
              <section id="visual-palette" aria-labelledby="visual-palette-title" hidden>
                <h2 id="visual-palette-title">{"Добавить элемент"}</h2>
                <form id="visual-palette-form" noValidate hidden>
                  <label>
                    {"Вид элемента "}
                    <select id="visual-kind"/>
                  </label>
                  <label>
                    {"Куда добавить "}
                    <select id="visual-parent"/>
                  </label>
                  <div id="visual-required-properties"/>
                  <details id="visual-optional-details" hidden>
                    <summary>{"Токены и оформление"}</summary>
                    <div id="visual-optional-properties"/>
                  </details>
                  <button id="visual-add" type="submit">{"Добавить элемент"}</button>
                </form>
                <p id="visual-palette-status" role="status"/>
                <p id="visual-palette-error" role="alert"/>
                <button id="visual-palette-retry" type="button" hidden>{"Повторить загрузку палитры"}</button>
                <button id="visual-add-retry" type="button" hidden>{"Повторить добавление"}</button>
              </section>
            </details>
          </div>
          <h2 id="canvas-title" className="visually-hidden">{"Холст"}</h2>
          <p id="canvas-selection" className="canvas-caption">{"Выберите экран, чтобы показать его на холсте."}</p>
          <p id="canvas-help" className="visually-hidden">{"Перетащите слой для перемещения или его нижний правый угол для изменения размера. Стрелки перемещают выбранный слой, Shift со стрелками меняет размер, Delete удаляет. Для панорамирования перетащите фон, удерживайте Alt или нажмите среднюю кнопку мыши. Alt со стрелками панорамирует с клавиатуры. Колесо меняет масштаб."}</p>
          <p id="design-render-status" role="status"/>
          <button id="design-render-retry" type="button" hidden>{"Повторить загрузку экрана"}</button>
          <ul id="design-render-diagnostics" aria-label="Диагностика отображения"/>
          <div className="canvas-blank" id="canvas-empty">
            <h2>{"Нет выбранного экрана"}</h2>
            <p>{"Выберите экран слева или создайте новый, чтобы начать работу."}</p>
            <Button type="button" className="primary-action" aria-label="Открыть создание экрана" onClick={openCreateScreen}>{"Создать экран"}</Button>
          </div>
          <div id="viewport" tabIndex={0} role="region" aria-label="Область холста" aria-describedby="canvas-help">
            <div id="screen-boundary" hidden/>
            <div id="presence-markers" aria-hidden="true"><views.presence.markers.Component/></div>
          </div>
          <p id="canvas-edit-hint" role="status"/>
          <p id="canvas-edit-status" role="status"/>
          <p id="canvas-edit-error" role="alert"/>
          <button id="canvas-edit-retry" type="button" hidden>{"Повторить неподтверждённую команду"}</button>
          <div className="viewport-controls" role="group" aria-label="Управление холстом">
            <button id="zoom-out" type="button" title="Уменьшить">{"Уменьшить"}</button>
            <output id="zoom-level" aria-label="Масштаб" title="Текущий масштаб">{"100%"}</output>
            <button id="zoom-in" type="button" title="Увеличить">{"Увеличить"}</button>
            <button id="fit-screen" type="button" title="Вместить экран в холст">{"Вместить экран"}</button>
            <button id="actual-size" type="button">{"100%"}</button>
          </div>
        </section>
        <aside className="properties-sidebar" aria-labelledby="inspector-title">
          <TabBar entries={rightTabs} label="Разделы инспектора" selected={rightTab} select={selectRight}/>
          <div className="panel-stage">
            <div className="inspector-page panel-page" id="shell-design" role="tabpanel" aria-labelledby="tab-design" hidden={rightTab!=="design"}>
              <h2 id="inspector-title">{"Инспектор"}</h2>
              <p id="inspector-selection">{"Выберите слой."}</p>
              <button id="node-delete" type="button" hidden>{"Удалить слой"}</button>
              <p id="node-delete-status" role="alert"/>
              <button id="node-delete-retry" type="button" hidden>{"Повторить удаление слоя"}</button>
              <section id="visual-inspector" aria-labelledby="visual-inspector-title" hidden>
                <h3 id="visual-inspector-title">{"Свойства элемента"}</h3>
                <form id="visual-properties-form" noValidate hidden>
                  <div id="visual-properties"/>
                  <button id="visual-properties-reset" type="button" hidden>{"Сбросить изменения свойств"}</button>
                </form>
                <p id="visual-inspector-status" role="status"/>
                <p id="visual-inspector-error" role="alert"/>
                <button id="visual-save-retry" type="button" hidden>{"Повторить сохранение свойств"}</button>
                <button id="visual-data-retry" type="button" hidden>{"Повторить загрузку свойств"}</button>
              </section>
              <div id="node-metadata" hidden>
                <p id="node-metadata-status" role="status"/>
                <p id="node-metadata-error" role="alert"/>
                <form id="node-name-form">
                  <label>
                    {"Имя слоя "}
                    <input id="node-name" maxLength={256}/>
                  </label>
                </form>
                <form id="node-key-form">
                  <label>
                    {"Semantic key "}
                    <input id="node-key" maxLength={256} aria-describedby="node-key-help"/>
                  </label>
                  <p id="node-key-help">{"Пустое значение удаляет semantic key."}</p>
                </form>
                <button id="node-metadata-retry" type="button" hidden>{"Повторить неподтверждённую команду"}</button>
              </div>
              <section aria-labelledby="screen-size-title"><views.screenResize.Component/></section>
            </div>
            <div className="prototype-page panel-page" id="shell-prototype" role="tabpanel" aria-labelledby="tab-prototype" hidden={rightTab!=="prototype"}>
              <section aria-labelledby="scenarios-title">
                <div className="scenarios-heading">
                  <h2 id="scenarios-title">{"Взаимодействия"}</h2>
                  <span id="scenarios-count" role="status" hidden/>
                </div>
                <p id="scenarios-context"/>
                <p id="scenarios-status" role="status" aria-live="polite">{"Выберите экран."}</p>
                <p id="scenarios-error" role="alert"/>
                <button id="scenarios-retry" type="button" hidden>{"Повторить загрузку сценариев"}</button>
                <button id="scenario-create" type="button" hidden>{"Добавить взаимодействие"}</button>
                <p id="scenario-command-status" role="status" aria-live="polite"/>
                <p id="scenario-command-error" role="alert"/>
                <button id="scenario-command-retry" type="button" hidden>{"Повторить команду"}</button>
                <ul id="scenarios-list" aria-label="Взаимодействия"><views.scenarios.list.Component/></ul>
                <form id="scenario-edit" aria-labelledby="scenario-edit-title" hidden>
                  <h3 id="scenario-edit-title" tabIndex={-1}>{"Настройка взаимодействия"}</h3>
                  <p id="scenario-edit-source"/>
                  <p id="scenario-edit-conflict" role="alert"/>
                  <button id="scenario-edit-reload" type="button" hidden>{"Загрузить актуальное взаимодействие"}</button>
                  <fieldset id="scenario-edit-fields">
                    <legend>{"Настройка события и действий"}</legend>
                    <label>
                      {"Событие "}
                      <select id="scenario-edit-event" aria-label="Событие"/>
                    </label>
                    <ol id="scenario-edit-actions" aria-label="Порядок действий"><views.scenarios.actions.Component/></ol>
                    <button id="scenario-edit-add" type="button">{"Добавить действие"}</button>
                  </fieldset>
                  <p id="scenario-edit-validation" role="status" aria-live="polite"/>
                  <button id="scenario-edit-recheck" type="button" hidden>{"Повторить проверку"}</button>
                  <button id="scenario-edit-submit" type="submit">{"Сохранить взаимодействие"}</button>
                  <button id="scenario-edit-cancel" type="button">{"Отмена"}</button>
                </form>
                <div id="scenarios-pagination" role="group" aria-label="Страницы взаимодействий" hidden>
                  <button id="scenarios-previous" type="button" aria-label="Предыдущие сценарии" title="Предыдущая страница" disabled>{"‹"}</button>
                  <span id="scenarios-number" aria-live="polite"/>
                  <button id="scenarios-next" type="button" aria-label="Следующие сценарии" title="Следующая страница" disabled>{"›"}</button>
                </div>
                <dialog id="scenario-leave-dialog" aria-labelledby="scenario-leave-title">
                  <h3 id="scenario-leave-title">{"Несохранённое взаимодействие"}</h3>
                  <p>{"Сохранить изменения перед сменой контекста?"}</p>
                  <button type="button" id="scenario-leave-save">{"Сохранить"}</button>
                  <button type="button" id="scenario-leave-discard">{"Отбросить изменения"}</button>
                  <button type="button" id="scenario-leave-stay">{"Продолжить редактирование"}</button>
                </dialog>
              </section>
            </div>
            <div className="diagnostics-page panel-page" id="shell-diagnostics" role="tabpanel" aria-labelledby="tab-diagnostics" hidden={rightTab!=="diagnostics"}>
              <section aria-labelledby="diagnostics-title"><views.diagnostics.Component/></section>
            </div>
          </div>
        </aside>
      </div>
      <TokenWorkspace active={tokensMode} views={views}/>
    </div>
  );
}
