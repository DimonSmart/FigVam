import { describe, expect, it, vi } from 'vitest';
import { createDocumentRevisionState, readDocumentStructure, type DocumentStructure } from '../src/app/document-workspace';
import { createDocumentSync } from '../src/app/document-sync';
import type { createDocumentQueries } from '../src/api/document-queries';

function queries() {
  const result: ReturnType<typeof createDocumentQueries> = {
    readPages: vi.fn(async () => ({ revision: 7, items: [{ id: 'page', type: 'page', name: 'Page', childCount: 1 }], total: 1 })),
    readScreens: vi.fn(async () => ({ revision: 7, items: [{ id: 'screen', type: 'screen', dimensions: { width: 100, height: 100 } }], total: 1 })),
    findRole: vi.fn(async () => 'Owner'),
    readName: vi.fn(async () => 'Document'),
  };
  return result;
}
describe('document workspace', () => {
  it('keeps the current selection and pins screen queries to the confirmed page revision', async () => {
    const api = queries();
    const signal = new AbortController().signal;
    const valid = () => true;
    const result = await readDocumentStructure(api, 'doc', signal, valid, null, { page: 'page', screen: 'screen' });
    expect(result?.selection).toEqual({ page: 'page', screen: 'screen' });
    expect(api.readScreens).toHaveBeenCalledWith('doc', 'page', signal, valid, 7);
  });
  it('selects the first screen when selecting the fallback page', async () => {
    const result = await readDocumentStructure(queries(), 'doc', new AbortController().signal, () => true, null,
      { page: 'deleted', screen: 'screen' });
    expect(result?.selection).toEqual({ page: 'page', screen: 'screen' });
  });
  it('automatically selects the first screen on opening or after deleting the selected screen', async () => {
    for (const selection of [{page:null,screen:null},{page:'page',screen:'deleted'}]) {
      const result = await readDocumentStructure(queries(), 'doc', new AbortController().signal, () => true, null, selection);
      expect(result?.selection).toEqual({page:'page',screen:'screen'});
    }
  });
  it('preserves a non-first valid screen and page and uses document order for fallback', async () => {
    const api = queries();
    vi.mocked(api.readPages).mockResolvedValue({revision:7,total:2,items:[
      {id:'first',type:'page',name:'First',childCount:1},{id:'second',type:'page',name:'Second',childCount:2}
    ]});
    vi.mocked(api.readScreens).mockResolvedValue({revision:7,total:2,items:[
      {id:'s1',type:'screen',dimensions:{width:10,height:10}},
      {id:'s2',type:'screen',dimensions:{width:10,height:10}}
    ]});
    const read = (page:string|null,screen:string|null) => readDocumentStructure(api,'doc',new AbortController().signal,()=>true,null,{page,screen});
    expect((await read('second','s2'))?.selection).toEqual({page:'second',screen:'s2'});
    expect((await read('second','removed'))?.selection).toEqual({page:'second',screen:'s1'});
    expect((await read('removed','s2'))?.selection).toEqual({page:'first',screen:'s1'});
    expect((await read('second',null))?.selection).toEqual({page:'second',screen:'s1'});
  });
  it('discards a screen response that becomes obsolete while loading', async () => {
    const api = queries();
    let current = true;
    vi.mocked(api.readScreens).mockImplementationOnce(async () => {
      current = false;
      return {revision:7,total:1,items:[{id:'old',type:'screen',dimensions:{width:10,height:10}}]};
    });
    expect(await readDocumentStructure(api,'doc',new AbortController().signal,()=>current,null,{page:'page',screen:null})).toBeNull();
  });
  it('leaves selection empty only for actually empty lists', async () => {
    const api = queries();
    vi.mocked(api.readScreens).mockResolvedValueOnce({revision:7,items:[],total:0});
    const read = () => readDocumentStructure(api,'doc',new AbortController().signal,()=>true,null,{page:'page',screen:'deleted'});
    expect((await read())?.selection).toEqual({page:'page',screen:null});
    vi.mocked(api.readPages).mockResolvedValueOnce({revision:7,items:[],total:0});
    expect((await read())?.selection).toEqual({page:null,screen:null});
  });
  it('stops before screen loading when the request is obsolete', async () => {
    const api = queries();
    const result = await readDocumentStructure(api, 'doc', new AbortController().signal, () => false, null,
      { page: 'page', screen: 'screen' });
    expect(result).toBeNull();
    expect(api.readScreens).not.toHaveBeenCalled();
  });
  it('separates confirmed node revisions from complete catalog snapshots and resets both', () => {
    const state = createDocumentRevisionState();
    state.confirmStructure(7);
    state.confirmNodeEdit(8);
    expect(state.revision).toBe(8);
    expect(state.catalogRevision).toBe(7);
    state.confirmNodeEdit(6);
    state.confirmStructure(7);
    expect(state.revision).toBe(8);
    expect(state.catalogRevision).toBe(7);
    state.reset();
    expect(state.revision).toBeNull();
    expect(state.catalogRevision).toBeNull();
  });
});

describe('document synchronization', () => {
  it('publishes concurrent complete snapshots once without skipping explicit refreshes', async () => {
    const view = { documentId: 'doc', page: 'page', screen: 'screen', navigationEpoch: 1, revision: 6, catalogRevision: 6 };
    const layers = {
      readSnapshot: vi.fn(async () => ({ screen: 'screen', roots: [], children: new Map(), expanded: new Set<string>(), initialExpansion: new Set<string>() })),
      isExpansionCurrent: vi.fn(() => true)
    };
    const tokens = {
      read: vi.fn(async () => ({ items: [], selection: null, usages: [] })),
      readSelectedUsages: vi.fn(async () => ({ selection: null, usages: [] }))
    };
    const styles = { read: vi.fn(async () => []) };
    const applyStructure = vi.fn((structure: DocumentStructure) => {
      view.revision = structure.revision;
      view.catalogRevision = structure.revision;
    });
    const sync = createDocumentSync({
      context: () => ({ ...view }), shouldReportFailure: () => false,
      queries: queries(), layers, tokens, styles, applyNodeEdit: vi.fn(), applyStructure
    });
    const signal = new AbortController().signal;
    expect(await Promise.all([sync.readPages(signal, 0, 7), sync.readPages(signal, 0, 7)])).toEqual([true, true]);
    expect(applyStructure).toHaveBeenCalledOnce();
    await sync.readPages(signal, 0, 7);
    expect(applyStructure).toHaveBeenCalledTimes(2);
    view.catalogRevision = 6;
    await sync.readPages(signal, 0, 7);
    expect(applyStructure).toHaveBeenCalledTimes(3);
  });
});
