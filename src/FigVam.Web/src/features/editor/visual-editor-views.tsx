import type { ComponentType } from 'react';
import { createViewModel } from '../../app/view-model';
import type { VisualAction } from './visual-tools';
import { Button } from '../../ui/Button';
interface Feedback {status:string;error:string;retryHidden:boolean;retry():void}
interface AssetViewProps extends Feedback {disabled:boolean;fileReset:number;choose(file:File|null):void;submit():void}
interface PaletteViewProps extends Feedback {hidden:boolean;formHidden:boolean;blocked:boolean;addDisabled:boolean;kind:string;kinds:string[];parent:string;parents:{value:string;text:string}[];optionalHidden:boolean;optionalOpen:boolean;loadRetryHidden:boolean;Required:ComponentType;Optional:ComponentType;changeKind(kind:string):void;changeParent(parent:string):void;toggleOptional(open:boolean):void;submit():void;loadRetry():void}
interface InspectorViewProps extends Feedback {hidden:boolean;formHidden:boolean;blocked:boolean;resetHidden:boolean;loadRetryHidden:boolean;Fields:ComponentType;submit():void;reset():void;loadRetry():void}
function AssetView(p:AssetViewProps){return <>                <form id="asset-upload-form" onSubmit={event=>{event.preventDefault();p.submit();}}>
                  <label>
                    {"Изображение PNG / SVG "}
                    <input key={p.fileReset} id="asset-upload-file" disabled={p.disabled} onChange={event=>p.choose(event.currentTarget.files?.[0]??null)} type="file" accept="image/png,image/svg+xml" required/>
                  </label>
                  <Button id="asset-upload" type="submit" disabled={p.disabled}>{"Загрузить изображение"}</Button>
                </form>
                <p>{"PNG или безопасный SVG до 5 МиБ; сервер проверяет формат и размеры изображения."}</p>
                <p id="asset-upload-status" role="status">{p.status}</p>
                <p id="asset-upload-error" role="alert">{p.error}</p>
                <Button id="asset-upload-retry" type="button" hidden={p.retryHidden} onClick={p.retry}>{"Повторить загрузку изображения"}</Button>
</>;}
function PaletteView(p:PaletteViewProps){return (              <section id="visual-palette" aria-labelledby="visual-palette-title" hidden={p.hidden}>
                <h2 id="visual-palette-title">{"Добавить элемент"}</h2>
                <form id="visual-palette-form" noValidate hidden={p.formHidden} onSubmit={event=>{event.preventDefault();p.submit();}}>
                  <label>
                    {"Вид элемента "}
                    <select id="visual-kind" disabled={p.blocked} value={p.kind} onChange={event=>p.changeKind(event.currentTarget.value)}>{p.kinds.map(kind=><option key={kind}>{kind}</option>)}</select>
                  </label>
                  <label>
                    {"Куда добавить "}
                    <select id="visual-parent" disabled={p.blocked} value={p.parent} onChange={event=>p.changeParent(event.currentTarget.value)}>{p.parents.map(parent=><option key={parent.value} value={parent.value}>{parent.text}</option>)}</select>
                  </label>
                  <div id="visual-required-properties"><p.Required/></div>
                  <details id="visual-optional-details" hidden={p.optionalHidden} open={p.optionalOpen} onToggle={event=>p.toggleOptional(event.currentTarget.open)}>
                    <summary>{"Токены и оформление"}</summary>
                    <div id="visual-optional-properties"><p.Optional/></div>
                  </details>
                  <Button id="visual-add" type="submit" disabled={p.addDisabled}>{"Добавить элемент"}</Button>
                </form>
                <p id="visual-palette-status" role="status">{p.status}</p>
                <p id="visual-palette-error" role="alert">{p.error}</p>
                <Button id="visual-palette-retry" type="button" hidden={p.loadRetryHidden} onClick={p.loadRetry}>{"Повторить загрузку палитры"}</Button>
                <Button id="visual-add-retry" type="button" hidden={p.retryHidden} onClick={p.retry}>{"Повторить добавление"}</Button>
              </section>);}
function InspectorView(p:InspectorViewProps){return (              <section id="visual-inspector" aria-labelledby="visual-inspector-title" hidden={p.hidden}>
                <h3 id="visual-inspector-title">{"Свойства элемента"}</h3>
                <form id="visual-properties-form" noValidate hidden={p.formHidden} onSubmit={event=>{event.preventDefault();p.submit();}}>
                  <div id="visual-properties"><p.Fields/></div>
                  <Button id="visual-properties-reset" type="button" hidden={p.resetHidden} disabled={p.blocked} onClick={p.reset}>{"Сбросить изменения свойств"}</Button>
                </form>
                <p id="visual-inspector-status" role="status">{p.status}</p>
                <p id="visual-inspector-error" role="alert">{p.error}</p>
                <Button id="visual-save-retry" type="button" hidden={p.retryHidden} onClick={p.retry}>{"Повторить сохранение свойств"}</Button>
                <Button id="visual-data-retry" type="button" hidden={p.loadRetryHidden} onClick={p.loadRetry}>{"Повторить загрузку свойств"}</Button>
              </section>);}
function CanvasFeedback(p:Feedback){return <>          <p id="canvas-edit-status" role="status">{p.status}</p>
          <p id="canvas-edit-error" role="alert">{p.error}</p>
          <Button id="canvas-edit-retry" type="button" hidden={p.retryHidden} onClick={p.retry}>{"Повторить неподтверждённую команду"}</Button>
</>;}
const actionLabels:Record<VisualAction,string>={left:'По левому краю',right:'По правому краю',top:'По верхнему краю',bottom:'По нижнему краю',centerX:'По центру горизонтали',centerY:'По центру вертикали',distributeX:'Распределить горизонтально',distributeY:'Распределить вертикально',group:'Сгруппировать',ungroup:'Разгруппировать',copy:'Копировать оформление',paste:'Вставить оформление'};
function VisualActions(p:{visible:boolean;available:readonly VisualAction[];run(action:VisualAction):void}){return <section hidden={!p.visible} aria-label="Визуальное редактирование"><div className="visual-action-buttons">{(Object.keys(actionLabels) as VisualAction[]).map(action=><Button key={action} disabled={!p.available.includes(action)} onClick={()=>p.run(action)}>{actionLabels[action]}</Button>)}</div></section>;}
export function createVisualEditorViews(){return {visualActions:createViewModel(VisualActions),asset:createViewModel(AssetView),palette:createViewModel(PaletteView),inspectorPanel:createViewModel(InspectorView),canvasFeedback:createViewModel(CanvasFeedback)};}
