import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { PanelLeft, PanelRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { createPanelStore } from '../../app/panel-store';
import { canEditDocument, type DocumentShellModel, type DeletionViewModel } from '../../app/document-shell-state';
import type { ApplicationViews } from '../../app/application-views';
import { DrawingTools, type DrawingToolKind } from './drawing-tools';
import { Button } from '../../ui/Button';
import { TextInput, NumberInput } from '../../ui/Inputs';

interface ShellActions {
  beforePrototypeLeave(resume:()=>void):boolean;
  addTool(kind:DrawingToolKind):boolean;
  signOut():void;
  createPage():void;
  document:DocumentShellModel;
  deletion:DeletionViewModel;
  renameDocument():void;
  deleteDocument():void;
  retryDeletion():void;
  createScreen():void;
  refreshPages():void;
}
export function createEditorShell(actions:ShellActions) {
  const drawingTools=createPanelStore<readonly string[]>([]);
  const signoutLabel=createPanelStore('Выйти');
  const mode=createPanelStore(false),rightTab=createPanelStore<RightTab>('design');
  return {...actions, drawingTools, signoutLabel, mode,rightTab, showEditor:()=>mode.publish(false),
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
  useEffect(()=>{const menu=document.getElementById('token-menu');if(!active&&menu?.matches(':popover-open'))menu.hidePopover();},[active]);
  return (
    <section id="token-workspace" className="token-workspace" aria-label="Токены" hidden={!active}>
      <views.tokens.panel.Component/>
    </section>
  );
}
export function EditorShell({shell,views}:{shell:EditorShellController;views:ApplicationViews}){
  const state=useSyncExternalStore(shell.document.subscribe,shell.document.getSnapshot);
  const deletion=useSyncExternalStore(shell.deletion.subscribe,shell.deletion.getSnapshot);
  const canEdit=canEditDocument(state.role);
  const availableTools=useSyncExternalStore(shell.drawingTools.subscribe,shell.drawingTools.getSnapshot);
  const signoutLabel=useSyncExternalStore(shell.signoutLabel.subscribe,shell.signoutLabel.getSnapshot);
  const [leftTab,setLeftTab]=useState<LeftTab>('layers');
  const rightTab=useSyncExternalStore(shell.rightTab.subscribe,shell.rightTab.getSnapshot),setRightTab=shell.rightTab.publish;
  const tokensMode=useSyncExternalStore(shell.mode.subscribe,shell.mode.getSnapshot);
  const setTokensMode=shell.mode.publish;
  const [leftCollapsed,setLeftCollapsed]=useState(()=>matchMedia('(max-width: 1050px)').matches);
  const [rightCollapsed,setRightCollapsed]=useState(()=>matchMedia('(max-width: 1050px)').matches);
  const [split,setSplit]=useState(42);
  const dragging=useRef(false),layersPage=useRef<HTMLDivElement>(null);
  const screenWidth=useRef<HTMLInputElement>(null);
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
    if(canEdit&&!state.hasPage){shell.createPage();return;}
    if(!screenMenu.current||!canEdit)return;
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
        <h1 id="document-title">{state.title}</h1>
        <span id="revision">{state.revisionLabel}</span>
        <div className="app-header-actions">
          <Button className="icon-action sidebar-toggle" title="Показать или скрыть слои" aria-label="Показать или скрыть слои" aria-expanded={!leftCollapsed} hidden={tokensMode} onClick={()=>setLeftCollapsed(value=>!value)}><PanelLeft size={18} aria-hidden="true"/></Button>
          <Button className="icon-action sidebar-toggle" title="Показать или скрыть инспектор" aria-label="Показать или скрыть инспектор" aria-expanded={!rightCollapsed} hidden={tokensMode} onClick={()=>setRightCollapsed(value=>!value)}><PanelRight size={18} aria-hidden="true"/></Button>
          <views.history.toolbar.Component/>
          <Button id="open-preview" type="button" disabled>{"Preview"}</Button>
          <ul id="presence-list" aria-label="Присутствующие участники" className="presence-chips"><views.presence.list.Component/></ul>
          <p id="connection-status" aria-live="polite">{state.connectionStatus}</p>
          <details className="editor-menu share-menu">
            <summary className="menu-trigger">{"Поделиться"}</summary>
            <div className="menu-body">
              <section className="editor-group">
                <h3 className="editor-group-title">{"Совместная работа"}</h3>
                <views.members.Component/>
                <section aria-labelledby="presence-title">
                  <p className="visually-hidden">{"Настройки присутствия"}</p>
                  <h2 id="presence-title">{"Участники в документе"}</h2>
                  <views.presence.settings.Component/>
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
                <form id="document-rename" hidden={!canEdit} onSubmit={event=>{event.preventDefault();shell.renameDocument();}}>
                  <label htmlFor="rename-document-name">{"Имя документа"}</label>
                  <TextInput id="rename-document-name" value={state.renameName} onChange={event=>shell.document.patch({renameName:event.currentTarget.value})} required maxLength={256} autoComplete="off"/>
                  <Button type="submit" disabled={state.renameBusy}>{"Переименовать документ"}</Button>
                  <p id="document-rename-status" role="status" aria-live="polite">{state.renameStatus}</p>
                  <p id="document-rename-error" role="alert">{state.renameError}</p>
                </form>
                <Button id="delete-document" type="button" hidden={state.role!=='Owner'} disabled={deletion.status!=='idle'} onClick={shell.deleteDocument}>{"Удалить документ"}</Button>
              </section>
              <section className="editor-group">
                <h3 className="editor-group-title">{"Экспорт"}</h3>
                <views.documentExport.Component/>
              </section>
              <section className="editor-group">
                <h3 className="editor-group-title">{"Версии"}</h3>
                <views.history.form.Component/>
                <section aria-labelledby="versions-title"><views.history.list.Component/></section>
              </section>
              <section className="editor-group">
                <h3 className="editor-group-title">{"История команд"}</h3>
                <views.history.feedback.Component/>
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
                    <div id="page-edit" hidden={!canEdit} inert={state.pageBusy}>
                      <Button id="page-create" type="button" className="add-page-action" aria-label="Создать страницу" title="Создать страницу" onClick={shell.createPage}>{"Создать страницу"}</Button>
                    </div>
                    <details className="editor-menu inline-menu screen-options" hidden={!canEdit} ref={screenMenu} onToggle={onScreenMenuToggle}>
                      <summary className="menu-trigger">{"+ Экран"}</summary>
                      <div className="screen-options-body" popover="manual" ref={screenMenuBody}>
                        <select id="screen-preset" aria-label="Типовой размер экрана" onChange={event=>shell.document.setScreenPreset(event.currentTarget.value)} value={state.screenPreset}>
                          <option value="1440x900">{"Desktop · 1440 × 900"}</option>
                          <option value="390x844">{"Mobile · 390 × 844"}</option>
                          <option value="768x1024">{"Tablet · 768 × 1024"}</option>
                          <option value="custom">{"Другой размер"}</option>
                        </select>
                        <form id="screen-create" hidden={!canEdit} inert={state.pageBusy} onReset={event=>{event.preventDefault();shell.document.resetScreenForm();}} onSubmit={event=>{event.preventDefault();shell.createScreen();}}>
                          <label htmlFor="screen-width">{"Ширина экрана"}</label>
                          <NumberInput id="screen-width" min="0" step="any" required value={state.screenWidth} ref={screenWidth} disabled={!state.hasPage} onChange={event=>shell.document.setScreenDimension('screenWidth',event.currentTarget.value)}/>
                          <label htmlFor="screen-height">{"Высота экрана"}</label>
                          <NumberInput id="screen-height" min="0" step="any" required value={state.screenHeight} disabled={!state.hasPage} onChange={event=>shell.document.setScreenDimension('screenHeight',event.currentTarget.value)}/>
                          <Button type="submit" disabled={!state.hasPage}>{"Создать экран"}</Button>
                        </form>
                      </div>
                    </details>
                    <Button id="page-refresh" type="button" title="Обновить страницы" onClick={shell.refreshPages}>{"Обновить страницы"}</Button>
                  </div>
                  <div className="navigator-tree-host"><views.navigator.Component/></div>
                  <p id="page-access">{state.role==='Viewer'?'Только просмотр страниц.':state.role?'':'Права на редактирование не определены. Обновите страницу.'}</p>
                </section>
              </div>
              <div className="layers-splitter" role="separator" tabIndex={0} aria-label="Изменить высоту навигации и дерева слоёв" aria-orientation="horizontal" aria-valuemin={22} aria-valuemax={72} aria-valuenow={split}
          onPointerDown={event=>{if(event.button!==0)return;dragging.current=true;event.currentTarget.setPointerCapture(event.pointerId);resizeAt(event.clientY);event.preventDefault();}}
          onPointerMove={event=>{if(dragging.current)resizeAt(event.clientY);}} onPointerUp={()=>{dragging.current=false;}} onPointerCancel={()=>{dragging.current=false;}} onLostPointerCapture={()=>{dragging.current=false;}}
          onKeyDown={event=>{if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;event.preventDefault();setSplit(value=>clampSplit(value+(event.key==='ArrowDown'?5:-5)));}}/>
              <div className="layers-detail">
                <section aria-labelledby="layers-title" className="layer-tree-group">
                  <h2 id="layers-title">{state.layersTitle}</h2>
                  <views.layers.status.Component/>
                  <div id="layers" role="tree" aria-label="Слои экрана"><views.layers.Component/></div>
                  <views.layers.order.Component/>
                </section>
              </div>
            </div>
            <div className="components-page panel-page" id="shell-components" role="tabpanel" aria-labelledby="tab-components" hidden={leftTab!=="components"}>
              <section aria-labelledby="components-title"><views.components.Component/></section>
            </div>
            <div className="assets-page panel-page" id="shell-assets" role="tabpanel" aria-labelledby="tab-assets" hidden={leftTab!=="assets"}>
              <section className="editor-group">
                <h3 className="editor-group-title">{"Изображения"}</h3>
                <views.propertyFields.asset.Component/>
              </section>
              <section aria-labelledby="datasets-title"><views.datasets.Component/></section>
              <section className="editor-group">
                <views.styles.panel.Component/>
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
              <views.propertyFields.palette.Component/>
            </details>
          </div>
          <h2 id="canvas-title" className="visually-hidden">{"Холст"}</h2>
          <p id="canvas-selection" className="canvas-caption">{"Выберите экран, чтобы показать его на холсте."}</p>
          <p id="canvas-help" className="visually-hidden">{"Перетащите слой для перемещения или его нижний правый угол для изменения размера. Стрелки перемещают выбранный слой, Shift со стрелками меняет размер, Delete удаляет. Для панорамирования перетащите фон, удерживайте Alt или нажмите среднюю кнопку мыши. Alt со стрелками панорамирует с клавиатуры. Колесо меняет масштаб."}</p>
          <p id="design-render-status" role="status"/>
          <Button id="design-render-retry" type="button" hidden>{"Повторить загрузку экрана"}</Button>
          <ul id="design-render-diagnostics" aria-label="Диагностика отображения"/>
          <div className="canvas-blank" id="canvas-empty" hidden={state.hasScreen}>
            <h2>{"Нет выбранного экрана"}</h2>
            <p>{state.hasPage?"Выберите экран слева или создайте новый, чтобы начать работу.":"Создайте первую страницу, затем добавьте экран."}</p>
            <Button type="button" className="primary-action" aria-label="Открыть создание экрана" hidden={!canEdit} onClick={openCreateScreen}>{state.hasPage?"Создать экран":"Создать страницу"}</Button>
          </div>
          <div id="viewport" tabIndex={0} role="region" aria-label="Область холста" aria-describedby="canvas-help">
            <div id="screen-boundary" hidden/>
            <div id="presence-markers" aria-hidden="true"><views.presence.markers.Component/></div>
          </div>
          <p id="canvas-edit-hint" role="status"/>
          <views.propertyFields.canvasFeedback.Component/>
          <div className="viewport-controls" role="group" aria-label="Управление холстом">
            <Button id="zoom-out" type="button" title="Уменьшить">{"Уменьшить"}</Button>
            <output id="zoom-level" aria-label="Масштаб" title="Текущий масштаб">{"100%"}</output>
            <Button id="zoom-in" type="button" title="Увеличить">{"Увеличить"}</Button>
            <Button id="fit-screen" type="button" title="Вместить экран в холст">{"Вместить экран"}</Button>
            <Button id="actual-size" type="button">{"100%"}</Button>
          </div>
        </section>
        <aside className="properties-sidebar" aria-labelledby="inspector-title">
          <TabBar entries={rightTabs} label="Разделы инспектора" selected={rightTab} select={selectRight}/>
          <div className="panel-stage">
            <div className="inspector-page panel-page" id="shell-design" role="tabpanel" aria-labelledby="tab-design" hidden={rightTab!=="design"}>
              <h2 id="inspector-title">{"Инспектор"}</h2>
              <views.layers.caption.Component/>
              <views.layers.deletion.Component/>
              <views.propertyFields.inspectorPanel.Component/>
              <views.layers.metadata.Component/>
              <section aria-labelledby="screen-size-title"><views.screenResize.Component/></section>
            </div>
            <div className="prototype-page panel-page" id="shell-prototype" role="tabpanel" aria-labelledby="tab-prototype" hidden={rightTab!=="prototype"}>
              <views.scenarios.panel.Component/>
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
