import { prepareDocumentCommand, type DocumentCommandOperation } from '../../api/document-commands';
import { InlineError, StatusMessage } from '../../ui/Feedback';
import { TextInput } from '../../ui/Inputs';
import { createViewModel } from '../../app/view-model';
import { Button } from '../../ui/Button';
import { Pagination } from '../../ui/Pagination';
import { ApiError, type ApiClient } from '../../api/api-client';
import { requiredRecord, text, page, errorMessage, aborted } from '../../api/decode';
import type { components } from '../../api/schema.generated';

type Schemas = components['schemas'];
type DatasetCommand =
  | {command:'add-dataset';body:Schemas['AddDatasetRequest']}
  | {command:'add-csv-dataset';body:Schemas['AddCsvDatasetRequest']}
  | {command:'replace-dataset-fixture';body:Schemas['ReplaceDatasetFixtureRequest']}
  | {command:'replace-dataset-fixture-from-csv';body:Schemas['ReplaceDatasetFixtureFromCsvRequest']}
  | {command:'delete-dataset';body:Schemas['DeleteDatasetRequest']};
type Operation={mutation:DocumentCommandOperation;selection:string|null;selectionEpoch:number;busy:boolean};
type Summary=Pick<Schemas['DatasetSummary'],'id'|'name'>;
interface Context {documentId:string|null;documentRole:string|null;revision:number|null;catalogRevision:number|null;token:string|null;generation:number;navigationEpoch:number}
interface Options {
  model:ReturnType<typeof createDatasetsModel>;request:ApiClient;getContext():Context;pageSize:number;
  startRequest():{signal:AbortSignal;current:number};stopLive():void;startLive():void;
  readPages(signal:AbortSignal):Promise<unknown>;
  run(action:()=>Promise<unknown>,work:(signal:AbortSignal)=>Promise<unknown>):Promise<unknown>;
}
interface State {items:Summary[];selection:string|null;detail:{name:string;fixture:string}|null;offset:number;total:number;status:string;error:string;retry:boolean;formKey:number}
const initial=():State=>({items:[],selection:null,detail:null,offset:0,total:0,status:'',error:'',retry:false,formKey:0});
function value(form:HTMLFormElement,name:string):string{
  const input=form.elements.namedItem(name);
  return input instanceof HTMLInputElement||input instanceof HTMLSelectElement||input instanceof HTMLTextAreaElement?input.value:'';
}
function Format({id,label}:{id:string;label:string}){return <><label htmlFor={id}>{label}</label><select id={id} name="format"><option value="json">JSON</option><option value="csv">CSV</option></select></>;}
function View({state,editable,op,pageSize,select,move,reload,retryCommand,create,replace,remove}:{
  state:State;editable:boolean;op:Operation|undefined;pageSize:number;select(id:string):void;move(delta:number):void;reload():void;retryCommand():void;
  create(name:string,csv:boolean,content:string):void;replace(csv:boolean,content:string):void;remove():void;
}){
  return <>
    <h2 id="datasets-title">Локальные датасеты</h2>
    <StatusMessage id="datasets-status">{state.status}</StatusMessage><InlineError id="datasets-error">{state.error}</InlineError>
    <Button id="datasets-retry" hidden={!state.retry} onClick={reload}>Повторить загрузку датасетов</Button>
    <ul id="datasets-list" aria-label="Датасеты документа">{state.items.map(item=><li key={item.id}><Button aria-pressed={state.selection===item.id} onClick={()=>select(item.id)}>{item.name}</Button></li>)}</ul>
    <Pagination prefix="datasets" label="Навигация по датасетам" previousLabel="Предыдущие датасеты" nextLabel="Следующие датасеты" offset={state.offset} total={state.total} pageSize={pageSize} previous={()=>move(-1)} next={()=>move(1)}/>
    <div id="dataset-detail" hidden={!state.detail}><h3 id="dataset-title">{state.detail?.name}</h3><p>Сохранённая JSON-фикстура:</p><pre id="dataset-fixture" tabIndex={0}>{state.detail?.fixture}</pre></div>
    <div id="dataset-edit" hidden={!editable} inert={!!op} key={state.formKey}>
      <form id="dataset-create" onSubmit={e=>{e.preventDefault();create(value(e.currentTarget,'name'),value(e.currentTarget,'format')==='csv',value(e.currentTarget,'content'));}}>
        <h3>Новый датасет</h3><label htmlFor="dataset-name">Имя датасета</label><TextInput id="dataset-name" name="name" required maxLength={256}/>
        <Format id="dataset-create-format" label="Формат нового снимка"/>
        <label htmlFor="dataset-create-content">Содержимое нового снимка</label><textarea id="dataset-create-content" name="content" required/><Button type="submit">Создать датасет</Button>
      </form>
      <form id="dataset-replace" hidden={!state.selection} onSubmit={e=>{e.preventDefault();replace(value(e.currentTarget,'format')==='csv',value(e.currentTarget,'content'));}}>
        <h3>Заменить фикстуру</h3><Format id="dataset-replace-format" label="Формат замены"/>
        <label htmlFor="dataset-replace-content">Содержимое замены</label><textarea id="dataset-replace-content" name="content" required/><Button type="submit">Заменить фикстуру</Button>
      </form><Button id="dataset-delete" hidden={!state.selection} onClick={remove}>Удалить датасет</Button>
    </div><Button id="dataset-command-retry" hidden={!op||op.busy} onClick={retryCommand}>Повторить операцию с датасетом</Button>
  </>;
}
export function createDatasetsModel(){return createViewModel(View);}
export function createDatasets({model,request,getContext,pageSize,startRequest,stopLive,startLive,readPages,run}:Options){
  const operations=new Map<string,Operation>();let state=initial(),generation=0,selectionEpoch=0;
  let readController:AbortController|null=null;
  const editable=()=>['Owner','Editor'].includes(getContext().documentRole??'');
  function render(patch:Partial<State>={}){
    state={...state,...patch};const doc=getContext().documentId,op=doc?operations.get(doc):undefined;
    model.publish({state,editable:editable(),op,pageSize,
      select:id=>{selectionEpoch++;state.selection=id;void load();},move:delta=>{state.offset=Math.max(0,state.offset+delta*pageSize);void load();},
      reload:()=>{if(getContext().documentId)void run(load,readPages);},retryCommand:()=>{if(op)void command(op);},
      create,replace,remove});
  }
  function reset(){readController?.abort();readController=null;generation++;selectionEpoch++;state={...initial(),formKey:state.formKey+1};render();}
  async function load():Promise<void>{
    readController?.abort();const controller=new AbortController();readController=controller;
    const {documentId:doc,revision,catalogRevision}=getContext(),current=++generation;
    if(!doc||revision===null||!Number.isSafeInteger(revision))return;
    const valid=()=>!controller.signal.aborted&&current===generation&&doc===getContext().documentId&&catalogRevision===getContext().catalogRevision;
    const base='/api/v1/documents/'+encodeURIComponent(doc)+'/datasets';
    render({status:'Загрузка датасетов…',error:'',retry:false,items:[],detail:null});
    try{
      const response=await request(base+'?revision='+revision+'&offset='+state.offset+'&limit='+pageSize,{},controller.signal,valid);
      if(!valid())return;
      const result=page(response,item=>{const i=requiredRecord(item);return{id:text(i.id),name:text(i.name)};});
      if(state.offset&&!result.items.length){state.offset=Math.max(0,state.offset-pageSize);return load();}
      render({items:result.items,total:result.total,status:result.total?'Датасетов: '+result.total+' · ревизия '+revision:'Датасетов пока нет.'});
      if(state.selection){
        const path=base+'/'+encodeURIComponent(state.selection);
        const [detail,fixture]=await Promise.all([request(path+'?revision='+revision,{},controller.signal,valid),request(path+'/fixture?revision='+revision,{},controller.signal,valid)]);
        if(!valid())return;
        render({detail:{name:text(requiredRecord(requiredRecord(detail).dataset).name),fixture:text(requiredRecord(fixture).fixtureJson)}});
      }
      const pending=operations.get(doc);
      if(pending&&!pending.busy)render({error:'Результат операции неизвестен или обновление не завершено. Повторите операцию.'});
    }catch(error){if(valid()&&!aborted(error))render({status:'',error:errorMessage(error),retry:true});}
  }
  async function command(op:Operation){
    const ctx=getContext(),doc=ctx.documentId;
    if(!doc||!editable()||op.busy||operations.get(doc)!==op)return;
    const active=()=>{const now=getContext();return operations.get(doc)===op&&now.documentId===doc&&now.token===ctx.token&&now.navigationEpoch===ctx.navigationEpoch&&editable();};
    op.busy=true;render({error:'',status:'Сохранение датасета…'});
    let refreshing=false;
    try{
      const result=await op.mutation.execute({request,isCurrent:active,synchronize:async confirmation=>{
        stopLive();refreshing=true;const {signal,current}=startRequest();
        if(selectionEpoch===op.selectionEpoch)state.selection=op.selection;
        const refreshed=await readPages(signal);
        return active()&&current===getContext().generation&&!signal.aborted&&refreshed===true&&(getContext().revision??-1)>=confirmation.revision;
      }});
      if(operations.get(doc)!==op)return;
      if(result.kind==='confirmed'&&result.synchronization==='synced'){
        operations.delete(doc);if(active()||getContext().documentId===doc&&getContext().navigationEpoch===ctx.navigationEpoch)render({status:'Изменение сохранено.'});
      }else if(result.kind==='rejected'||result.kind==='conflict'){
        const visible=active(),error=result.error;operations.delete(doc);
        if(visible){
          const code=error instanceof ApiError?error.code:undefined;
          if(code==='REVISION_CONFLICT')render({status:'',error:'Документ изменился. Обновите датасеты перед повтором.',retry:true});
          else if(code==='DATASET_IN_USE')render({status:'',error:'Датасет используется. Удалите ссылки перед удалением.'});
          else render({status:'',error:errorMessage(error)});
        }
      }else if(active()&&(result.kind==='confirmed'||result.kind==='uncertain')){
        render({status:'',error:result.kind==='confirmed'?'Изменение подтверждено. Повторите обновление.':'Результат операции неизвестен. Повторите операцию с тем же идентификатором.'});
      }
    }finally{
      op.busy=false;
      if(getContext().documentId===doc&&getContext().token===ctx.token&&getContext().navigationEpoch===ctx.navigationEpoch){render();if(refreshing)startLive();}
    }
  }
  function submit(commandValue:DatasetCommand,selection:string|null){
    const doc=getContext().documentId;if(!doc||operations.has(doc))return;
    const mutation=prepareDocumentCommand(doc,commandValue.command,commandValue.body);
    const op:Operation={mutation,selection,selectionEpoch,busy:false};
    operations.set(doc,op);void command(op);
  }
  function create(name:string,csv:boolean,content:string){
    const datasetId=crypto.randomUUID(),base={commandId:crypto.randomUUID(),datasetId,name};
    submit(csv?{command:'add-csv-dataset',body:{...base,csv:content}}:{command:'add-dataset',body:{...base,fixtureJson:content}},datasetId);
  }
  function replace(csv:boolean,content:string){
    const revision=getContext().revision,datasetId=state.selection;if(revision===null||!datasetId)return;
    const base={commandId:crypto.randomUUID(),datasetId,expectedRevision:revision};
    submit(csv?{command:'replace-dataset-fixture-from-csv',body:{...base,csv:content}}:{command:'replace-dataset-fixture',body:{...base,fixtureJson:content}},datasetId);
  }
  function remove(){
    const revision=getContext().revision,datasetId=state.selection;if(revision===null||!datasetId||!confirm('Удалить датасет «'+(state.detail?.name??'')+'»?'))return;
    submit({command:'delete-dataset',body:{commandId:crypto.randomUUID(),datasetId,expectedRevision:revision}},null);
  }
  render();return{reset,load,clearCommands:()=>operations.clear(),discardDocument:(doc:string)=>operations.delete(doc),refreshAccess:()=>render()};
}
