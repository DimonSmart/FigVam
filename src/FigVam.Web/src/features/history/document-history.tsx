import { prepareDocumentCommand, type DocumentCommandOperation, type CommandState } from '../../api/document-commands';
import { Undo2, Redo2 } from 'lucide-react';
import { IconButton } from '../../ui/IconButton';
import { InlineError, StatusMessage } from '../../ui/Feedback';
import { createViewModel } from '../../app/view-model';
import { Button } from '../../ui/Button';
import { ApiError, type ApiClient } from '../../api/api-client';
import { requiredRecord, text, array, errorMessage, aborted } from '../../api/decode';
import type { components } from '../../api/schema.generated';

type Action='undo'|'redo';
type Status='pending'|'uncertain'|'sync'|'failed'|'success';
type Schema=components['schemas'];
interface Operation {state:Status;error?:string;mutation:DocumentCommandOperation}
interface SaveOperation extends Operation {body:Schema['SaveDocumentRequest'];versionId?:string}
interface RestoreOperation extends Operation {body:Schema['RestoreDocumentRequest']}
interface HistoryOperation extends Operation {action:Action;commandId:string;sending?:boolean}
interface Workspace { isEditorVisible(): boolean; documentId:string|null;documentRole:string|null;navigationEpoch:number;token:string|null;revision:number|null}
interface Options {models:ReturnType<typeof createDocumentHistoryModels>;request:ApiClient;pageSize:number;refreshPages():Promise<boolean>;workspace:Workspace}
interface Version {id:string;name:string|null;authorId:string;timestamp:string;revision:number}
interface ListState {versions:Version[];status:string;error:string;index:number;next:number|null;loading:boolean;loaded:boolean}
const initial=():ListState=>({versions:[],status:'',error:'',index:0,next:null,loading:false,loaded:false});
const retryable=(op:Operation|undefined)=>op?.state==='uncertain'||op?.state==='sync';
const blocked=(op:Operation|undefined)=>op?.state==='pending'||retryable(op);
function updateOperation(op:Operation,result:CommandState){
  if(result.kind==='confirmed'){op.state=result.synchronization==='synced'?'success':'sync';op.error=op.state==='sync'?'Команда подтверждена. Повторите только обновление документа.':'';}
  else if(result.kind==='uncertain'){op.state='uncertain';op.error='Результат неизвестен. Повторите ту же команду: она могла выполниться.';}
  else if(result.kind==='conflict'||result.kind==='rejected'){op.state='failed';op.error=errorMessage(result.error);}
}
function number(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value))throw new TypeError('Некорректная ревизия');return value;}
function decodeVersion(value:unknown):Version{const v=requiredRecord(value);return{id:text(v.id),name:v.name==null?null:text(v.name),authorId:text(v.authorId),timestamp:text(v.timestamp),revision:number(v.revision)};}
function VersionForm({operation,draft,setDraft}:{operation:SaveOperation|undefined;draft:string;setDraft(value:string):void}){
  return <>
    <label htmlFor="version-name">Имя версии (необязательно)</label><input id="version-name" maxLength={256} autoComplete="off" value={draft} readOnly={blocked(operation)} onChange={e=>setDraft(e.target.value)}/>
    <Button type="submit" disabled={operation?.state==='pending'}>{operation?.state==='sync'?'Повторить обновление':operation?.state==='uncertain'?'Повторить создание версии':'Создать версию'}</Button>
    <StatusMessage id="version-result">{(operation?.state==='success'||operation?.state==='sync')&&operation.versionId?'Версия создана: '+operation.versionId:operation?.state==='pending'?'Создание версии…':''}</StatusMessage>
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
    <StatusMessage id="restore-status">{operation?.state==='pending'?'Восстановление версии…':operation?.state==='success'||operation?.state==='sync'?'Версия восстановлена в общий черновик.':''}</StatusMessage>
    <InlineError id="restore-error">{operation?.error??''}</InlineError>
    <Button id="restore-retry" hidden={!canEdit||!retryable(operation)} onClick={retry}>Повторить восстановление</Button>
  </>;
}
function VersionSaveView({visible,save,...props}:{visible:boolean;save():void}&Parameters<typeof VersionForm>[0]){
  return <form id="version-save" hidden={!visible} onSubmit={event=>{event.preventDefault();save();}}><VersionForm {...props}/></form>;
}
interface HistoryActionsViewProps {disabled:boolean;access:string;status:string;error:string;retryVisible:boolean;begin(action:Action):void;retry():void}
function HistoryToolbar({disabled,begin}:Pick<HistoryActionsViewProps,'disabled'|'begin'>){
  return <><IconButton id="undo" className="icon-action" icon={Undo2} iconSize={18} label="Отменить действие" disabled={disabled} onClick={()=>begin('undo')}/><IconButton id="redo" className="icon-action" icon={Redo2} iconSize={18} label="Повторить действие" disabled={disabled} onClick={()=>begin('redo')}/></>;
}
function HistoryFeedback({access,status,error,retryVisible,retry}:Omit<HistoryActionsViewProps,'disabled'|'begin'>){
  return <><span id="history-access">{access}</span><StatusMessage id="history-action-status">{status}</StatusMessage><InlineError id="history-action-error">{error}</InlineError><Button id="history-action-retry" hidden={!retryVisible} onClick={retry}>Повторить операцию</Button></>;
}
export function createDocumentHistoryModels(){return {form:createViewModel(VersionSaveView),list:createViewModel(VersionList),toolbar:createViewModel(HistoryToolbar),feedback:createViewModel(HistoryFeedback)};}
export function createDocumentHistory({models,request,pageSize,refreshPages,workspace}:Options){
  const versionOperations=new Map<string,SaveOperation>(),restoreOperations=new Map<string,RestoreOperation>(),historyActions=new Map<string,HistoryOperation>();
  let visible=false;
  let state=initial(),draft='',generation=0,controller:AbortController|null=null,cursors:(number|null)[]=[null];
  const canEdit=()=>['Owner','Editor'].includes(workspace.documentRole??'');
  const get=<T,>(map:Map<string,T>):T|undefined=>workspace.documentId?map.get(workspace.documentId):undefined;
  const active=(id:string,token:string|null,epoch:number)=>workspace.documentId===id&&workspace.token===token&&workspace.navigationEpoch===epoch;
  function renderForm(){
    const operation=get(versionOperations);
    models.form.publish({visible,operation,draft,setDraft:value=>{draft=value;renderForm();},save:()=>void save()});
  }
  function renderList(patch:Partial<ListState>={}){
    state={...state,...patch};
    const operation=get(restoreOperations);
    models.list.publish({state,operation,canEdit:canEdit(),restore:beginRestore,
      refresh:()=>void loadVersions(),previous:()=>{if(state.index>0)void loadVersions(state.index-1,cursors[state.index-1]??null);},
      next:()=>{if(state.next!==null)void loadVersions(state.index+1,state.next);},
      retry:()=>{if(workspace.documentId&&operation&&retryable(operation)&&canEdit())void submitRestore(workspace.documentId,operation);}});
  }
  async function save(){
    const id=workspace.documentId,token=workspace.token,epoch=workspace.navigationEpoch;
    if(!id||!canEdit())return;
    let operation=versionOperations.get(id);
    if(operation?.state==='pending')return;
    if(!operation||!retryable(operation)){const body={commandId:crypto.randomUUID(),name:draft||null};operation={body,mutation:prepareDocumentCommand(id,'save',body),state:'pending'};versionOperations.set(id,operation);}
    const op=operation;
    const current=()=>versionOperations.get(id)===op&&active(id,token,epoch)&&canEdit();
    op.state='pending';op.error='';renderForm();
    const result=await op.mutation.execute({request,isCurrent:current,
      validate:ack=>{if(!ack.versionId)throw new TypeError('Отсутствует идентификатор версии');},
      synchronize:async ack=>{op.versionId=ack.versionId??undefined;return loadVersions();}});
    if(result.kind==='confirmed')op.versionId=result.confirmation.versionId??undefined;
    updateOperation(op,result);
    if(get(versionOperations)===op&&workspace.isEditorVisible()){
      renderForm();if(!current()&&result.kind==='confirmed'&&result.synchronization!=='synced')void load();
    }
  }
  function renderAction(){
    const op=get(historyActions),writable=canEdit();
    models.toolbar.publish({disabled:!writable||blocked(op),begin:beginAction});
    models.feedback.publish({access:writable?'Сочетания: Ctrl/⌘+Z, Ctrl/⌘+Shift+Z или Ctrl+Y.':'Только просмотр: отмена и повтор недоступны.',
      status:op?.state==='pending'?'Ожидание подтверждения…':op?.state==='success'?'Действие подтверждено.':'',error:op?.error??'',
      retryVisible:writable&&retryable(op),retry:retryAction});
  }
  function beginAction(action:Action){
    const id=workspace.documentId;if(!id||!workspace.isEditorVisible()||!canEdit()||blocked(historyActions.get(id)))return;
    const commandId=crypto.randomUUID();
    const operation:HistoryOperation={action,commandId,mutation:prepareDocumentCommand(id,action,{commandId}),state:'pending'};
    historyActions.set(id,operation);void sendAction(id,operation);
  }
  async function sendAction(id:string,operation:HistoryOperation){
    if(operation.state==='pending'&&operation.sending)return;
    const token=workspace.token,epoch=workspace.navigationEpoch,current=()=>active(id,token,epoch)&&workspace.isEditorVisible();
    operation.sending=true;operation.state='pending';operation.error='';renderAction();
    try{
      const result=await operation.mutation.execute({request,isCurrent:()=>current()&&historyActions.get(id)===operation&&canEdit(),synchronize:refreshPages});
      updateOperation(operation,result);
      if(result.kind==='rejected'||result.kind==='conflict'){
        const code=result.error instanceof ApiError?result.error.code:undefined;
        if(code==='UNDO_NOT_APPLICABLE')operation.error='Отмена неприменима к текущему состоянию: возможно, изменения несовместимы с последующими правками.';
        if(code==='REDO_NOT_APPLICABLE')operation.error='Повтор неприменим к текущему состоянию: необходимые условия больше не выполняются.';
      }
    }finally{operation.sending=false;if(historyActions.get(id)===operation&&workspace.documentId===id&&workspace.token&&workspace.isEditorVisible())renderAction();}
  }
  function retryAction(){const op=get(historyActions);if(workspace.documentId&&op&&retryable(op)&&canEdit())void sendAction(workspace.documentId,op);}
  const lifetime=new AbortController();
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.isComposing||event.altKey||!(event.ctrlKey||event.metaKey))return;
    const target=event.target;
    if(target instanceof Element&&(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')||(target instanceof HTMLElement&&target.isContentEditable)))return;
    const key=event.key.toLowerCase(),action=key==='z'?(event.shiftKey?'redo':'undo'):key==='y'&&!event.shiftKey?'redo':null;
    if(!action||!workspace.documentId||!workspace.isEditorVisible()||!canEdit())return;
    event.preventDefault();beginAction(action);
  },{signal:lifetime.signal});
  function reset(){
    controller?.abort();controller=null;generation++;visible=false;cursors=[null];state=initial();draft='';renderForm();renderList();renderAction();
  }
  async function loadVersions(index=0,cursor:number|null=null){
    const id=workspace.documentId,token=workspace.token,epoch=workspace.navigationEpoch;if(!id||!token)return false;
    controller?.abort();const operation=new AbortController();controller=operation;
    const current=++generation,valid=()=>current===generation&&active(id,token,epoch)&&!operation.signal.aborted;
    renderList({status:'Загрузка истории…',error:'',loading:true});
    try{
      const query=new URLSearchParams({limit:String(pageSize)});if(cursor!==null)query.set('beforeRevision',String(cursor));
      const result=requiredRecord(await request('/api/v1/documents/'+encodeURIComponent(id)+'/versions?'+query,{},operation.signal));
      if(!valid())return false;
      const versions=array(result.versions,decodeVersion),next=result.nextBeforeRevision==null?null:number(result.nextBeforeRevision);
      cursors[index]=cursor;cursors.length=index+1;
      renderList({versions,index,next,loaded:true,loading:false,status:versions.length?'Версий на странице: '+versions.length:'Сохранённых версий нет.'});
      return true;
    }catch(error){if(valid()&&!aborted(error))renderList({versions:[],status:'',loading:false,loaded:false,error:error instanceof TypeError?'Не удалось загрузить историю. Проверьте соединение и обновите историю.':errorMessage(error)});return false;}
  }
  function beginRestore(version:Version){
    const id=workspace.documentId;if(!id||!canEdit()||blocked(restoreOperations.get(id)))return;
    if(!confirm('Восстановить версию «'+(version.name?.trim()||'Без имени')+'» (ревизия '+version.revision+')? Будет создана новая ревизия общего черновика; история сохранённых версий не удалится.'))return;
    const body={versionId:version.id,commandId:crypto.randomUUID()};
    const op:RestoreOperation={state:'pending',body,mutation:prepareDocumentCommand(id,'restore',body)};
    restoreOperations.set(id,op);void submitRestore(id,op);
  }
  async function submitRestore(id:string,op:RestoreOperation){
    const token=workspace.token,epoch=workspace.navigationEpoch;op.state='pending';op.error='';if(workspace.documentId===id)renderList();
    const current=()=>restoreOperations.get(id)===op&&active(id,token,epoch)&&canEdit();
    const result=await op.mutation.execute({request,isCurrent:current,synchronize:async()=>{
      if(!await refreshPages()||!current())return false;
      return loadVersions();
    }});
    updateOperation(op,result);
    if(result.kind==='conflict')op.error='Восстановление конфликтует с текущим состоянием документа. Обновите документ перед повтором.';
    if(get(restoreOperations)===op&&workspace.isEditorVisible()){
      renderList();if(!current()&&result.kind==='confirmed'&&result.synchronization!=='synced')void load();
    }
  }
  function clearCommands(){versionOperations.clear();restoreOperations.clear();historyActions.clear();}
  function prepare(){visible=canEdit();draft=get(versionOperations)?.body.name??'';renderForm();renderAction();}
  async function load(){
    const id=workspace.documentId,token=workspace.token,epoch=workspace.navigationEpoch;
    renderForm();renderList();renderAction();
    const loaded=await loadVersions();
    if(!loaded||!id||!active(id,token,epoch)||!canEdit())return loaded;
    const saved=versionOperations.get(id),restored=restoreOperations.get(id);
    // Reopening has already read a current structure and version history. Reconcile
    // confirmed operations with these reads, without sending the write again.
    for(const op of [saved,restored]){
      if(!op||op.state!=='sync')continue;
      const ack=op.mutation.getSnapshot();
      if(ack.kind!=='confirmed'||(op===restored&&(workspace.revision??-1)<ack.confirmation.revision))continue;
      const current=()=>active(id,token,epoch)&&canEdit()&&(op===saved?versionOperations.get(id)===op:restoreOperations.get(id)===op);
      const result=await op.mutation.execute({request,isCurrent:current,synchronize:async()=>true});
      if(current())updateOperation(op,result);
    }
    if(active(id,token,epoch)){renderForm();renderList();}
    return loaded;
  }
  renderForm();renderList();return {reset,clearCommands,prepare,load,dispose(){lifetime.abort();controller?.abort();clearCommands();}};
}
