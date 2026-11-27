import { describe, expect, it, vi } from 'vitest';
import { createPageCommands, preparePageCommand } from '../src/app/page-commands';

describe('page commands', () => {
  it('uses the document-scoped command route and a stable body for one submission', async () => {
    const signal = new AbortController().signal;
    const op=preparePageCommand('a/b','delete-page',{pageId:'page',expectedRevision:6});
    const request = vi.fn().mockResolvedValue({status:'ACCEPTED',documentId:'a/b',commandId:op.commandId,revision:7,
      pageId:null,screenId:null,nodeId:null,versionId:null,affectedIds:[]});
    expect(await op.execute({request,signal,isCurrent:()=>true,synchronize:async()=>true})).toMatchObject({kind:'confirmed',synchronization:'synced'});
    const [url, options, requestSignal] = request.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/documents/a%2Fb/commands/delete-page');
    expect(requestSignal).toBe(signal);
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body))).toEqual({ pageId: 'page', expectedRevision: 6, commandId: op.commandId });
  });
});

describe('page mutation controller',()=>{
  function setup(){
    const ctx={documentId:'doc',revision:6,navigationEpoch:1,sessionEpoch:1,page:'p',screen:'s',canEdit:true};
    let retry:(()=>Promise<unknown>)|null=null;
    const send=vi.fn(async (_path:string,options?:RequestInit)=>{
      const body=JSON.parse(String(options?.body));
      return {status:'ACCEPTED',documentId:'doc',commandId:body.commandId,revision:7,pageId:null,screenId:null,nodeId:null,versionId:null,affectedIds:[]};
    });
    const request=Object.assign(send,{readPng:vi.fn(async()=>new Blob())});
    const refresh=vi.fn<()=>Promise<true|undefined>>(async()=>{ctx.revision=7;return true;});
    const select=vi.fn(),setBusy=vi.fn(),message=vi.fn();
    const commands=createPageCommands({request,context:()=>({...ctx}),stopLive:vi.fn(),startLive:vi.fn(),setBusy,message,select,refresh,setRetry:value=>{retry=value;}});
    return {ctx,commands,send,refresh,select,setBusy,message,retry:async()=>{await retry?.();}};
  }
  it('retries only synchronization after a confirmed write',async()=>{
    const f=setup();f.refresh.mockRejectedValueOnce(new Error('refresh failed'));
    await f.commands.start('rename-page',{pageId:'p',name:'Renamed'});
    expect(f.send).toHaveBeenCalledTimes(1);
    await f.retry();
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(f.setBusy).toHaveBeenLastCalledWith(false);
  });
  it('preserves the original command across a lost response',async()=>{
    const f=setup();f.send.mockRejectedValueOnce(new TypeError('network'));
    await f.commands.start('delete-page',{pageId:'p',expectedRevision:6});
    f.ctx.revision=9;
    await f.retry();
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.send.mock.calls[0]?.[1]?.body).toBe(f.send.mock.calls[1]?.[1]?.body);
  });
  it('does not select a screen from an obsolete document operation',async()=>{
    const f=setup();let finish!:()=>void;
    f.send.mockImplementationOnce(async(_path,options)=>{
      await new Promise<void>(resolve=>{finish=resolve;});
      return {status:'ACCEPTED',documentId:'doc',commandId:JSON.parse(String(options?.body)).commandId,revision:7,pageId:null,screenId:null,nodeId:null,versionId:null,affectedIds:[]};
    });
    const work=f.commands.start('add-screen',{pageId:'p',screenId:'new',dimensions:{width:100,height:100}},undefined,'new');
    f.ctx.documentId='other';f.ctx.navigationEpoch++;
    finish();await work;
    expect(f.select).not.toHaveBeenCalled();expect(f.refresh).not.toHaveBeenCalled();
    expect(f.setBusy).not.toHaveBeenLastCalledWith(false);
  });
});
