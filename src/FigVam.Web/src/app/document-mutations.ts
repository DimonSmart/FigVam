import { ApiError, type ApiClient } from '../api/api-client';
import { errorMessage } from '../api/decode';
import type { DocumentListItem } from '../api/document-list';
import type { DeleteCatalogCommand } from '../features/home/document-list';
import { createDocumentCommand, prepareDocumentCommand, type DocumentCommandOperation } from '../api/document-commands';
import type { SessionLifecycle } from '../core/session';
import type { ApplicationShellModel } from './application-shell-state';
import { canEditDocument, type DocumentShellModel, type DeletionViewModel } from './document-shell-state';

type Deletion = {id:string;name:string;expectedRevision:number;operation:DocumentCommandOperation};
const statusOf=(error:unknown)=>error instanceof ApiError?error.status:undefined;
interface Options {
  sessionState:SessionLifecycle; shellState:ApplicationShellModel; documentShell:DocumentShellModel; deletionView:DeletionViewModel;
  request:ApiClient; getDocumentId():string|null; getRevision():number|null;
  loadList():Promise<void>;openDocument(id:string):Promise<void>;refresh(signal:AbortSignal,current:()=>boolean):Promise<unknown>;
  stopLive():void;startLive():void;message(status?:string,error?:string):void;setRetry(retry:()=>Promise<void>):void;
  navigateHome():void;confirmDeletion(message:string):boolean;
}
export function createDocumentMutations({sessionState,shellState,documentShell,deletionView,request,getDocumentId,getRevision,loadList,openDocument,refresh,stopLive,startLive,message,setRetry,navigateHome,confirmDeletion}:Options){
const getDocumentRole=()=>documentShell.getSnapshot().role;
let deletion: Deletion | null = null;
const catalogDeletions = new Map<string, {operation: DocumentCommandOperation; expectedRevision: number}>();
const renames = new Map<string, DocumentCommandOperation>();
function resetDeletion() {
  deletion = null;
  deletionView.publish({ status: 'idle', message: '' });
}
function leaveDeletion() {
  if (!deletion) return;
  const state = deletion.operation.getSnapshot();
  deletionView.publish({ status: 'uncertain', message: state.kind === 'confirmed'
    ? 'Удаление подтверждено. Обновите список документов.'
    : `Результат удаления документа «${deletion.name}» неизвестен. Повторите запрос, чтобы получить подтверждение; документ мог быть удалён.` });
}
async function deleteCatalogDocument(item: DocumentListItem, command: DeleteCatalogCommand): Promise<void> {
  const id = item.documentId, sessionEpoch = sessionState.sessionEpoch;
  let epoch = sessionState.navigationEpoch;
  const entry = catalogDeletions.get(id) ?? {operation:prepareDocumentCommand(id,'delete-document',command),expectedRevision:command.expectedRevision};
  catalogDeletions.set(id,entry);
  const active = () => sessionState.sessionEpoch === sessionEpoch && sessionState.navigationEpoch === epoch && catalogDeletions.get(id) === entry;
  const refresh = async () => {
    const loading = loadList(); epoch = sessionState.navigationEpoch; await loading;
    return active() && shellState.getSnapshot().catalog !== null;
  };
  const result = await entry.operation.execute({request,isCurrent:active,
    validate:confirmation=>{if(confirmation.revision!==entry.expectedRevision+1)throw new TypeError('Некорректная ревизия удаления');},
    synchronize:refresh});
  if (!active()) {
    if(catalogDeletions.get(id)===entry&&(result.kind==='rejected'||result.kind==='conflict'))catalogDeletions.delete(id);
    return;
  }
  if (result.kind === 'confirmed' && result.synchronization === 'synced') {
    catalogDeletions.delete(id); message('Документ удалён.');
  } else if (result.kind === 'conflict' || result.kind === 'rejected') {
    await refresh();
    if(active()){catalogDeletions.delete(id);message('',errorMessage(result.error));}
  } else if (result.kind === 'uncertain' || result.kind === 'confirmed') {
    setRetry(()=>deleteCatalogDocument(item,command));
    message('',result.kind==='confirmed'?'Удаление подтверждено. Повторите обновление списка.':'Результат удаления неизвестен. Повторите запрос: документ мог быть удалён.');
  }
}

function deleteDocument() {
  if (deletion || !getDocumentId() || getDocumentRole() !== 'Owner' || getRevision() === null || !Number.isSafeInteger(getRevision()) || shellState.getSnapshot().view !== 'editor') return;
  if (!confirmDeletion(`Удалить документ «${documentShell.getSnapshot().title}»? Это действие нельзя отменить.`)) return;
  const expectedRevision = getRevision()!;
  deletion = { id: getDocumentId()!, name: documentShell.getSnapshot().title ?? '', expectedRevision,
    operation: createDocumentCommand(getDocumentId()!,'delete-document',{expectedRevision}) };
  void submitDeletion(deletion);
}
function retryDeletion() {
  if(!deletion)return;
  const state=deletion.operation.getSnapshot();
  if(state.kind==='uncertain'||state.kind==='confirmed')void submitDeletion(deletion);
}
async function submitDeletion(entry: Deletion): Promise<void> {
  if (deletion !== entry || entry.operation.getSnapshot().kind === 'pending') return;
  const id=entry.id,sessionEpoch=sessionState.sessionEpoch;
  let epoch=sessionState.navigationEpoch;
  const active=()=>deletion===entry&&sessionState.sessionEpoch===sessionEpoch&&epoch===sessionState.navigationEpoch;
  stopLive();
  deletionView.publish({status:'pending',message:'Удаление документа…'});
  const refresh=async()=>{
    navigateHome();
    const loading=loadList();epoch=sessionState.navigationEpoch;await loading;
    return active()&&shellState.getSnapshot().catalog!==null;
  };
  const result=await entry.operation.execute({request,isCurrent:active,
    validate:confirmation=>{if(confirmation.revision!==entry.expectedRevision+1)throw new TypeError('Некорректная ревизия удаления');},
    synchronize:refresh});
  if(!active()){
    if(deletion===entry&&sessionState.sessionEpoch===sessionEpoch){
      if(result.kind==='rejected'||result.kind==='conflict')resetDeletion();
      else if(result.kind==='confirmed')deletionView.publish({status:'uncertain',message:'Удаление подтверждено. Обновите список документов.'});
    }
    return;
  }
  if(result.kind==='confirmed'&&result.synchronization==='synced'){
    resetDeletion();message('Документ удалён.');return;
  }
  if(result.kind==='confirmed'||result.kind==='uncertain'){
    if(getDocumentId()===id)shellState.patch({view:'none'});
    deletionView.publish({status:'uncertain',message:result.kind==='confirmed'?'Удаление подтверждено. Повторите обновление списка.':'Результат удаления неизвестен. Повторите запрос, чтобы получить подтверждение; документ мог быть удалён.'});
    return;
  }
  if(result.kind==='conflict'||result.kind==='rejected'){
    const error=result.error,status=statusOf(error);
    resetDeletion();
    if(status===403||status===404){
      const explanation=status===403?'Нет прав на удаление документа или доступ к нему потерян.':'Документ уже удалён или больше недоступен.';
      navigateHome();const loading=loadList(),nextEpoch=sessionState.navigationEpoch;await loading;
      if(sessionState.sessionEpoch===sessionEpoch&&nextEpoch===sessionState.navigationEpoch)message('',explanation);
    }else if(result.kind==='conflict'){
      const reopening=openDocument(id),nextEpoch=sessionState.navigationEpoch;await reopening;
      if(sessionState.sessionEpoch===sessionEpoch&&nextEpoch===sessionState.navigationEpoch&&getDocumentId()===id)message('','Документ изменился. Проверьте обновлённую ревизию и повторите удаление.');
    }else{message('',errorMessage(error));startLive();}
  }
}

async function renameDocument() {
  if (documentShell.getSnapshot().renameBusy || !getDocumentId() || !canEditDocument(getDocumentRole())) return;
  const id=getDocumentId()!, epoch=sessionState.navigationEpoch, sessionEpoch=sessionState.sessionEpoch;
  const operation=renames.get(id)??createDocumentCommand(id,'rename-document',{name:documentShell.getSnapshot().renameName});
  renames.set(id,operation);
  const active=()=>renames.get(id)===operation&&sessionState.sessionEpoch===sessionEpoch&&sessionState.navigationEpoch===epoch&&getDocumentId()===id&&canEditDocument(getDocumentRole());
  stopLive();
  documentShell.patch({renameBusy:true,renameStatus:'Сохранение имени…',renameError:''});
  try{
    const result=await operation.execute({request,isCurrent:active,synchronize:async confirmation=>{
      const synchronized=await refresh(sessionState.signal,active);
      return synchronized===true&&(getRevision()??-1)>=confirmation.revision;
    }});
    if(!active()){
      if(renames.get(id)===operation&&(result.kind==='rejected'||result.kind==='conflict'))renames.delete(id);
      return;
    }
    if(result.kind==='confirmed'&&result.synchronization==='synced'){
      renames.delete(id);documentShell.patch({renameName:documentShell.getSnapshot().title,renameStatus:'Имя документа изменено.'});
    }else if(result.kind==='conflict'||result.kind==='rejected'){
      renames.delete(id);documentShell.patch({renameStatus:'',renameError:errorMessage(result.error)});
    }else if(result.kind==='uncertain'||result.kind==='confirmed'){
      documentShell.patch({renameStatus:'',renameError:result.kind==='confirmed'?'Команда подтверждена. Повторите обновление документа.':'Результат неизвестен. Повторите сохранение с исходным именем.'});
    }
  }finally{
    if(sessionState.sessionEpoch===sessionEpoch&&sessionState.navigationEpoch===epoch&&getDocumentId()===id){
      documentShell.patch({renameBusy:false});startLive();
    }
  }
}

return {deleteCatalogDocument,deleteDocument,retryDeletion,renameDocument,leaveDeletion,get deletingId(){return deletion?.id??null;},discardDocument(id:string){catalogDeletions.delete(id);renames.delete(id);if(deletion?.id===id)resetDeletion();},clear(){catalogDeletions.clear();renames.clear();resetDeletion();}};
}
