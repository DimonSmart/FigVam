import { createDocumentCommand, type DocumentCommandRequest, type DocumentCommandOperation } from '../api/document-commands';
import { errorMessage } from '../api/decode';
import type { ApiClient } from '../api/api-client';

type PageCommandName = 'add-page' | 'rename-page' | 'delete-page' | 'add-screen' | 'rename-screen' | 'duplicate-screen' | 'delete-screen';
export type PageCommandData = { [K in PageCommandName]: Omit<DocumentCommandRequest<K>, 'commandId'> };

export function preparePageCommand<K extends PageCommandName>(documentId: string, command: K, data: PageCommandData[K]) {
  return createDocumentCommand(documentId, command, data);
}

interface Context {
  documentId: string | null;
  revision: number | null;
  navigationEpoch: number;
  sessionEpoch: number;
  page: string | null;
  screen: string | null;
  canEdit: boolean;
}
interface Dependencies {
  request: ApiClient;
  context(): Context;
  stopLive(): void;
  startLive(): void;
  setBusy(value: boolean): void;
  setRetry(retry: (() => Promise<unknown>) | null): void;
  message(status?: string, error?: string): void;
  select(page?: string | null, screen?: string): void;
  refresh(signal: AbortSignal, current: () => boolean): Promise<true | undefined>;
}
interface Pending {
  operation: DocumentCommandOperation;
  origin: Context;
  nextPage?: string | null;
  nextScreen?: string;
  controller: AbortController | null;
}

/** One outstanding navigation mutation per document. Navigation does not cancel
 * the write or lose its confirmation; a retry resends only an uncertain write. */
export function createPageCommands(deps: Dependencies) {
  const pending = new Map<string, Pending>();
  const active = (context: Context) => {
    const now = deps.context();
    return now.documentId === context.documentId && now.navigationEpoch === context.navigationEpoch &&
      now.sessionEpoch === context.sessionEpoch && now.canEdit;
  };
  function report(entry: Pending) {
    const state = entry.operation.getSnapshot();
    if (entry.controller) { deps.message('Отправка изменений в общий черновик…'); return; }
    if (state.kind === 'uncertain' || state.kind === 'confirmed') {
      deps.setRetry(() => execute(entry));
      deps.message('', state.kind === 'confirmed'
        ? 'Команда подтверждена. Не удалось обновить документ. Повторите обновление.'
        : 'Результат команды неизвестен. Повторите запрос с исходными параметрами: команда могла выполниться.');
    }
  }
  async function execute(entry: Pending): Promise<void> {
    const context = deps.context(), id = entry.operation.documentId;
    if (entry.controller || context.documentId !== id || !context.canEdit || pending.get(id) !== entry) return;
    const controller = new AbortController();
    entry.controller = controller;
    const current = () => active(context) && pending.get(id) === entry;
    deps.stopLive();
    deps.setRetry(null);
    deps.setBusy(true);
    deps.message('Отправка изменений в общий черновик…');
    try {
      const result = await entry.operation.execute({
        request: deps.request, signal: controller.signal, isCurrent: current,
        synchronize: async confirmation => {
          if (context.navigationEpoch === entry.origin.navigationEpoch &&
              deps.context().page === entry.origin.page && deps.context().screen === entry.origin.screen)
            deps.select(entry.nextPage, entry.nextScreen);
          const refreshed = await deps.refresh(controller.signal, current);
          return refreshed === true && (deps.context().revision ?? -1) >= confirmation.revision;
        },
      });
      if (pending.get(id) !== entry) return;
      if (result.kind === 'confirmed' && result.synchronization === 'synced') {
        pending.delete(id);
        if (active(context)) deps.message('Изменения подтверждены в общем черновике.');
      } else if (result.kind === 'conflict' || result.kind === 'rejected') {
        pending.delete(id);
        if (active(context)) {
          if (result.kind === 'conflict') {
            try { await deps.refresh(controller.signal, () => active(context)); } catch { /* original conflict remains authoritative */ }
          }
          if (active(context)) deps.message('',errorMessage(result.error));
        }
      }
    } finally {
      entry.controller = null;
      if (active(context)) {
        deps.setBusy(false);
        deps.startLive();
        if (pending.get(id) === entry) report(entry);
      }
    }
  }
  async function start<K extends PageCommandName>(command: K, data: PageCommandData[K], nextPage?: string | null, nextScreen?: string) {
    const origin = deps.context(), id = origin.documentId;
    if (!id || !origin.canEdit) return;
    const existing = pending.get(id);
    if (existing) { report(existing); return; }
    const entry: Pending = { operation: preparePageCommand(id, command, data), origin, nextPage, nextScreen, controller: null };
    pending.set(id, entry);
    await execute(entry);
  }
  function resume() {
    const context = deps.context(), entry = context.documentId && pending.get(context.documentId);
    if (!entry || !context.canEdit) return;
    const state = entry.operation.getSnapshot();
    if (state.kind === 'confirmed' && !entry.controller && (context.revision ?? -1) >= state.confirmation.revision) {
      pending.delete(entry.operation.documentId);
      return;
    }
    report(entry);
  }
  function discard(id: string) {
    const entry = pending.get(id);
    pending.delete(id);
    entry?.controller?.abort();
  }
  return {start,resume,discard,clear(){for(const id of pending.keys())discard(id);}};
}
