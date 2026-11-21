let mode = 'bearer';
let csrf = '';
export function configureAuth(value) { mode = value; }
export function isGoogleMode() { return mode === 'google'; }
export function setCsrf(value) { csrf = value || ''; }
export function credentialsMode() { return isGoogleMode() ? 'same-origin' : 'omit'; }
export function authHeaders(token, method = 'GET') {
  if (!isGoogleMode()) return { Authorization: `Bearer ${token}` };
  return /^(POST|PUT|PATCH|DELETE)$/i.test(method) ? { 'X-CSRF-TOKEN': csrf } : {};
}
