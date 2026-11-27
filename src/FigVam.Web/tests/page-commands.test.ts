import { describe, expect, it, vi } from 'vitest';
import { preparePageCommand } from '../src/app/page-commands';

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
