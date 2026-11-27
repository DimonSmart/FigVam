import { generation, startRequest, token } from '../core/session';
import { aborted, errorMessage } from '../api/decode';

export type Work = (signal: AbortSignal, current: () => boolean) => Promise<unknown>;
export type Retry = () => Promise<unknown>;

interface RequestLifecycle {
  stopLive(): void;
  startLive(): void;
  message(status?: string, error?: string): void;
  setBusy(busy: boolean): void;
  setControlsDisabled(disabled: boolean): void;
}

/** One owner for the foreground request lifecycle and its retry action. */
export function createRequestRunner(view: RequestLifecycle) {
  let retry: Retry | null = null;
  async function run(action: Retry | null, work: Work, { create = false, quiet = false } = {}): Promise<void> {
    view.stopLive();
    const { signal, current } = startRequest();
    retry = create ? null : action;
    if (!quiet) {
      view.message(create ? 'Создание документа…' : 'Загрузка…');
      view.setBusy(true);
    }
    view.setControlsDisabled(true);
    try {
      await work(signal, () => current === generation);
    } catch (error) {
      if (aborted(error)) return;
      // A 401 clears the whole session, including its generation.
      if (current !== generation && token) return;
      const explanation = error instanceof TypeError ? 'Не удалось связаться с сервером. Проверьте соединение.' : errorMessage(error);
      view.message('', explanation + (create && token ? ' Перед повторным созданием обновите список: запрос мог успеть выполниться.' : ''));
    } finally {
      if (current === generation) {
        if (!quiet) view.setBusy(false);
        view.setControlsDisabled(false);
        view.startLive();
      }
    }
  }
  return {
    run,
    get canRetry() { return retry !== null; },
    retry: () => retry?.(),
    clearRetry: () => { retry = null; },
  };
}
