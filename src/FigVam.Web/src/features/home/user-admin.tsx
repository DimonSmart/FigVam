import { useState } from 'react';
import type { FormEvent } from 'react';
import { createViewModel } from '../../app/view-model';
import type { AuthPolicy } from '../../api/auth-client';
import { Button } from '../../ui/Button';

interface User {
  id: string; email: string; name?: string | null; isBound: boolean; enabled: boolean; isAdmin: boolean;
}
function isUser(value: unknown): value is User {
  if (!value || typeof value !== 'object') return false;
  return 'id' in value && typeof value.id === 'string' && 'email' in value && typeof value.email === 'string'
    && (!('name' in value) || value.name === null || typeof value.name === 'string')
    && 'isBound' in value && typeof value.isBound === 'boolean'
    && 'enabled' in value && typeof value.enabled === 'boolean'
    && 'isAdmin' in value && typeof value.isAdmin === 'boolean';
}
async function call(auth: AuthPolicy, path: string, signal: AbortSignal, options: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, {
    ...options, signal, cache: 'no-store', credentials: auth.credentialsMode(), redirect: 'error',
    headers: { ...auth.authHeaders('', options.method), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!response.ok) throw new Error(response.status === 409
    ? 'Конфликт: пользователь уже существует или это последний администратор.'
    : response.status === 403 ? 'Недостаточно прав.' : 'Не удалось выполнить запрос.');
  return response.json();
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }

interface Props {
  users: User[]; feedback: string;
  invite(email: string): Promise<boolean>;
  save(user: User, enabled: boolean, admin: boolean): Promise<void>;
}
function UserRow({ user, save }: { user: User; save: Props['save'] }) {
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState<{enabled: boolean; admin: boolean} | null>(null);
  async function change(enabled: boolean, admin: boolean) {
    if (pending) return;
    setPending(true); setDraft({enabled, admin});
    try { await save(user, enabled, admin); }
    finally { setPending(false); setDraft(null); }
  }
  return <li>
    <div className="user-row-label">
      <strong>{user.name || user.email}</strong>
      <span className="user-row-details">{user.name ? user.email : 'Имя не указано'}</span>
      <span className="user-row-binding">{user.isBound ? 'Google подключён' : 'Ожидает первого входа'}</span>
    </div>
    <label>Доступ<input type="checkbox" checked={draft?.enabled ?? user.enabled} disabled={pending}
      onChange={event => void change(event.target.checked, user.isAdmin)} /></label>
    <label>Администратор<input type="checkbox" checked={draft?.admin ?? user.isAdmin} disabled={pending}
      onChange={event => void change(user.enabled, event.target.checked)} /></label>
  </li>;
}
function UserAdmin({ users, feedback, invite, save }: Props) {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    setPending(true);
    try { if (await invite(email.trim())) setEmail(''); }
    finally { setPending(false); }
  }
  return <>
    <h2 id="user-admin-title">Пользователи FigVam</h2>
    <form id="user-invite" onSubmit={event => void submit(event)}>
      <label htmlFor="user-email">Email приглашённого пользователя<input id="user-email" type="email" required
        maxLength={254} autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} /></label>
      <Button type="submit" disabled={pending}>Добавить</Button>
    </form>
    <p id="user-admin-status" role="status">{feedback}</p>
    <ul id="user-admin-list" aria-label="Пользователи приложения">{users.map(user => <UserRow key={user.id} user={user} save={save} />)}</ul>
  </>;
}

function UserAdminView({visible,epoch,...props}:{visible:boolean;epoch:number}&Parameters<typeof UserAdmin>[0]){
  return <section id="user-admin" hidden={!visible} aria-labelledby="user-admin-title"><UserAdmin key={epoch} {...props}/></section>;
}
export function createUserAdminModel(){return createViewModel(UserAdminView);}
export function createUserAdmin(model:ReturnType<typeof createUserAdminModel>, auth: AuthPolicy) {
  let visible=false;
  let controller: AbortController | null = null;
  let users: User[] = [], feedback = '';
  let epoch = 0;
  const render=()=>model.publish({visible,epoch,users,feedback,invite,save});
  const active = (current: AbortController) => controller === current && !current.signal.aborted;
  async function refresh(current: AbortController) {
    if (!active(current)) return;
    const value = await call(auth, '/api/users', current.signal);
    if (!active(current)) return;
    if (!value || typeof value !== 'object' || !('users' in value) || !Array.isArray(value.users) || !value.users.every(isUser))
      throw new TypeError('Некорректный список пользователей.');
    users = value.users;
    render();
  }
  async function invite(email: string): Promise<boolean> {
    const current = controller;
    if (!current) return false;
    try {
      await call(auth, '/api/users', current.signal, { method: 'POST', body: JSON.stringify({ email }) });
      if (!active(current)) return false;
      feedback = 'Приглашение добавлено.';
      await refresh(current);
      return active(current);
    } catch (error) {
      if (active(current)) { feedback = errorMessage(error); render(); }
      return false;
    }
  }
  async function save(user: User, enabled: boolean, admin: boolean) {
    const current = controller;
    if (!current) return;
    try {
      await call(auth, '/api/users/' + encodeURIComponent(user.id), current.signal,
        { method: 'PUT', body: JSON.stringify({ enabled, admin }) });
      if (active(current)) feedback = 'Изменения сохранены.';
    } catch (error) { if (active(current)) feedback = errorMessage(error); }
    if (!active(current)) return;
    try { await refresh(current); }
    catch (error) { if (active(current)) { feedback = errorMessage(error); render(); } }
  }
  function hide() {
    controller?.abort(); controller = null; visible=false;
    users = []; feedback = ''; epoch++; render();
  }
  render();
  return {
    async show(isAdmin: boolean) {
      hide();
      if (!isAdmin) return;
      visible=true;render();
      const current = new AbortController(); controller = current;
      try { await refresh(current); }
      catch (error) { if (active(current)) { feedback = errorMessage(error); render(); } }
    },
    hide,
  };
}
