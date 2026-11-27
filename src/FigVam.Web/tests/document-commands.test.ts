import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/api-client';
import { classifyCommandFailure, createCommandBody, postDocumentCommand } from '../src/api/document-commands';

describe('document command transport', () => {
  it('reuses the same ID and body on explicit retry, with cancellation and stale-response guard', async () => {
    const request = vi.fn().mockResolvedValue({revision: 2});
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
