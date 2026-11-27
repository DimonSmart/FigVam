import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionLifecycle } from '../src/core/session';
import { ApiError, createApiClient } from '../src/api/api-client';
import { createAuthContext } from '../src/api/auth-client';

describe('API transport', () => {
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
    const auth = createAuthContext();
    auth.configureAuth('google'); auth.setCsrf('csrf-value');
    const fetch = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetch);
    const client = createApiClient({ auth, getToken: () => '', onUnauthorized: vi.fn() });
    await client('/api/v1/documents', { method: 'POST', body: '{}' });
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('X-CSRF-TOKEN')).toBe('csrf-value');
    expect(headers.has('Authorization')).toBe(false);
    expect(init.credentials).toBe('same-origin');
  });

  it('isolates authentication policy and CSRF between clients', async () => {
    const a = createAuthContext(), b = createAuthContext();
    a.configureAuth('google'); a.setCsrf('first');
    b.configureAuth('google'); b.setCsrf('second');
    const fetch = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetch);
    const first = createApiClient({auth:a,getToken:()=>'',onUnauthorized:vi.fn()});
    const second = createApiClient({auth:b,getToken:()=>'',onUnauthorized:vi.fn()});
    await first('/api/test',{method:'POST'});
    await second('/api/test',{method:'POST'});
    a.setCsrf('');
    await first('/api/test',{method:'POST'});
    await second('/api/test',{method:'POST'});
    expect(fetch.mock.calls.map(call=>new Headers(call[1].headers).get('X-CSRF-TOKEN'))).toEqual(['first','second','','second']);
    a.configureAuth('bearer');
    expect(a.authHeaders('token')).toEqual({Authorization:'Bearer token'});
    expect(b.credentialsMode()).toBe('same-origin');
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
  it('cancels background requests and ignores a late 401 after signing in with the same credentials', async () => {
    const session = createSessionLifecycle();
    session.setToken('same');
    const fetch = vi.fn(async () => {
      session.setToken('same');
      return new Response(null, { status: 401 });
    });
    vi.stubGlobal('fetch', fetch);
    const unauthorized = vi.fn();
    const client = createApiClient({ getToken: () => session.token, getSessionEpoch: () => session.sessionEpoch,
      getSessionSignal: () => session.signal, onUnauthorized: unauthorized });
    await expect(client('/api/v1/documents')).rejects.toMatchObject({ name: 'AbortError' });
    expect(unauthorized).not.toHaveBeenCalled();
  });
});
