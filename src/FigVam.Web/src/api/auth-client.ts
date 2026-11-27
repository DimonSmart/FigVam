export type AuthMode = 'bearer' | 'google';

/** Authentication policy belongs to one application/session, never to the module. */
export function createAuthContext() {
  let mode: AuthMode = 'bearer';
  let csrf = '';
  const isGoogleMode = () => mode === 'google';
  return {
    configureAuth(value: AuthMode): void { mode = value; csrf = ''; },
    isGoogleMode,
    setCsrf(value: string | null | undefined): void { csrf = value || ''; },
    credentialsMode(): RequestCredentials { return isGoogleMode() ? 'same-origin' : 'omit'; },
    authHeaders(token: string, method = 'GET'): Record<string, string> {
      if (!isGoogleMode()) return { Authorization: `Bearer ${token}` };
      return /^(POST|PUT|PATCH|DELETE)$/i.test(method) ? { 'X-CSRF-TOKEN': csrf } : {};
    },
  };
}
export type AuthContext = ReturnType<typeof createAuthContext>;
export type AuthPolicy = Pick<AuthContext, 'authHeaders' | 'credentialsMode'>;
