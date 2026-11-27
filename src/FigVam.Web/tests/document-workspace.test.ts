import { describe, expect, it, vi } from 'vitest';
import { createDocumentRevisionState, readDocumentStructure } from '../src/app/document-workspace';
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
  it('clears an obsolete screen selection when selecting the fallback page', async () => {
    const result = await readDocumentStructure(queries(), 'doc', new AbortController().signal, () => true, null,
      { page: 'deleted', screen: 'screen' });
    expect(result?.selection).toEqual({ page: 'page', screen: null });
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
