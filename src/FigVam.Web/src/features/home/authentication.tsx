import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createPanelRoot } from '../../app/react-panels';
import type { AuthMode } from '../../api/auth-client';
import { Button } from '../../ui/Button';

interface AuthenticationState {
  visible: boolean;
  mode: AuthMode | null;
  error: string;
  reset: number;
}

function Authentication({ state, submit }: {
  state: AuthenticationState;
  submit: (token: string) => void;
}) {
  const [draft, setDraft] = useState('');
  return <section id="authentication" aria-labelledby="authentication-title" hidden={!state.visible}>
    <h1 id="authentication-title">Открыть рабочее пространство</h1>
    <p id="authentication-help">{state.mode === 'bearer'
      ? 'Для API-режима введите выданный Bearer-токен. Вход через Google настроен отдельно.'
      : 'Войдите с помощью Google. Доступ предоставляется администратором FigVam.'}</p>
    <p id="authentication-error" role="alert">{state.error}</p>
    <a id="google-login" href="/api/auth/login" hidden={state.mode !== 'google'}>Войти через Google</a>
    <form id="authentication-form" autoComplete="off" hidden={state.mode !== 'bearer'} onSubmit={event => {
      event.preventDefault();
      submit(draft.trim());
    }}>
      <label htmlFor="token">Bearer-токен</label>
      <input id="token" type="password" required autoComplete="off" spellCheck={false}
        aria-describedby="token-help" value={draft} onChange={event => setDraft(event.target.value)} />
      <p id="token-help">Без префикса Bearer. Получение токена находится вне FigVam.</p>
      <Button type="submit">Продолжить</Button>
    </form>
  </section>;
}

/** Transitional boundary: editor commands remain outside the React-owned subtree. */
export function createAuthenticationView(host: HTMLElement, submit: (token: string) => void) {
  const root = createPanelRoot(host);
  let state: AuthenticationState = { visible: true, mode: null, error: '', reset: 0 };
  function update(patch: Partial<AuthenticationState>) {
    state = { ...state, ...patch };
    flushSync(() => root.render(<Authentication key={state.reset} state={state} submit={submit} />));
  }
  update({});
  return {
    setMode: (mode: AuthMode) => update({ mode }),
    setVisible: (visible: boolean) => update({ visible }),
    setError: (error: string) => update({ error }),
    clearToken: () => update({ reset: state.reset + 1 }),
    focusToken: () => host.querySelector<HTMLInputElement>('#token')?.focus(),
  };
}
