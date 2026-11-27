import { InlineError, StatusMessage } from '../../ui/Feedback';
import { createViewModel } from '../../app/view-model';
import { Button } from '../../ui/Button';
import type { components } from '../../api/schema.generated';
import type { ApiClient } from '../../api/api-client';

type Item = Pick<components['schemas']['StructureDiagnostic'], 'code' | 'path' | 'message'> & Partial<Pick<components['schemas']['StructureDiagnostic'], 'property' | 'referenceId'>>;
interface Context { documentId: string | null; screen: string | null; revision: number | null; token: string | null; navigationEpoch: number }
interface State { status: string; error: string; items: Item[]; offset: number; total: number; retry: boolean }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function item(value: unknown): value is Item {
  return record(value) && typeof value.code === 'string' && typeof value.path === 'string' && typeof value.message === 'string' &&
    (value.property == null || typeof value.property === 'string') && (value.referenceId == null || typeof value.referenceId === 'string');
}
function Diagnostics({state, previous, next, reload}: {state: State; previous(): void; next(): void; reload(): void}) {
  return <>
    <h2 id="diagnostics-title">Диагностика экрана</h2>
    <StatusMessage id="diagnostics-status">{state.status}</StatusMessage>
    <InlineError id="diagnostics-error">{state.error}</InlineError>
    <Button id="diagnostics-retry" hidden={!state.retry} onClick={reload}>Повторить загрузку диагностики</Button>
    <ul id="diagnostics-list" aria-label="Диагностика выбранного экрана">{state.items.map((entry, i) => <li key={i}>
      {[entry.code, entry.path, entry.message, entry.referenceId ? 'ID ссылки: ' + entry.referenceId : null, entry.property ? 'Свойство: ' + entry.property : null].filter(Boolean).join(' — ')}
    </li>)}</ul>
    <div role="group" aria-label="Страницы диагностики">
      <Button id="diagnostics-previous" disabled={state.offset === 0 || state.items.length === 0} onClick={previous}>Предыдущие диагностики</Button>{' '}
      <span id="diagnostics-number">{state.total ? (state.offset + 1) + '–' + (state.offset + state.items.length) + ' из ' + state.total : ''}</span>{' '}
      <Button id="diagnostics-next" disabled={state.offset + state.items.length >= state.total || !state.items.length} onClick={next}>Следующие диагностики</Button>
    </div>
  </>;
}
export function createScreenDiagnosticsModel(){return createViewModel(Diagnostics);}
export function createScreenDiagnostics({model, element, request, getContext, pageSize}: {
  model:ReturnType<typeof createScreenDiagnosticsModel>; element(id: string): HTMLElement; request: ApiClient; getContext(): Context; pageSize: number;
}) {
  let controller: AbortController | null = null, generation = 0, offset = 0, total = 0, key: string | null = null;
  const initial = (): State => ({ status: 'Выберите экран.', error: '', items: [], offset: 0, total: 0, retry: false });
  let state = initial();
  function render(next: State) {
    state = next;
    model.publish({state,previous:()=>{offset=Math.max(0,offset-pageSize);void load();},
      next:()=>{if(offset+pageSize<total){offset+=pageSize;void load();}},reload:()=>void load()});
  }
  function reset() {
    controller?.abort(); controller = null; generation++; offset = total = 0; key = null; render(initial());
  }
  async function load() {
    controller?.abort();
    const operation = new AbortController(), current = ++generation;
    controller = operation;
    const { documentId: doc, screen, revision, token, navigationEpoch } = getContext(), atOffset = offset;
    if (!doc || !screen || !Number.isSafeInteger(revision)) { reset(); return; }
    key = doc + ':' + screen + ':' + revision;
    const valid = () => {
      const context = getContext();
      return !operation.signal.aborted && current === generation && doc === context.documentId &&
        screen === context.screen && revision === context.revision && token === context.token && navigationEpoch === context.navigationEpoch && !element('editor-view').hidden;
    };
    render({...initial(), status: 'Загрузка диагностики…'});
    try {
      const query = new URLSearchParams({ screenId: screen, revision: String(revision), offset: String(atOffset), limit: String(pageSize) });
      const result = await request('/api/v1/documents/' + encodeURIComponent(doc) + '/diagnostics?' + query, {}, operation.signal);
      if (!valid()) return;
      if (!record(result) || typeof result.documentId !== 'string' || result.documentId.toLowerCase() !== doc.toLowerCase() ||
        typeof result.screenId !== 'string' || result.screenId.toLowerCase() !== screen.toLowerCase() ||
        result.revision !== revision || result.offset !== atOffset || result.limit !== pageSize ||
        typeof result.total !== 'number' || !Number.isInteger(result.total) || result.total < 0 || !Array.isArray(result.items) || !result.items.every(item))
        throw new TypeError('Некорректный ответ');
      total = result.total;
      render({ ...initial(), status: total ? 'Диагностика выбранного экрана.' : 'Диагностик для выбранного экрана нет.', items: result.items, total, offset: atOffset });
    } catch (error) {
      if (!valid() || (error instanceof Error && error.name === 'AbortError')) return;
      render({...initial(), status: 'Не удалось загрузить диагностику.', retry: true,
        error: error instanceof TypeError ? 'Не удалось получить корректный ответ сервера.' : error instanceof Error ? error.message : String(error)});
    }
  }
  function refresh() {
    const {documentId, screen, revision} = getContext();
    const next = screen ? documentId + ':' + screen + ':' + revision : null;
    if (key !== next) {reset(); if (screen) void load();}
  }
  render(initial()); return {reset, refresh};
}
