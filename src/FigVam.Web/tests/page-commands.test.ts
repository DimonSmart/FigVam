import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../src/api/api-client';
import { postPageCommand } from '../src/app/page-commands';

describe('page commands', () => {
  it('uses the document-scoped command route and a stable body for one submission', async () => {
    const signal = new AbortController().signal;
    const transport = vi.fn<ApiClient>().mockResolvedValue({ revision: 7 });
    const request = Object.assign(transport, { readPng: vi.fn<ApiClient['readPng']>() });
    await postPageCommand(request, 'a/b', 'delete-page', { pageId: 'page', expectedRevision: 6 }, signal);
    const [url, options, requestSignal] = transport.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/documents/a%2Fb/commands/delete-page');
    expect(requestSignal).toBe(signal);
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body))).toEqual({ pageId: 'page', expectedRevision: 6, commandId: expect.any(String) });
  });
});
