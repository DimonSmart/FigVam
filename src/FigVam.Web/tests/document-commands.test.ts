import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/api-client';
import { classifyCommandFailure, createCommandBody, postDocumentCommand, createDocumentCommand, prepareDocumentCommand } from '../src/api/document-commands';

function ack(documentId: string, commandId: string) {
  return {status:'ACCEPTED', documentId, commandId, revision:2, pageId:null, screenId:null, nodeId:null, versionId:null, affectedIds:[]};
}
describe('document command transport', () => {
  it('reuses the same ID and body on explicit retry, with cancellation and stale-response guard', async () => {
    const request = vi.fn().mockResolvedValue(ack('a/b','same-id'));
    const body = createCommandBody({pageId: 'p', expectedRevision: 1}, 'same-id');
    const signal = new AbortController().signal, active = () => true;
    await postDocumentCommand(request, 'a/b', 'delete-page', body, signal, active);
    await postDocumentCommand(request, 'a/b', 'delete-page', body, signal, active);
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
    expect(request).toHaveBeenCalledWith('/api/v1/documents/a%2Fb/commands/delete-page',
      {method: 'POST', body: JSON.stringify(body)}, signal, active);
  });
  it('distinguishes conflicts, definitive rejection and uncertain outcomes', () => {
    expect(classifyCommandFailure(new ApiError(409, {}))).toBe('conflict');
    expect(classifyCommandFailure(new ApiError(403, {}))).toBe('rejected');
    expect(classifyCommandFailure(new ApiError(500, {}))).toBe('uncertain');
    expect(classifyCommandFailure(new ApiError(408, {}))).toBe('uncertain');
    expect(classifyCommandFailure(new ApiError(403, {}), false)).toBe('uncertain');
    expect(classifyCommandFailure(new TypeError('network'))).toBe('uncertain');
  });
});

describe('prepared document command lifecycle', () => {
  const prepare = () => createDocumentCommand('doc','delete-page',{pageId:'p',expectedRevision:1},'same');
  const execution = (request: Parameters<ReturnType<typeof prepare>['execute']>[0]['request'], synchronize = vi.fn(async () => true)) =>
    ({request, synchronize, isCurrent:()=>true});
  it('binds generated request types to names', () => {
    if (false) {
      // @ts-expect-error rename-page requires pageId, not screenId
      createDocumentCommand('doc','rename-page',{screenId:'s',name:'new'});
      // @ts-expect-error deletion requires the original revision
      prepareDocumentCommand('doc','delete-page',{commandId:'id',pageId:'p'});
    }
  });
  it('retains the original ID and serialized payload through an uncertain retry', async () => {
    const data={pageId:'p',expectedRevision:1};
    const op=createDocumentCommand('doc','delete-page',data,'same');
    data.expectedRevision=99;
    const request=vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(ack('doc','same'));
    const context=execution(request);
    expect(op.getSnapshot().kind).toBe('ready');
    expect((await op.execute(context)).kind).toBe('uncertain');
    expect((await op.execute(context)).kind).toBe('confirmed');
    expect(request.mock.calls[0]?.[1]).toEqual(request.mock.calls[1]?.[1]);
    expect(JSON.parse(request.mock.calls[1]?.[1].body)).toEqual({pageId:'p',expectedRevision:1,commandId:'same'});
  });
  it('never resends a confirmed command after synchronization fails', async () => {
    const op=prepare(),request=vi.fn().mockResolvedValue(ack('doc','same'));
    const synchronize=vi.fn<() => Promise<boolean>>().mockRejectedValueOnce(new Error('refresh')).mockResolvedValueOnce(true);
    const context=execution(request,synchronize);
    expect(await op.execute(context)).toMatchObject({kind:'confirmed',synchronization:'failed'});
    expect(await op.execute(context)).toMatchObject({kind:'confirmed',synchronization:'synced'});
    expect(request).toHaveBeenCalledOnce();
  });
  it('does not send in parallel', async () => {
    const op=prepare();let finish!: (value:unknown)=>void;
    const request=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
    const context=execution(request);
    const first=op.execute(context);
    expect((await op.execute(context)).kind).toBe('pending');
    finish(ack('doc','same'));await first;
    expect(request).toHaveBeenCalledOnce();
  });
  it('does not synchronize a confirmation after the context changes', async () => {
    const op=prepare();let current=true;
    const request=vi.fn(async()=>{current=false;return ack('doc','same');});
    const sync=vi.fn(async()=>true);
    expect(await op.execute({request,synchronize:sync,isCurrent:()=>current})).toMatchObject({kind:'confirmed',synchronization:'stale'});
    expect(sync).not.toHaveBeenCalled();
  });
  it.each([ [new ApiError(403,{}),'rejected'], [new ApiError(409,{}),'conflict'], [new ApiError(408,{}),'uncertain'],
    [new DOMException('cancelled','AbortError'),'uncertain'] ] as const)('classifies %s as %s',async(error,kind)=>{
    const op=prepare(),request=vi.fn().mockRejectedValue(error);
    expect((await op.execute(execution(request))).kind).toBe(kind);
  });
  it('does not treat malformed successful HTTP responses as confirmation',async()=>{
    const op=prepare(),request=vi.fn().mockResolvedValue({...ack('doc','same'),commandId:'different'});
    const sync=vi.fn(async()=>true);
    expect((await op.execute(execution(request,sync))).kind).toBe('uncertain');
    expect(sync).not.toHaveBeenCalled();
  });
});
