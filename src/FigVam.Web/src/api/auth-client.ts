export type AuthMode = 'bearer' | 'google';

let mode: AuthMode = 'bearer';
let csrf = '';

export function configureAuth(value: AuthMode): void {
  mode = value;
}
export function isGoogleMode(): boolean {
  return mode === 'google';
}
export function setCsrf(value: string | null | undefined): void {
  csrf = value || '';
}
export function credentialsMode(): RequestCredentials {
  return isGoogleMode() ? 'same-origin' : 'omit';
}
export function authHeaders(token: string, method = 'GET'): Record<string, string> {
  if (!isGoogleMode()) return { Authorization: `Bearer ${token}` };
  return /^(POST|PUT|PATCH|DELETE)$/i.test(method) ? { 'X-CSRF-TOKEN': csrf } : {};
}
