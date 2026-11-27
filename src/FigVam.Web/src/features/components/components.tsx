import { InlineError, StatusMessage } from '../../ui/Feedback';
import { TextInput } from '../../ui/Inputs';
import { createViewModel } from '../../app/view-model';
import { Button } from '../../ui/Button';
import { Pagination } from '../../ui/Pagination';
import { requiredRecord, text, array, page, errorMessage, aborted } from '../../api/decode';
import type { ApiClient } from '../../api/api-client';
import type { components } from '../../api/schema.generated';

type Summary = Pick<components['schemas']['ComponentDefinition'],'id'|'name'>;
interface Detail extends Summary { description: string; parameters: string[]; slots: string[]; variants: string[] }
const summary = (value: unknown): Summary => {const obj=requiredRecord(value);return {id:text(obj.id),name:text(obj.name)};};
const parameterTypes = ['Text','Asset','Bool','Number','TokenReference','Enum'];
const variantKinds = ['Default','Hover','Disabled','Selected','Custom'];
function enumLabel(value: unknown, labels: string[]) {return typeof value === 'number' ? labels[value] ?? String(value) : String(value);}
function detail(value: unknown): Detail {
  const obj=requiredRecord(requiredRecord(value).component);
  return {...summary(obj), description:text(obj.description),
    parameters:array(obj.parameters,value=>{const p=requiredRecord(value);return text(p.name)+' · '+enumLabel(p.type,parameterTypes)+' · '+JSON.stringify(p.defaultValue)+(Array.isArray(p.enumValues)?' · '+p.enumValues.join(', '):'');}),
    slots:array(obj.slots,value=>{const s=requiredRecord(value);return text(s.name)+' · контейнер '+text(s.containerNodeId);}),
    variants:array(obj.variants,value=>{const v=requiredRecord(value);return text(v.name)+' · '+enumLabel(v.kind,variantKinds)+(v.baseVariantId?' · базовый вариант '+text(v.baseVariantId):'');})};
}
function usage(value:unknown):string {const u=requiredRecord(value);return 'Узел '+text(u.nodeId)+(u.variantId?' · вариант '+text(u.variantId):'');}
interface Context {documentId:string|null;revision:number|null;catalogRevision:number|null}
interface State {items:Summary[];selection:string|null;status:string;error:string;retry:boolean;component:Detail|null;detailTitle:string;usages:string[];usageStatus:string;usageError:string;usageRetry:boolean;detailVisible:boolean;offset:number;total:number;usageOffset:number;usageTotal:number}
const initial=():State=>({items:[],selection:null,status:'',error:'',retry:false,component:null,detailTitle:'',usages:[],usageStatus:'',usageError:'',usageRetry:false,detailVisible:false,offset:0,total:0,usageOffset:0,usageTotal:0});
function Lines({id,items,empty,label}:{id:string;items:string[];empty:string;label?:string}) {return <ul id={id} aria-label={label}>{(items.length?items:[empty]).map((item,i)=><li key={i}>{item}</li>)}</ul>;}
function View({state,pageSize,search,select,load,move,moveUsage,resetKey}:{state:State;pageSize:number;search(value:string):void;select(id:string):void;load():void;move(delta:number):void;moveUsage(delta:number):void;resetKey:number}) {
  return <>
    <h2 id="components-title">Каталог компонентов</h2>
    <form id="components-search" key={resetKey} onSubmit={e=>{e.preventDefault();const field=e.currentTarget.elements.namedItem('query');if(field instanceof HTMLInputElement)search(field.value.trim());}}>
      <label htmlFor="components-query">Поиск компонентов</label><TextInput id="components-query" name="query" maxLength={256}/><Button type="submit">Найти компоненты</Button>
    </form>
    <StatusMessage id="components-status">{state.status}</StatusMessage><InlineError id="components-error">{state.error}</InlineError>
    <Button id="components-retry" hidden={!state.retry} onClick={load}>Повторить загрузку каталога</Button>
    <ul id="components-list" aria-label="Компоненты документа">{state.items.map(item=><li key={item.id}><Button aria-pressed={item.id===state.selection} onClick={()=>select(item.id)}>{item.name}</Button></li>)}</ul>
    <Pagination label="Навигация по компонентам" prefix="components" previousLabel="Предыдущие компоненты" nextLabel="Следующие компоненты" offset={state.offset} total={state.total} pageSize={pageSize} previous={()=>move(-1)} next={()=>move(1)}/>
    <div id="component-detail" hidden={!state.detailVisible}>
      <h3 id="component-title">{state.detailTitle}</h3><p id="component-description">{state.component?.description || (state.component?'Описание отсутствует.':'')}</p>
      <h4>Параметры</h4><Lines id="component-parameters" items={state.component?.parameters??[]} empty={state.component?'Параметров нет.':''}/>
      <h4>Слоты</h4><Lines id="component-slots" items={state.component?.slots??[]} empty={state.component?'Слотов нет.':''}/>
      <h4>Варианты</h4><Lines id="component-variants" items={state.component?.variants??[]} empty={state.component?'Вариантов нет.':''}/>
      <h4>Использования</h4><StatusMessage id="component-usages-status">{state.usageStatus}</StatusMessage><InlineError id="component-usages-error">{state.usageError}</InlineError>
      <Button id="component-usages-retry" hidden={!state.usageRetry} onClick={load}>Повторить загрузку компонента</Button>
      <Lines id="component-usages" label="Использования компонента" items={state.usages} empty={state.component?'Использований нет.':''}/>
      <Pagination label="Навигация по использованиям" prefix="usages" previousLabel="Предыдущие использования" nextLabel="Следующие использования" offset={state.usageOffset} total={state.usageTotal} pageSize={pageSize} previous={()=>moveUsage(-1)} next={()=>moveUsage(1)}/>
    </div>
  </>;
}
export function createComponentsModel(){return createViewModel(View);}
export function createComponents({model,request,pageSize,getContext}:{model:ReturnType<typeof createComponentsModel>;request:ApiClient;pageSize:number;getContext():Context}) {
  let state=initial(),generation=0,query='',resetKey=0;
  let readController:AbortController|null=null;
  function render(patch:Partial<State>={}) {
    state={...state,...patch};
    model.publish({state,pageSize,resetKey,load:()=>void load(),
      search:value=>{query=value;render({offset:0,selection:null,usageOffset:0});void load();},
      select:id=>{render({selection:id,usageOffset:0});void load();},
      move:delta=>{render({offset:Math.max(0,state.offset+delta*pageSize)});void load();},
      moveUsage:delta=>{render({usageOffset:Math.max(0,state.usageOffset+delta*pageSize)});void load();}});
  }
  function reset(){readController?.abort();readController=null;generation++;query='';resetKey++;state=initial();render();}
  async function load():Promise<void> {
    readController?.abort();const controller=new AbortController();readController=controller;
    const {documentId:doc,revision,catalogRevision}=getContext();
    if(!doc||revision===null||!Number.isSafeInteger(revision))return;
    const current=++generation,offset=state.offset;
    const valid=()=>{const ctx=getContext();return !controller.signal.aborted&&current===generation&&doc===ctx.documentId&&catalogRevision===ctx.catalogRevision;};
    const base='/api/v1/documents/'+encodeURIComponent(doc)+'/components';
    render({status:'Загрузка компонентов…',error:'',retry:false,items:[],detailVisible:false,total:0,usageTotal:0});
    try {
      const params=new URLSearchParams({revision:String(revision),offset:String(offset),limit:String(pageSize),search:query});
      const result=page(await request(base+'?'+params,{},controller.signal,valid),summary);if(!valid())return;
      if(offset&&!result.items.length){render({offset:Math.max(0,offset-pageSize)});return load();}
      render({items:result.items,total:result.total,status:result.total?'Компонентов: '+result.total+' · ревизия '+revision:'Компоненты не найдены.'});
      if(state.selection)await loadDetail(base,state.selection,revision,controller.signal,valid);
    }catch(error){if(valid()&&!aborted(error))render({status:'',error:errorMessage(error),retry:true});}
  }
  async function loadDetail(base:string,id:string,revision:number,signal:AbortSignal,valid:()=>boolean):Promise<void> {
    const atOffset=state.usageOffset,active=()=>valid()&&state.selection===id,path=base+'/'+encodeURIComponent(id);
    render({detailVisible:true,detailTitle:'Загрузка…',component:null,usages:[],usageStatus:'Загрузка компонента и использований…',usageError:'',usageRetry:false});
    try {
      const params=new URLSearchParams({revision:String(revision),offset:String(atOffset),limit:String(pageSize)});
      const [data,usageData]=await Promise.all([request(path+'?revision='+revision,{},signal,active),request(path+'/usages?'+params,{},signal,active)]);
      if(!active())return;
      const usages=page(usageData,usage),component=detail(data);
      if(atOffset&&!usages.items.length){render({usageOffset:Math.max(0,atOffset-pageSize)});return loadDetail(base,id,revision,signal,valid);}
      render({component,detailTitle:component.name,usages:usages.items,usageTotal:usages.total,usageStatus:'Использований: '+usages.total+' · ревизия '+revision});
    }catch(error){if(active()&&!aborted(error))render({detailTitle:'Компонент недоступен',usageStatus:'',usageError:errorMessage(error),usageRetry:true});}
  }
  render();return {reset,load};
}
