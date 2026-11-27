import { InlineError } from '../../ui/Feedback';
import { useState } from 'react';
import { createViewModel } from '../../app/view-model';
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
    <InlineError id="authentication-error">{state.error}</InlineError>
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

function AuthenticationView(props: Parameters<typeof Authentication>[0]) {
  return <Authentication key={props.state.reset} {...props}/>;
}
export function createAuthenticationModel() { return createViewModel(AuthenticationView); }

export function createAuthenticationView(model: ReturnType<typeof createAuthenticationModel>, submit: (token: string) => void) {
  let state: AuthenticationState = { visible: true, mode: null, error: '', reset: 0 };
  function update(patch: Partial<AuthenticationState>) {
    state = { ...state, ...patch };
    model.publish({ state, submit });
  }
  update({});
  return {
    setMode: (mode: AuthMode) => update({ mode }),
    setVisible: (visible: boolean) => update({ visible }),
    setError: (error: string) => update({ error }),
    clearToken: () => update({ reset: state.reset + 1 }),
    focusToken: () => requestAnimationFrame(() => document.getElementById('token')?.focus()),
  };
}
