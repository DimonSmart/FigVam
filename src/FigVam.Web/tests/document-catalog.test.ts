import { describe, expect, it, vi } from 'vitest';
import { createDocumentCatalog } from '../src/app/document-catalog';
import type { ApiClient } from '../src/api/api-client';

describe('document catalog', () => {
  it('keeps a cursor chain and resets it when leaving the session', async () => {
    const catalog = createDocumentCatalog();
    const request = vi.fn().mockResolvedValueOnce({ items: [], nextCursor: 'a+b' })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    const signal = new AbortController().signal;
    catalog.beginLoad();
    await catalog.read(request as ApiClient, 0, null, 20, signal, () => true);
    expect(catalog.next()).toEqual({ index: 1, cursor: 'a+b' });
    catalog.beginLoad();
    await catalog.read(request as ApiClient, 1, 'a+b', 20, signal, () => true);
    expect(request.mock.calls[1]?.[0]).toBe('/api/v1/documents?limit=20&cursor=a%2Bb');
    expect(catalog.previous()).toEqual({ index: 0, cursor: null });
    expect(catalog.canGoForward).toBe(false);
    catalog.reset();
    expect(catalog.canGoBack).toBe(false);
    expect(catalog.next()).toBeNull();
  });

  it('cannot commit a response from a reset or superseded load', async () => {
    const catalog = createDocumentCatalog();
    let resolve!: (value: unknown) => void;
    const request = vi.fn(() => new Promise<unknown>(r => { resolve = r; }));
    catalog.beginLoad();
    const pending = catalog.read(request as ApiClient, 2, 'old', 20, new AbortController().signal, () => true);
    catalog.reset();
    resolve({ items: [], nextCursor: 'obsolete' });
    expect(await pending).toBeNull();
    expect(catalog.canGoBack).toBe(false);
    expect(catalog.canGoForward).toBe(false);
  });
});
