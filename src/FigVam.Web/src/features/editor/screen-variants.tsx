import { prepareDocumentCommand, type DocumentCommandOperation } from '../../api/document-commands';
import { InlineError, StatusMessage } from '../../ui/Feedback';
import { TextInput } from '../../ui/Inputs';
import { createViewModel } from '../../app/view-model';
import { Button } from '../../ui/Button';
import { Pagination } from '../../ui/Pagination';
import type { ApiClient } from '../../api/api-client';
import { requiredRecord, text, page, aborted, errorMessage } from '../../api/decode';
import type { components } from '../../api/schema.generated';
type VariantCommand=components['schemas']['AddScreenVariantRequest'];
interface Variant {id:string;name:string}
interface Workspace { isEditorVisible(): boolean; documentId:string|null;documentRole:string|null;selectedScreen:string|null;revision:number|null;catalogRevision:number|null;token:string|null;navigationEpoch:number}
interface Options {model:ReturnType<typeof createScreenVariantsModel>;element(id:string):HTMLElement;request:ApiClient;refreshPages():Promise<unknown>;onSelectionChanged?():void;pageSize:number;workspace:Workspace}
interface Operation {body:VariantCommand;mutation:DocumentCommandOperation;selectionEpoch:number;state:'ready'|'pending'|'uncertain'|'sync'}
interface State {items:Variant[];status:string;error:string;retry:boolean;offset:number;total:number;formKey:number;hasBase:boolean}
const initial=():State=>({items:[],status:'Выберите экран.',error:'',retry:false,offset:0,total:0,formKey:0,hasBase:false});
function View({state,selected,editable,enabled,op,pageSize,select,create,retry,retryCommand,move}:{state:State;selected:string|null;editable:boolean;enabled:boolean;op:Operation|undefined;pageSize:number;select(id:string|null):void;create(name:string):void;retry():void;retryCommand():void;move(delta:number):void}){
  return <>
    <h2 id="screen-variants-title">Варианты экрана</h2>
    <StatusMessage id="screen-variants-status">{state.status}</StatusMessage><InlineError id="screen-variants-error">{state.error}</InlineError>
    <Button id="screen-variants-retry" hidden={!state.retry} onClick={retry}>Повторить загрузку вариантов</Button>
    <ul id="screen-variants-list" aria-label="Варианты экрана">
      {state.hasBase&&<li><Button data-variant-id="" aria-pressed={selected===null} onClick={()=>select(null)}>Базовое состояние (Base)</Button></li>}
      {state.items.map(item=><li key={item.id}><Button data-variant-id={item.id} aria-pressed={selected===item.id} onClick={()=>select(item.id)}>{item.name}</Button></li>)}
    </ul>
    <Pagination prefix="screen-variants" label="Навигация по вариантам экрана" previousLabel="Предыдущие варианты" nextLabel="Следующие варианты" offset={enabled?state.offset:0} total={enabled?state.total:0} pageSize={pageSize} previous={()=>move(-1)} next={()=>move(1)}/>
    <form id="screen-variant-create" hidden={!editable} key={state.formKey} onSubmit={e=>{e.preventDefault();const field=e.currentTarget.elements.namedItem('name');if(field instanceof HTMLInputElement)create(field.value);}}>
      <label htmlFor="screen-variant-name">Имя нового варианта</label><TextInput id="screen-variant-name" name="name" maxLength={256} required readOnly={!!op}/><Button type="submit" disabled={!!op}>Создать пустой вариант</Button>
    </form><Button id="screen-variant-command-retry" hidden={!editable||!(op?.state==='uncertain'||op?.state==='sync')} onClick={retryCommand}>Повторить создание варианта</Button>
  </>;
}
export function createScreenVariantsModel(){return createViewModel(View);}
export function createScreenVariants({model,element,request,refreshPages,onSelectionChanged,pageSize,workspace}:Options){
  const operations=new Map<string,Operation>();
  let readController:AbortController|null=null,selectionEpoch=0;
  let state=initial(),generation=0,screenId:string|null=null,selected:string|null=null,commandError:{key:string;message:string}|null=null;
  const key=(doc:string|null,screen:string|null)=>doc+'/'+screen;
  const currentKey=()=>key(workspace.documentId,workspace.selectedScreen);
  const canEdit=()=>!!workspace.selectedScreen&&['Owner','Editor'].includes(workspace.documentRole??'');
  function render(patch:Partial<State>={}){
    state={...state,...patch};
    const op=operations.get(currentKey()),error=op?.state==='uncertain'?'Результат создания неизвестен. Повторите ту же команду.':op?.state==='sync'?'Создание подтверждено. Повторите обновление.':commandError?.key===currentKey()?commandError.message:state.error;
    model.publish({state:{...state,error},selected,editable:canEdit(),enabled:!!workspace.selectedScreen,op,pageSize,
      select:selectVariant,create:name=>void create(name),retry:()=>void load(),retryCommand:()=>{const doc=workspace.documentId,screen=workspace.selectedScreen;if(doc&&screen&&(op?.state==='uncertain'||op?.state==='sync'))void send(doc,screen,op);},
      move:delta=>{state.offset=Math.max(0,state.offset+delta*pageSize);void load();}});
  }
  function selectVariant(id:string|null){if(id===selected)return;selectionEpoch++;selected=id;render();onSelectionChanged?.();}
  function reset(){readController?.abort();readController=null;generation++;selectionEpoch++;screenId=null;commandError=null;state={...initial(),formKey:state.formKey+1};if(selected!==null)selectVariant(null);else render();}
  async function load():Promise<void>{
    readController?.abort();const controller=new AbortController();readController=controller;
    const screen=workspace.selectedScreen,doc=workspace.documentId,revision=workspace.revision,catalogRevision=workspace.catalogRevision,current=++generation;
    if(screenId!==screen){state.offset=state.total=0;screenId=screen;commandError=null;selectVariant(null);}
    render({items:[],hasBase:false,error:'',retry:false});
    if(!screen||!doc||revision===null||!Number.isSafeInteger(revision)){render({status:'Выберите экран.'});return;}
    const valid=()=>!controller.signal.aborted&&current===generation&&doc===workspace.documentId&&screen===workspace.selectedScreen&&catalogRevision===workspace.catalogRevision;
    render({status:'Загрузка вариантов…'});
    try{
      const response=requiredRecord(await request('/api/v1/documents/'+encodeURIComponent(doc)+'/screens/'+encodeURIComponent(screen)+'/variants?revision='+revision+'&offset='+state.offset+'&limit='+pageSize,{},controller.signal,valid));
      if(!valid())return;
      if(response.revision!==revision||text(response.screenId).toLowerCase()!==screen.toLowerCase()||text(response.documentId).toLowerCase()!==doc.toLowerCase())throw new TypeError('Некорректный ответ');
      const result=page(response,v=>{const item=requiredRecord(v);return{id:text(item.id),name:text(item.name)};});
      if(state.offset&&!result.items.length){state.offset=Math.max(0,state.offset-pageSize);return load();}
      render({items:result.items,total:result.total,hasBase:true,status:'Сохранённых вариантов: '+result.total+' · ревизия '+revision});
    }catch(error){if(valid()&&!aborted(error))render({status:'',error:errorMessage(error),retry:true});}
  }
  async function send(doc:string,screen:string,op:Operation){
    const k=key(doc,screen),token=workspace.token,epoch=workspace.navigationEpoch;
    if(op.state==='pending'||!canEdit()||operations.get(k)!==op)return;
    const active=()=>doc===workspace.documentId&&workspace.token===token&&epoch===workspace.navigationEpoch&&workspace.isEditorVisible()&&canEdit()&&operations.get(k)===op;
    const visible=()=>active()&&screen===workspace.selectedScreen;
    op.state='pending';if(visible()){commandError=null;render({error:''});}
    try{
      const result=await op.mutation.execute({request,isCurrent:active,synchronize:async confirmation=>{
        if(visible()){render({formKey:state.formKey+1});if(selectionEpoch===op.selectionEpoch)selectVariant(op.body.variantId);}
        await refreshPages();
        return active()&&(workspace.revision??-1)>=confirmation.revision;
      }});
      if(operations.get(k)!==op)return;
      if(result.kind==='confirmed'&&result.synchronization==='synced')operations.delete(k);
      else if(result.kind==='confirmed')op.state='sync';
      else if(result.kind==='uncertain')op.state='uncertain';
      else if(result.kind==='conflict'||result.kind==='rejected'){
        const show=visible();operations.delete(k);
        if(show){commandError={key:k,message:errorMessage(result.error)};render({error:commandError.message});}
      }
    }finally{if(doc===workspace.documentId&&screen===workspace.selectedScreen&&workspace.token===token&&epoch===workspace.navigationEpoch)render();}
  }
  async function create(name:string){
    const doc=workspace.documentId,screen=workspace.selectedScreen,k=currentKey();
    if(!doc||!screen||!canEdit()||operations.has(k))return;
    const body:VariantCommand={commandId:crypto.randomUUID(),screenId:screen,variantId:crypto.randomUUID(),name};
    const op:Operation={body,mutation:prepareDocumentCommand(doc,'add-screen-variant',body),selectionEpoch,state:'ready'};
    operations.set(k,op);await send(doc,screen,op);
  }
  render();return{reset,load,clearCommands:()=>operations.clear(),discardDocument(doc:string){for(const id of operations.keys())if(id.startsWith(doc+'/'))operations.delete(id);},get selectedVariantId(){return selected;},get canChangeStructure(){return state.hasBase&&state.total===0;}};
}
