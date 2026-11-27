import { describe, expect, it, vi } from 'vitest';
import { createDocumentQueries } from '../src/api/document-queries';
import type { ApiClient } from '../src/api/api-client';

function transport(...responses: unknown[]) {
  const request = vi.fn<ApiClient>().mockImplementation(async () => responses.shift());
  return Object.assign(request, { readPng: vi.fn<ApiClient['readPng']>() });
}
const signal = new AbortController().signal;
const page = (id: string) => ({ id, type: 'page', name: id, childCount: 0 });
const response = (items: unknown[], revision = 5, total = items.length) => ({ documentId: 'doc', items, revision, total });

describe('document queries', () => {
  it('pins every subsequent page to the first revision', async () => {
    const request = transport(response([page('a')], 5, 2), response([page('b')], 5, 2));
    const result = await createDocumentQueries(request).readPages('doc', signal);
    expect(result).toEqual({ items: [page('a'), page('b')], revision: 5, total: 2 });
    expect(request.mock.calls[1]?.[0]).toContain('offset=1');
    expect(request.mock.calls[1]?.[0]).toContain('revision=5');
  });
  it('rejects revision changes and incomplete pagination', async () => {
    await expect(createDocumentQueries(transport(response([page('a')], 5, 2), response([page('b')], 6, 2)))
      .readPages('doc', signal)).rejects.toThrow('Ревизия');
    await expect(createDocumentQueries(transport(response([], 5, 1))).readPages('doc', signal)).rejects.toThrow('полный список');
  });
  it('does not apply a response after the workspace changes', async () => {
    let current = true;
    const request = transport();
    request.mockImplementation(async () => { current = false; return response([page('a')]); });
    expect(await createDocumentQueries(request).readPages('doc', signal, () => current)).toBeNull();
  });
  it('validates screen dimensions at the JSON boundary', async () => {
    const invalid = { id: 'screen', type: 'screen', dimensions: { width: '100', height: 80 } };
    await expect(createDocumentQueries(transport(response([invalid]))).readScreens('doc', 'page', signal)).rejects.toThrow(TypeError);
  });
  it('reads a document name and rejects malformed headers', async () => {
    expect(await createDocumentQueries(transport(response([{ id: 'doc', type: 'document', name: 'Login' }]))).readName('doc', signal)).toBe('Login');
    await expect(createDocumentQueries(transport(response([]))).readName('doc', signal)).rejects.toThrow(TypeError);
  });
  it('finds a role using cursor pagination and case insensitive ids', async () => {
    const request = transport({ items: [], nextCursor: 'next' }, { items: [{ documentId: 'DOC', name: 'Login', role: 'Editor' }] });
    expect(await createDocumentQueries(request).findRole('doc', signal)).toBe('Editor');
    expect(request.mock.calls[1]?.[0]).toContain('cursor=next');
  });
});
