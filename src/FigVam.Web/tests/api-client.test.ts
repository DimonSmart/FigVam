import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from '../src/api/api-client';
import { configureAuth, setCsrf } from '../src/api/auth-client';

describe('API transport', () => {
  beforeEach(() => { configureAuth('bearer'); setCsrf(''); });
  afterEach(() => vi.unstubAllGlobals());

  it('preserves bearer, cache, and redirect policy', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    const client = createApiClient({ getToken: () => 'token', onUnauthorized: vi.fn() });
    await expect(client('/api/v1/documents')).resolves.toEqual({ ok: true });
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token');
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('error');
  });

  it('uses CSRF for Google-authenticated mutations', async () => {
    configureAuth('google'); setCsrf('csrf-value');
    const fetch = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetch);
    const client = createApiClient({ getToken: () => '', onUnauthorized: vi.fn() });
    await client('/api/v1/documents', { method: 'POST', body: '{}' });
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('X-CSRF-TOKEN')).toBe('csrf-value');
    expect(headers.has('Authorization')).toBe(false);
    expect(init.credentials).toBe('same-origin');
  });

  it('rejects responses from an obsolete session', async () => {
    let token = 'old';
    vi.stubGlobal('fetch', vi.fn(async () => {
      token = 'new';
      return Response.json({});
    }));
    const unauthorized = vi.fn();
    const client = createApiClient({ getToken: () => token, onUnauthorized: unauthorized });
    await expect(client('/api/v1/documents')).rejects.toMatchObject({ name: 'AbortError' });
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('honors RequestInit.signal and rejects cancellation before transport', async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetch);
    const client = createApiClient({ getToken: () => 'token', onUnauthorized: vi.fn() });
    await client('/api/v1/documents', { signal: controller.signal });
    expect(fetch.mock.calls[0]?.[1].signal).toBe(controller.signal);
    controller.abort();
    await expect(client('/api/v1/documents', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not send an obsolete request or let a late response update state', async () => {
    let current = true;
    const fetch = vi.fn(async () => { current = false; return Response.json({}); });
    vi.stubGlobal('fetch', fetch);
    const client = createApiClient({ getToken: () => 'token', onUnauthorized: vi.fn() });
    await expect(client('/api/v1/documents', {}, undefined, () => current)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(client('/api/v1/documents', {}, undefined, () => current)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('reports an expired current session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const unauthorized = vi.fn();
    const client = createApiClient({ getToken: () => 'token', onUnauthorized: unauthorized });
    await expect(client('/api/v1/documents')).rejects.toThrow('Сессия завершена');
    expect(unauthorized).toHaveBeenCalledOnce();
  });

  it('keeps structured server errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(
      { code: 'REVISION_CONFLICT', detail: 'stale', property: 'width', diagnostics: [] },
      { status: 409 },
    )));
    const client = createApiClient({ getToken: () => 'token', onUnauthorized: vi.fn() });
    const error: unknown = await client('/api/v1/documents').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'REVISION_CONFLICT', detail: 'stale', property: 'width', diagnostics: [] });
  });
});
