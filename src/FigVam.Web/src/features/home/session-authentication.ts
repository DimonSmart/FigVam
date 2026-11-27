import { authHeaders, configureAuth } from '../../api/auth-client';
import { requiredRecord, text } from '../../api/decode';

export async function readAuthenticationMode(): Promise<'bearer' | 'google'> {
  const config = await fetch('/api/auth/config', { credentials: 'same-origin', cache: 'no-store' });
  if (!config.ok) throw new Error('Режим аутентификации недоступен.');
  const info = requiredRecord(await config.json());
  if (info.mode !== 'bearer' && info.mode !== 'google') throw new TypeError('Некорректный режим аутентификации.');
  configureAuth(info.mode);
  return info.mode;
}

export async function restoreGoogleSession(): Promise<{ csrfToken: string; admin: boolean } | null> {
  const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('Не удалось восстановить сессию.');
  const session = requiredRecord(await response.json());
  if (session.authenticated !== true) return null;
  return { csrfToken: text(session.csrfToken), admin: session.admin === true };
}

export async function logoutGoogleSession(): Promise<void> {
  const response = await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store',
    credentials: 'same-origin', redirect: 'error', headers: authHeaders('', 'POST') });
  if (!response.ok) throw new Error('Не удалось завершить серверную сессию.');
}

export function isValidBearerToken(value: string): boolean {
  return !!value && !/\s/.test(value);
}
