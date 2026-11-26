import { InlineError, StatusMessage } from '../../ui/Feedback';
import { createPanelRoot } from '../../app/react-panels';
import { flushSync } from 'react-dom';
import { Button } from '../../ui/Button';
import { ApiError, type ApiClient } from '../../api/api-client';
import { requiredRecord, text, array, errorMessage, aborted } from '../../api/decode';
import type { components } from '../../api/schema.generated';

type Action='undo'|'redo';
type Status='pending'|'uncertain'|'failed'|'success';
type Schema=components['schemas'];
interface Operation {state:Status;error?:string}
interface SaveOperation extends Operation {body:Schema['SaveDocumentRequest'];versionId?:string}
interface RestoreOperation extends Operation {body:Schema['RestoreDocumentRequest']}
interface HistoryOperation extends Operation {action:Action;commandId:string;sending?:boolean}
interface Workspace {documentId:string|null;documentRole:string|null;navigationEpoch:number;token:string|null}
interface Options {element(id:string):HTMLElement;request:ApiClient;pageSize:number;refreshPages():Promise<unknown>;workspace:Workspace}
interface Version {id:string;name:string|null;authorId:string;timestamp:string;revision:number}
interface ListState {versions:Version[];status:string;error:string;index:number;next:number|null;loading:boolean;loaded:boolean}
const initial=():ListState=>({versions:[],status:'',error:'',index:0,next:null,loading:false,loaded:false});
const blocked=(op:Operation|undefined)=>op?.state==='pending'||op?.state==='uncertain';
const unknownResult=(error:unknown)=>!(error instanceof ApiError)||error.status>=500;
function number(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value))throw new TypeError('Некорректная ревизия');return value;}
function decodeVersion(value:unknown):Version{const v=requiredRecord(value);return{id:text(v.id),name:v.name==null?null:text(v.name),authorId:text(v.authorId),timestamp:text(v.timestamp),revision:number(v.revision)};}
function VersionForm({operation,draft,setDraft}:{operation:SaveOperation|undefined;draft:string;setDraft(value:string):void}){
  return <>
    <label htmlFor="version-name">Имя версии (необязательно)</label><input id="version-name" maxLength={256} autoComplete="off" value={draft} readOnly={blocked(operation)} onChange={e=>setDraft(e.target.value)}/>
    <Button type="submit" disabled={operation?.state==='pending'}>{operation?.state==='uncertain'?'Повторить создание версии':'Создать версию'}</Button>
    <StatusMessage id="version-result">{operation?.state==='success'?'Версия создана: '+operation.versionId:operation?.state==='pending'?'Создание версии…':''}</StatusMessage>
    <InlineError id="version-error">{operation?.error??''}</InlineError>
  </>;
}
function VersionList({state,operation,canEdit,restore,refresh,previous,next,retry}:{state:ListState;operation:RestoreOperation|undefined;canEdit:boolean;restore(v:Version):void;refresh():void;previous():void;next():void;retry():void}){
  return <>
    <h2 id="versions-title">Сохранённые версии</h2><p>Текущий общий черновик показан в редакторе; сохранённые версии остаются неизменными.</p>
    <Button id="versions-refresh" onClick={refresh}>Обновить историю</Button>
    <StatusMessage id="versions-status">{state.status}</StatusMessage><InlineError id="versions-error">{state.error}</InlineError>
    <ul id="versions-list" aria-label="История сохранённых версий">{state.versions.map(v=>{
      const date=new Date(v.timestamp),name=v.name?.trim()||'Без имени';
      return <li key={v.id}><span>{name+' · Автор: '+v.authorId+' · '+(Number.isNaN(date.valueOf())?v.timestamp:date.toLocaleString())+' · Ревизия '+v.revision}</span>
        {canEdit&&<>{' '}<Button disabled={blocked(operation)} aria-label={'Восстановить версию '+(v.name?.trim()||'без имени')+', ревизия '+v.revision} onClick={()=>restore(v)}>Восстановить</Button></>}</li>;
    })}</ul>
    <nav className="pagination" aria-label="Навигация по истории версий">
      <Button id="versions-previous" disabled={!state.loaded||state.loading||state.index===0} onClick={previous}>Предыдущие версии</Button>
      <span id="versions-number">{state.loaded?'Страница '+(state.index+1):''}</span>
      <Button id="versions-next" disabled={!state.loaded||state.loading||state.next===null} onClick={next}>Следующие версии</Button>
    </nav>
    <StatusMessage id="restore-status">{operation?.state==='pending'?'Восстановление версии…':operation?.state==='success'?'Версия восстановлена в общий черновик.':''}</StatusMessage>
    <InlineError id="restore-error">{operation?.error??''}</InlineError>
    <Button id="restore-retry" hidden={!canEdit||operation?.state!=='uncertain'} onClick={retry}>Повторить восстановление</Button>
  </>;
}
export function createDocumentHistory({element,request,pageSize,refreshPages,workspace}:Options){
  const versionOperations=new Map<string,SaveOperation>(),restoreOperations=new Map<string,RestoreOperation>(),historyActions=new Map<string,HistoryOperation>();
  const form=element('version-save'),section=element('versions-title').closest('section');
  if(!section)throw new Error('Missing version history host');
  const formRoot=createPanelRoot(form),listRoot=createPanelRoot(section);
  let state=initial(),draft='',generation=0,controller:AbortController|null=null,cursors:(number|null)[]=[null];
  const canEdit=()=>['Owner','Editor'].includes(workspace.documentRole??'');
  const get=<T,>(map:Map<string,T>):T|undefined=>workspace.documentId?map.get(workspace.documentId):undefined;
  const active=(id:string,token:string|null,epoch:number)=>workspace.documentId===id&&workspace.token===token&&workspace.navigationEpoch===epoch;
  function renderForm(){
    const operation=get(versionOperations);
    flushSync(()=>formRoot.render(<VersionForm operation={operation} draft={draft} setDraft={value=>{draft=value;renderForm();}}/>));
  }
  function renderList(patch:Partial<ListState>={}){
    state={...state,...patch};
    const operation=get(restoreOperations);
    flushSync(()=>listRoot.render(<VersionList state={state} operation={operation} canEdit={canEdit()} restore={beginRestore}
      refresh={()=>void loadVersions()} previous={()=>{if(state.index>0)void loadVersions(state.index-1,cursors[state.index-1]??null);}}
      next={()=>{if(state.next!==null)void loadVersions(state.index+1,state.next);}}
      retry={()=>{if(workspace.documentId&&operation?.state==='uncertain'&&canEdit())void submitRestore(workspace.documentId,operation);}}/>));
  }
  async function save(){
    const id=workspace.documentId,token=workspace.token,epoch=workspace.navigationEpoch;
    if(!id||!canEdit())return;
    let operation=versionOperations.get(id);
    if(operation?.state==='pending')return;
    if(operation?.state!=='uncertain'){operation={body:{commandId:crypto.randomUUID(),name:draft||null},state:'pending'};versionOperations.set(id,operation);}
    operation.state='pending';operation.error='';renderForm();
    try{
      const result=requiredRecord(await request('/api/v1/documents/'+encodeURIComponent(id)+'/commands/save',{method:'POST',body:JSON.stringify(operation.body)}));
      operation.versionId=text(result.versionId);if(!operation.versionId)throw new TypeError('Отсутствует идентификатор версии');operation.state='success';
    }catch(error){const uncertain=unknownResult(error);operation.state=uncertain?'uncertain':'failed';operation.error=uncertain?'Не удалось подтвердить создание версии. Повторите эту операцию: она могла выполниться.':errorMessage(error);}
    if(versionOperations.get(id)===operation&&active(id,token,epoch)&&token){renderForm();if(operation.state==='success')void loadVersions();}
  }
  form.addEventListener('submit',e=>{e.preventDefault();void save();});
  function button(id:string):HTMLButtonElement{const b=element(id);if(!(b instanceof HTMLButtonElement))throw new Error('Missing history button '+id);return b;}
  function renderAction(){
    const op=get(historyActions),writable=canEdit();
    button('undo').disabled=button('redo').disabled=!writable||blocked(op);
    element('history-access').textContent=writable?'Сочетания: Ctrl/⌘+Z, Ctrl/⌘+Shift+Z или Ctrl+Y.':'Только просмотр: отмена и повтор недоступны.';
    element('history-action-status').textContent=op?.state==='pending'?'Ожидание подтверждения…':op?.state==='success'?'Действие подтверждено.':'';
    element('history-action-error').textContent=op?.error??'';
    element('history-action-retry').hidden=!writable||op?.state!=='uncertain';
  }
  function beginAction(action:Action){
    const id=workspace.documentId;if(!id||element('editor-view').hidden||!canEdit()||blocked(historyActions.get(id)))return;
    const operation:HistoryOperation={action,commandId:crypto.randomUUID(),state:'pending'};
    historyActions.set(id,operation);void sendAction(id,operation);
  }
  async function sendAction(id:string,operation:HistoryOperation){
    if(operation.state==='pending'&&operation.sending)return;
    const token=workspace.token,epoch=workspace.navigationEpoch,current=()=>active(id,token,epoch)&&!element('editor-view').hidden;
    operation.sending=true;operation.state='pending';operation.error='';renderAction();
    try{
      const result=requiredRecord(await request('/api/v1/documents/'+encodeURIComponent(id)+'/commands/'+operation.action,{method:'POST',body:JSON.stringify({commandId:operation.commandId})}));
      if(!Number.isSafeInteger(result.revision)||text(result.commandId).toLowerCase()!==operation.commandId.toLowerCase()||text(result.documentId).toLowerCase()!==id.toLowerCase())throw new TypeError('Некорректное подтверждение');
      if(historyActions.get(id)!==operation)return;
      if(!current()){operation.state='uncertain';operation.error='Результат изменился после перехода. Повторите ту же команду для подтверждения.';return;}
      operation.state='success';renderAction();await refreshPages();
      if(current())renderAction();
    }catch(error){
      if(historyActions.get(id)!==operation)return;
      if(!current()||unknownResult(error)){operation.state='uncertain';operation.error='Результат неизвестен. Повторите ту же команду: она могла выполниться.';}
      else{operation.state='failed';const code=error instanceof ApiError?error.code:undefined;operation.error=code==='UNDO_NOT_APPLICABLE'?'Отмена неприменима к текущему состоянию: возможно, изменения несовместимы с последующими правками.':code==='REDO_NOT_APPLICABLE'?'Повтор неприменим к текущему состоянию: необходимые условия больше не выполняются.':errorMessage(error);}
    }finally{operation.sending=false;if(historyActions.get(id)===operation&&workspace.documentId===id&&workspace.token&&!element('editor-view').hidden)renderAction();}
  }
  button('undo').addEventListener('click',()=>beginAction('undo'));button('redo').addEventListener('click',()=>beginAction('redo'));
  button('history-action-retry').addEventListener('click',()=>{const op=get(historyActions);if(workspace.documentId&&op?.state==='uncertain'&&canEdit())void sendAction(workspace.documentId,op);});
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.isComposing||event.altKey||!(event.ctrlKey||event.metaKey))return;
    const target=event.target;
    if(target instanceof Element&&(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')||(target instanceof HTMLElement&&target.isContentEditable)))return;
    const key=event.key.toLowerCase(),action=key==='z'?(event.shiftKey?'redo':'undo'):key==='y'&&!event.shiftKey?'redo':null;
    if(!action||!workspace.documentId||element('editor-view').hidden||!canEdit())return;
    event.preventDefault();beginAction(action);
  });
  function reset(){
    controller?.abort();controller=null;generation++;form.hidden=true;cursors=[null];state=initial();draft='';renderForm();renderList();
  }
  async function loadVersions(index=0,cursor:number|null=null){
    const id=workspace.documentId,token=workspace.token,epoch=workspace.navigationEpoch;if(!id||!token)return;
    controller?.abort();const operation=new AbortController();controller=operation;
    const current=++generation,valid=()=>current===generation&&active(id,token,epoch)&&!operation.signal.aborted;
    renderList({status:'Загрузка истории…',error:'',loading:true});
    try{
      const query=new URLSearchParams({limit:String(pageSize)});if(cursor!==null)query.set('beforeRevision',String(cursor));
      const result=requiredRecord(await request('/api/v1/documents/'+encodeURIComponent(id)+'/versions?'+query,{},operation.signal));
      if(!valid())return;
      const versions=array(result.versions,decodeVersion),next=result.nextBeforeRevision==null?null:number(result.nextBeforeRevision);
      cursors[index]=cursor;cursors.length=index+1;
      renderList({versions,index,next,loaded:true,loading:false,status:versions.length?'Версий на странице: '+versions.length:'Сохранённых версий нет.'});
    }catch(error){if(valid()&&!aborted(error))renderList({versions:[],status:'',loading:false,loaded:false,error:error instanceof TypeError?'Не удалось загрузить историю. Проверьте соединение и обновите историю.':errorMessage(error)});}
  }
  function beginRestore(version:Version){
    const id=workspace.documentId;if(!id||!canEdit()||blocked(restoreOperations.get(id)))return;
    if(!confirm('Восстановить версию «'+(version.name?.trim()||'Без имени')+'» (ревизия '+version.revision+')? Будет создана новая ревизия общего черновика; история сохранённых версий не удалится.'))return;
    const op:RestoreOperation={state:'pending',body:{versionId:version.id,commandId:crypto.randomUUID()}};
    restoreOperations.set(id,op);void submitRestore(id,op);
  }
  async function submitRestore(id:string,op:RestoreOperation){
    const token=workspace.token,epoch=workspace.navigationEpoch;op.state='pending';op.error='';if(workspace.documentId===id)renderList();
    try{
      const result=requiredRecord(await request('/api/v1/documents/'+encodeURIComponent(id)+'/commands/restore',{method:'POST',body:JSON.stringify(op.body)}));
      number(result.revision);op.state='success';
    }catch(error){
      const uncertain=unknownResult(error);op.state=uncertain?'uncertain':'failed';
      op.error=uncertain?'Не удалось подтвердить восстановление. Повторите эту операцию: она могла выполниться.':error instanceof ApiError&&(error.code==='REVISION_CONFLICT'||error.status===409)?'Документ изменился или восстановление конфликтует с текущим состоянием. Обновите страницы и историю перед повтором.':errorMessage(error);
    }
    if(restoreOperations.get(id)!==op||!active(id,token,epoch)||!token)return;
    renderList();if(op.state==='success'&&!element('editor-view').hidden){await refreshPages();if(active(id,token,epoch)&&!element('editor-view').hidden)void loadVersions();}
  }
  function clearCommands(){versionOperations.clear();restoreOperations.clear();historyActions.clear();}
  function prepare(){form.hidden=!canEdit();draft=get(versionOperations)?.body.name??'';renderForm();}
  function load(){renderList();renderAction();return loadVersions();}
  renderForm();renderList();return {reset,clearCommands,prepare,load};
}
