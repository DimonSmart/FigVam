import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../src/api/api-client';
import { createComponents, createComponentsModel } from '../src/features/components/components';
import { createDatasets, createDatasetsModel } from '../src/features/datasets/datasets';

const context=()=>({documentId:'doc',documentRole:'Owner',revision:1,catalogRevision:1,token:'session',generation:1,navigationEpoch:1});
function datasetDependencies(){
  return {getContext:context,pageSize:10,startRequest:()=>({signal:new AbortController().signal,current:1}),
    stopLive:vi.fn(),startLive:vi.fn(),readPages:vi.fn(async()=>true),run:vi.fn(async()=>true)};
}
function client(fn:(...args:Parameters<ApiClient>)=>Promise<unknown>):ApiClient{
  return Object.assign(fn,{readPng:async()=>new Blob()});
}
describe('independent panel lifetimes',()=>{
  it('cancels only superseded panel reads, and aborts both on document reset',async()=>{
    const reads:{path:string;signal:AbortSignal|null|undefined;finish:(value:unknown)=>void}[]=[];
    const request=client((path,_options,signal)=>new Promise(resolve=>reads.push({path,signal,finish:resolve})));
    const components=createComponents({model:createComponentsModel(),request,pageSize:10,getContext:context});
    const datasets=createDatasets({model:createDatasetsModel(),request,...datasetDependencies()});
    const first=components.load(),other=datasets.load(),second=components.load();
    expect(reads).toHaveLength(3);
    expect(reads[0]?.signal?.aborted).toBe(true);
    expect(reads[1]?.signal?.aborted).toBe(false);
    expect(reads[2]?.signal?.aborted).toBe(false);
    components.reset();datasets.reset();
    expect(reads[1]?.signal?.aborted).toBe(true);
    expect(reads[2]?.signal?.aborted).toBe(true);
    reads.forEach(read=>read.finish({items:[],total:0}));
    await Promise.all([first,other,second]);
  });
  it('preserves a dataset selected after a create command was submitted',async()=>{
    const model=createDatasetsModel(),publish=vi.spyOn(model,'publish');
    let finish!: (value:unknown)=>void;
    let commandId='';
    const request=client(async(path,options)=>{
      if(options?.method==='POST'){
        commandId=JSON.parse(String(options.body)).commandId as string;
        return new Promise(resolve=>{finish=resolve;});
      }
      if(path.includes('/fixture?'))return {fixtureJson:'[]'};
      if(path.includes('/datasets/existing?'))return {dataset:{name:'Existing'}};
      return {items:[{id:'existing',name:'Existing'}],total:1};
    });
    const dependencies=datasetDependencies();
    const datasets=createDatasets({model,request,...dependencies});
    await datasets.load();
    publish.mock.lastCall?.[0]?.create('New dataset',false,'[]');
    publish.mock.lastCall?.[0]?.select('existing');
    expect(commandId).not.toBe('');
    finish({status:'ACCEPTED',documentId:'doc',commandId,revision:1,pageId:null,screenId:null,nodeId:null,versionId:null,affectedIds:[]});
    await vi.waitFor(()=>expect(publish.mock.lastCall?.[0]?.op).toBeUndefined());
    expect(dependencies.readPages).toHaveBeenCalledOnce();
    expect(publish.mock.lastCall?.[0]?.state.selection).toBe('existing');
  });
});
