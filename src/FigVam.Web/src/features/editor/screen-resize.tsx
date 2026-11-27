import { prepareDocumentCommand, type DocumentCommandOperation } from '../../api/document-commands';
import { createViewModel } from '../../app/view-model';
import { Button } from '../../ui/Button';
import { NumberInput } from '../../ui/Inputs';
import { InlineError, StatusMessage } from '../../ui/Feedback';

function ResizeView({saved, hidden, draft, readOnly, pending, retry, error, change, apply, cancel, repeat}: {
  saved: string; hidden: boolean; draft: Record<Axis,string>; readOnly: boolean; pending: boolean;
  retry: boolean; error: string; change(axis: Axis,value: string): void; apply(): void; cancel(): void; repeat(): void;
}) {
  return <>
    <h2 id="screen-size-title">Размер экрана</h2>
    <p id="screen-size-saved">{saved}</p>
    <form id="screen-resize" hidden={hidden} noValidate onSubmit={event => {event.preventDefault(); apply();}}
      onBlur={event => {if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) apply();}}>
      {(['width','height'] as const).map(axis => {
        const id = 'resize-' + axis;
        return <div key={axis} className="resize-field">
          <label htmlFor={id}>{axis === 'width' ? 'Ширина' : 'Высота'} выбранного экрана</label>
          <NumberInput id={id} min={0} step="any" required readOnly={readOnly} value={draft[axis]}
            onChange={event => change(axis,event.currentTarget.value)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') {event.preventDefault(); apply();}
              if (event.key === 'Escape' && !readOnly) {cancel();}
            }}/>
        </div>;
      })}
      <Button id="resize-retry" hidden={!retry} onClick={repeat}>Повторить команду</Button>
    </form>
    <StatusMessage id="screen-size-status">{pending ? 'Ожидание подтверждения…' : ''}</StatusMessage>
    <InlineError id="screen-size-error">{error}</InlineError>
  </>;
}

import type { components } from '../../api/schema.generated';

type Axis = 'width' | 'height';
type ResizeBody = components['schemas']['ResizeScreenRequest'];
interface Operation { body: ResizeBody; mutation: DocumentCommandOperation; state: 'ready' | 'pending' | 'uncertain' | 'sync' }
interface ResizeWorkspace { isEditorVisible(): boolean; 
  documentId: string | null; documentRole: string | null; selectedScreen: string | null;
  screensItems: { id: string; dimensions: { width: number; height: number } }[];
  generation: number; token: string | null; navigationEpoch: number; revision: number | null;
}
interface ResizeOptions {
  model:ReturnType<typeof createScreenResizeModel>;
  element(id: string): HTMLElement;
  request(path: string, options: RequestInit): Promise<unknown>;
  refreshPages(): Promise<unknown>;
  workspace: ResizeWorkspace;
}
export function createScreenResizeModel(){return createViewModel(ResizeView);}
export function createScreenResize({ model, element, request, refreshPages, workspace }: ResizeOptions) {
  const resizeOperations = new Map<string, Operation>();
  let resizeDraftScreen: string | null = null, resizeError: string | null = null, resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const dirtyAxes = new Set<Axis>();
  const draft: Record<Axis, string> = { width: '', height: '' };
  function resizeKey(id: string | null, screen: string | null) { return `${id}:${screen}`; }
  function renderScreenSize() {
    const screen = workspace.screensItems.find(item => item.id === workspace.selectedScreen);
    const operation = screen && resizeOperations.get(resizeKey(workspace.documentId, screen.id));
    if (resizeDraftScreen !== (screen?.id ?? null)) {
      resizeDraftScreen = screen?.id ?? null; dirtyAxes.clear(); resizeError = null;
    }
    if (screen) {
      for (const axis of ['width', 'height'] as const) {
        const sent = operation && operation.body[axis === 'width' ? 'updateWidth' : 'updateHeight'];
        if (sent) draft[axis] = String(operation.body.dimensions[axis]);
        else if (!dirtyAxes.has(axis)) draft[axis] = String(screen.dimensions[axis]);
      }
    }
    model.publish({
      saved:screen ? `Подтверждённый размер: ${screen.dimensions.width} × ${screen.dimensions.height} uiUnit` : 'Выберите экран.',
      hidden:!screen || !['Owner','Editor'].includes(workspace.documentRole ?? ''),
      draft:{...draft},readOnly:!!operation,pending:operation?.state==='pending',
      retry:operation?.state==='uncertain'||operation?.state==='sync',error:operation?.state==='uncertain'?'Результат неизвестен. Повторите ту же команду.':operation?.state==='sync'?'Изменение подтверждено. Повторите обновление.':resizeError??'',
      change,apply:applyResize,cancel:cancelDraft,repeat
    });
  }
  function change(axis: Axis, value: string) {
    draft[axis] = value; dirtyAxes.add(axis); resizeError = null;
    clearTimeout(resizeTimer);
    const screen = workspace.selectedScreen, doc = workspace.documentId;
    resizeTimer = setTimeout(() => {
      if (screen === workspace.selectedScreen && doc === workspace.documentId) applyResize();
    }, 500);
    renderScreenSize();
  }
  function cancelDraft() {
    clearTimeout(resizeTimer); dirtyAxes.clear(); resizeError = null; renderScreenSize();
  }
  function applyResize() {
    clearTimeout(resizeTimer);
    if (!dirtyAxes.size) return;
    if (!workspace.documentId || !workspace.selectedScreen || !['Owner', 'Editor'].includes(workspace.documentRole ?? '')) return;
    const width = draft.width === '' ? NaN : Number(draft.width), height = draft.height === '' ? NaN : Number(draft.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
      resizeError = 'Введите конечные неотрицательные ширину и высоту.'; renderScreenSize(); return;
    }
    const key = resizeKey(workspace.documentId, workspace.selectedScreen);
    if (resizeOperations.has(key)) return;
    const saved = workspace.screensItems.find(item => item.id === workspace.selectedScreen)?.dimensions;
    const updateWidth = dirtyAxes.has('width') && saved?.width !== width;
    const updateHeight = dirtyAxes.has('height') && saved?.height !== height;
    if (!updateWidth && !updateHeight) { dirtyAxes.clear(); return; }
    const body:ResizeBody={commandId:crypto.randomUUID(),screenId:workspace.selectedScreen,dimensions:{width,height},updateWidth,updateHeight};
    const operation: Operation = {body,mutation:prepareDocumentCommand(workspace.documentId,'resize-screen',body),state:'ready'};
    resizeError = null; resizeOperations.set(key, operation); sendResize(workspace.documentId, workspace.selectedScreen, operation);
  }
  function repeat() {
    const operation = resizeOperations.get(resizeKey(workspace.documentId, workspace.selectedScreen));
    if (workspace.documentId && workspace.selectedScreen && (operation?.state === 'uncertain' || operation?.state === 'sync'))
      void sendResize(workspace.documentId, workspace.selectedScreen, operation);
  }
  async function sendResize(id: string, screen: string, operation: Operation) {
    const key=resizeKey(id,screen),epoch=workspace.navigationEpoch,requestToken=workspace.token;
    if(operation.state==='pending'||resizeOperations.get(key)!==operation)return;
    const active=()=>workspace.navigationEpoch===epoch&&workspace.documentId===id&&workspace.token===requestToken&&workspace.isEditorVisible()&&resizeOperations.get(key)===operation;
    operation.state='pending';renderScreenSize();
    try{
      const result=await operation.mutation.execute({request,isCurrent:active,synchronize:async confirmation=>{
        await refreshPages();
        return active()&&(workspace.revision??-1)>=confirmation.revision;
      }});
      if(resizeOperations.get(key)!==operation)return;
      if(result.kind==='confirmed'&&result.synchronization==='synced'){
        resizeOperations.delete(key);if(workspace.documentId===id&&workspace.selectedScreen===screen)dirtyAxes.clear();
      }else if(result.kind==='confirmed')operation.state='sync';
      else if(result.kind==='uncertain')operation.state='uncertain';
      else if(result.kind==='rejected'||result.kind==='conflict'){
        const visible=active()&&workspace.selectedScreen===screen;
        resizeOperations.delete(key);if(visible){dirtyAxes.clear();resizeError=result.error instanceof Error?result.error.message:String(result.error);}
      }
    }finally{if(workspace.token===requestToken&&workspace.documentId===id&&workspace.selectedScreen===screen&&workspace.isEditorVisible())renderScreenSize();}
  }

  renderScreenSize();
  return {
    render: renderScreenSize,
    dispose() { clearTimeout(resizeTimer); model.clear(); resizeOperations.clear(); },
    resetDraft() { clearTimeout(resizeTimer); dirtyAxes.clear(); resizeError = null; resizeDraftScreen = null; },
    discardDocument(doc:string) { clearTimeout(resizeTimer);for(const id of resizeOperations.keys())if(id.startsWith(doc+':'))resizeOperations.delete(id);dirtyAxes.clear();resizeError=null;resizeDraftScreen=null; },
    clear() { clearTimeout(resizeTimer); resizeOperations.clear(); resizeDraftScreen = null; dirtyAxes.clear(); resizeError = null; }
  };
}
