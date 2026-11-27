import { createViewModel } from '../../app/view-model';
import { Button } from '../../ui/Button';
import type { ApiClient } from '../../api/api-client';
import { ApiError } from '../../api/api-client';
import { requiredRecord, array, text } from '../../api/decode';
import type { Catalog } from './interaction-catalog';
import type { ActionDraft, ScenarioDraft, EditorContext } from './interaction-editor';
import type { LayerCaptionSource } from '../../core/layer-caption';
type Node=LayerCaptionSource & {id:string;screenId?:string;label?:string};
interface Workspace { isEditorVisible(): boolean; documentId:string|null;selectedScreen:string|null;layerSelection:Node|null;revision:number|null;documentRole:string|null}
interface Options {models:ReturnType<typeof createScenarioModels>;element(id:string):HTMLElement;request:ApiClient;pageSize:number;workspace:Workspace;findLayer(id:string):Node|undefined|null;setInteractiveNodes(ids:string[]):void;selectSource(node:Node,nodes:Node[]):void;reloadPages(revision:number|null,active:()=>boolean):Promise<unknown>;findRole(doc:string,signal?:AbortSignal):Promise<string|null|undefined>;setDocumentRole(role:string):void;closeInaccessibleDocument(status:number):void}
type CommandKind='create'|'update'|'delete';
type Operation={kind:CommandKind;body:{commandId:string;expectedRevision:number;scenarioId?:string;scenario?:ScenarioDraft};state:'ready'|'pending'|'uncertain';token:string|null;doc:string;screen:string};
function typed<T extends HTMLElement>(node:HTMLElement,ctor:{new():T}):T{if(!(node instanceof ctor))throw new Error('Unexpected scenario element: '+node.id);return node;}
function readScenario(value:unknown):ScenarioDraft{const s=requiredRecord(value);if(typeof s.event!=='number'||!Number.isInteger(s.event))throw new TypeError('Некорректное взаимодействие');return{id:text(s.id),screenId:text(s.screenId),nodeId:text(s.nodeId),event:s.event,actions:array(s.actions,a=>{const v=requiredRecord(a),type=text(v.type);if(!Object.hasOwn(actionLabels,type))throw new TypeError('Неизвестное действие');switch(type){case 'navigate':case 'openOverlay':return{type,screenId:text(v.screenId)};case 'showVariant':return{type,variantId:v.variantId==null?null:text(v.variantId)};case 'selectDataset':return{type,datasetId:v.datasetId==null?null:text(v.datasetId)};case 'setDemoValue':return{type,nodeId:text(v.nodeId),value:v.value==null?null:text(v.value)};case 'closeOverlay':case 'resetPreview':return{type};default:throw new TypeError('Неизвестное действие');}})};}
import { token, navigationEpoch } from '../../core/session';
import { layerDisplayName } from '../../core/layer-caption';
import { readInteractionCatalog, interactionObjectName } from './interaction-catalog';
import { createInteractionEditor, createInteractionModel, eventLabels, actionLabels } from './interaction-editor';

interface ScenarioListProps {
  items:(ScenarioDraft|[string,ScenarioDraft[]])[];c:EditorContext;catalog:Catalog|null;
  collapsedGroups:ReadonlySet<string>;blocked:boolean;
  name(kind:keyof Catalog,id:string|null|undefined):string;sourceName(id:string):string;description(scenario:ScenarioDraft):string;actionText(action:ActionDraft):string;
  selectSource(node:Node,nodes:Node[]):void;edit(scenario:ScenarioDraft,opener:HTMLElement):void;remove(scenario:ScenarioDraft):void;toggle(id:string,open:boolean):void;
}
function ScenarioList({items,c,catalog,collapsedGroups,blocked,name,sourceName,description,actionText,selectSource,edit,remove,toggle}:ScenarioListProps){
  function renderAction(action:ActionDraft,index:number,total:number) {
    const screen = action.type === 'navigate' ? catalog?.screens.find(s => s.id === action.screenId) : undefined;
    const prefix = screen ? screen.pageName + ' / ' : '';
    return <li key={index} className="scenario-action" title={action.type === 'navigate' ? actionText(action) : undefined}>
      {total > 1 && <span className="scenario-action-order">{index + 1}.</span>}
      {action.type === 'navigate' ? <>
        <span className="scenario-action-arrow" aria-hidden="true">→</span>
        <span className="scenario-sr-only">{actionLabels.navigate}: </span>
        <span className="scenario-target">
          <span className="scenario-target-name">{screen && screen.label.startsWith(prefix) ? screen.label.slice(prefix.length) : name('screens',action.screenId)}</span>
          {screen && <span className="scenario-target-page">{screen.pageName}</span>}
        </span>
      </> : <span>{actionText(action)}</span>}
    </li>;
  }

  function renderScenario(scenario:ScenarioDraft,c:EditorContext) {
    const event = eventLabels[scenario.event??-1] ?? 'Неизвестное событие';
    const source = !c.node && catalog?.nodes.find(n => n.id === scenario.nodeId && n.screenId === c.screen);
    return <li key={scenario.id} className="scenario-entry" data-scenario-id={scenario.id}>
      <div className="scenario-event">{source ?
        <Button className="scenario-source-select" aria-label={description(scenario)} title={'Выбрать элемент: ' + sourceName(source.id)}
          onClick={() => selectSource(source,catalog?.nodes.filter(n => n.screenId === c.screen)??[])}>{event}</Button> : <span>{event}</span>}</div>
      <ol className="scenario-actions" aria-label="Действия по порядку">
        {scenario.actions.map((action,index)=>renderAction(action,index,scenario.actions.length))}
      </ol>
      {c.editable && c.node && <div className="scenario-entry-controls">
        <Button aria-label={'Изменить сценарий ' + description(scenario)} disabled={blocked}
          onClick={event=>edit(scenario,event.currentTarget)}>Изменить</Button>
        <Button aria-label={'Удалить сценарий ' + description(scenario)} disabled={blocked}
          onClick={()=>remove(scenario)}>Удалить</Button>
      </div>}
    </li>;
  }

  function renderGroup(nodeId:string,entries:ScenarioDraft[],c:EditorContext) {
    return <li key={nodeId} className="scenario-group" data-node-id={nodeId}>
      <details open={!collapsedGroups.has(nodeId)} onToggle={event=>{
        if (!event.currentTarget.isConnected) return;
        toggle(nodeId,event.currentTarget.open);
      }}>
        <summary><span className="scenario-group-name">{sourceName(nodeId)}</span>
          <span className="scenario-group-count" aria-label={'Взаимодействий: ' + entries.length}>{entries.length}</span></summary>
        <ul className="scenario-group-items">{entries.map(scenario=>renderScenario(scenario,c))}</ul>
      </details>
    </li>;
  }


  return <>{items.map(item=>Array.isArray(item)?renderGroup(item[0],item[1],c):renderScenario(item,c))}</>;
}
export function createScenarioModels(){return {list:createViewModel(ScenarioList),actions:createInteractionModel()};}

export function createScenarios({
  models, element, request, pageSize, workspace, findLayer, setInteractiveNodes, selectSource,
  reloadPages, findRole, setDocumentRole, closeInaccessibleDocument
}:Options) {
  let controller:AbortController|null=null,generation=0,offset=0,catalog:Catalog|null=null,scenarios:ScenarioDraft[]|null=null,key:string|null=null;
  let loadState:'empty'|'loading'|'ready'|'error'='empty',notice='',errorNotice='',leave:(()=>void)|null=null,catalogLoading=false;
  const operations = new Map<string,Operation>();
  const btn=(id:string)=>typed(element(id),HTMLButtonElement);
  const collapsedGroups = new Set<string>();
  const context = ():EditorContext => ({
    doc: workspace.documentId, screen: workspace.selectedScreen, node: workspace.layerSelection?.id ?? null,
    revision: workspace.revision, token, epoch: navigationEpoch,
    editable: !!token && ['Owner', 'Editor'].includes(workspace.documentRole??'') && workspace.isEditorVisible()
  });
  const operationKey = (c:{doc:string|null;screen:string|null}) => c.doc + '/' + c.screen;
  const currentOperation = () => operations.get(operationKey(context()));
  const opPending = () => ['pending', 'uncertain'].includes(currentOperation()?.state??'');
  const sameScreen = (c:EditorContext) => c.doc === workspace.documentId && c.screen === workspace.selectedScreen && c.token === token &&
    c.epoch === navigationEpoch && workspace.isEditorVisible();
  const name = (kind:keyof Catalog,id:string|null|undefined)=>interactionObjectName(catalog,kind,id??'');
  function sourceName(id:string) {
    const node = catalog?.nodes.find(n => n.id === id) ?? findLayer(id);
    if (!node) return 'Элемент недоступен';
    const display = layerDisplayName(node);
    const caption = display.source === 'missing' ? node.kind : display.text;
    const duplicates = catalog?.nodes.filter(n => n.screenId === node.screenId && n.kind === node.kind && (layerDisplayName(n).source === 'missing' ? n.kind : layerDisplayName(n).text) === caption) ?? [];
    return duplicates.length > 1 ? (node.label ?? caption) : caption;
  }
  const description = (scenario:ScenarioDraft) => sourceName(scenario.nodeId) + ' · ' + (eventLabels[scenario.event??-1] ?? 'Неизвестное событие');
  function actionText(action:ActionDraft) {
    const label = (action.type?actionLabels[action.type]:undefined) ?? 'Неизвестное действие';
    switch (action.type) {
      case 'navigate': case 'openOverlay': return label + ' · ' + name('screens', action.screenId);
      case 'showVariant': return label + ' · ' + (action.variantId === null ? 'Базовое состояние' : name('variants', action.variantId));
      case 'selectDataset': return label + ' · ' + (action.datasetId === null ? 'Без датасета' : name('datasets', action.datasetId));
      case 'setDemoValue': return label + ' · ' + name('nodes', action.nodeId) + ' · ' + (action.value === null ? 'null' : action.value === '' ? 'Пустая строка' : 'Значение задано');
      default: return label;
    }
  }
  const editor = createInteractionEditor({
    model:models.actions,element, request, current: context, catalog: () => catalog, sourceName,
    submit: (draft, scenario) => begin(draft.creating ? 'create' : 'update', scenario, draft.revision),
    pending: opPending, onClose: () => render()
  });
  const dialog = typed(element('scenario-leave-dialog'),HTMLDialogElement);
  function closeDialog() { if (dialog.open) dialog.close(); }
  function requestLeave(next:()=>void) {
    if (!editor.draft) return true;
    if (opPending()) {
      // The immutable command is kept independently of the inspector and may be retried on return.
      leave = null; editor.close(); return true;
    }
    if (!editor.dirty()) { editor.close(); return true; }
    leave = next;
    btn('scenario-leave-save').disabled = !editor.canSave();
    if (!dialog.open) dialog.showModal();
    return false;
  }
  element('scenario-leave-stay').addEventListener('click', () => { leave = null; closeDialog(); });
  dialog.addEventListener('cancel', () => { leave = null; });
  element('scenario-leave-discard').addEventListener('click', () => {
    const next = leave; leave = null; closeDialog(); editor.close(); next?.();
  });
  element('scenario-leave-save').addEventListener('click', () => {
    if (editor.save()) closeDialog();
  });

  function render() {
    const c = context(), op = currentOperation(), selected = workspace.layerSelection;
    element('scenarios-title').textContent = selected ? sourceName(selected.id) : 'Взаимодействия';
    element('scenarios-context').textContent = selected ? selected.kind :
      c.screen ? 'Экран ' + (catalog?.screens.find(s => s.id === c.screen)?.name || '') : '';
    element('scenarios-count').textContent = '';
    element('scenarios-count').hidden = true;
    element('scenarios-pagination').hidden = true;
    element('scenario-create').hidden = !c.editable || !c.node || loadState !== 'ready' || !!editor.draft;
    btn('scenario-create').disabled = opPending();
    btn('scenario-edit-reload').disabled = loadState !== 'ready';
    element('scenario-command-status').textContent = op?.state === 'pending' ? 'Сохранение изменений…' : notice;
    element('scenario-command-error').textContent = op?.state === 'uncertain' ? 'Результат команды неизвестен. Повторите ту же команду.' : errorNotice;
    element('scenario-command-retry').hidden = !c.editable || op?.state !== 'uncertain';
    element('scenario-command-retry').textContent = op?.kind === 'delete' ? 'Повторить удаление сценария' : 'Повторить сохранение взаимодействия';
    element('scenarios-retry').hidden = loadState !== 'error';
    element('scenarios-error').textContent = loadState === 'error' ? 'Не удалось загрузить взаимодействия. Повторите запрос.' : '';
    element('scenarios-number').textContent = '';
    btn('scenarios-previous').disabled = btn('scenarios-next').disabled = true;
    if (loadState !== 'ready') {
      models.list.clear();
      element('scenarios-status').textContent = loadState === 'loading' ? 'Загрузка сценариев…' :
        loadState === 'error' ? 'Не удалось загрузить сценарии.' : 'Выберите экран.';
      editor.refreshControls(); return;
    }
    const visible = c.node ? (scenarios??[]).filter(s=>s.nodeId===c.node) : scenarios??[];
    const groups = new Map<string,ScenarioDraft[]>();
    if (!c.node) for (const scenario of visible) {
      if (!groups.has(scenario.nodeId)) groups.set(scenario.nodeId, []);
      groups.get(scenario.nodeId)?.push(scenario);
    }
    // Overview pages contain whole element groups. Selected-element pages contain scenarios.
    const rows = c.node ? visible : [...groups.entries()];
    if (offset >= rows.length) offset = Math.max(0, Math.floor((rows.length - 1) / pageSize) * pageSize);
    const items = rows.slice(offset, offset + pageSize);
    const count = element('scenarios-count');
    count.textContent = String(visible.length); count.hidden = false;
    count.setAttribute('aria-label', 'Взаимодействий: ' + visible.length);
    element('scenarios-status').textContent = visible.length ? '' :
      c.node ? (c.editable ? 'Нет взаимодействий. Добавьте взаимодействие, чтобы определить поведение элемента.' : 'Нет взаимодействий.') :
        'Сценариев для выбранного экрана нет.';
    element('scenarios-pagination').hidden = rows.length <= pageSize;
    element('scenarios-number').textContent = rows.length > pageSize ?
      (offset + 1) + '–' + (offset + items.length) + ' из ' + rows.length : '';
    btn('scenarios-previous').disabled = offset === 0;
    btn('scenarios-next').disabled = offset + items.length >= rows.length;
    models.list.publish({items,c,catalog,collapsedGroups:new Set(collapsedGroups),blocked:opPending()||!!editor.draft,name,sourceName,description,actionText,selectSource,
      edit:(scenario,opener)=>{editor.open(scenario,opener);render();},
      remove:scenario=>{if(confirm('Удалить взаимодействие «'+description(scenario)+'»?'))begin('delete',scenario,c.revision);},
      toggle:(id,open)=>{if(open)collapsedGroups.delete(id);else collapsedGroups.add(id);}});
    editor.refreshControls();
  }

  async function readAll(c:EditorContext, signal:AbortSignal):Promise<ScenarioDraft[]> {
    if(!c.doc||!c.screen)throw new Error('Missing scenario context');
    const items:ScenarioDraft[]=[];
    let total:number|undefined;
    do {
      const query = new URLSearchParams({ screenId: c.screen, revision: String(c.revision), offset: String(items.length), limit: String(pageSize) });
      const result=requiredRecord(await request('/api/v1/documents/'+encodeURIComponent(c.doc)+'/scenarios?'+query,{},signal));
      if (result.documentId !== c.doc || result.revision !== c.revision || result.offset !== items.length ||
          result.limit !== pageSize || typeof result.total!=='number'||!Number.isSafeInteger(result.total) || !Array.isArray(result.items) ||
          result.total < items.length + result.items.length || (!result.items.length && items.length < result.total) ||
          (total !== undefined && total !== result.total)) throw new TypeError('Некорректный ответ о сценариях');
      const decoded=result.items.map(readScenario);
      for (const s of decoded) {
        if (s.screenId !== c.screen || typeof s.id !== 'string' || typeof s.nodeId !== 'string' ||
            !Number.isInteger(s.event) || !eventLabels[s.event??-1] || !Array.isArray(s.actions))
          throw new TypeError('Некорректное взаимодействие');
      }
      items.push(...decoded); total = result.total;
    } while (items.length < total);
    return items;
  }

  const prototypeVisible = () => element('tab-prototype').getAttribute('aria-selected') === 'true';
  async function loadFailed(error:unknown,c:EditorContext,valid:()=>boolean,signal:AbortSignal) {
    if (!valid()) return;
    if (error instanceof ApiError && c.doc && (error.status===403||error.code==='DOCUMENT_NOT_FOUND')) {
      const role = await findRole(c.doc, signal).catch(() => undefined);
      if (!valid()) return;
      if (role === null || error.code === 'DOCUMENT_NOT_FOUND') { closeInaccessibleDocument(error.status); return; }
    }
    loadState = 'error'; render();
  }
  async function ensureCatalog() {
    if (!prototypeVisible() || !scenarios || catalog || catalogLoading || !controller || loadState === 'error') return;
    const c = context(), version = generation, signal = controller.signal;
    const valid = () => version === generation && !signal.aborted && sameScreen(c) && workspace.revision === c.revision;
    catalogLoading = true; loadState = 'loading'; render();
    try {
      if(!c.doc||c.revision===null)return;
      const objects=await readInteractionCatalog(request,c.doc,c.revision,signal);
      if (!valid()) return;
      catalog = objects; loadState = 'ready'; render();
    } catch (error) {
      await loadFailed(error, c, valid, signal);
    } finally {
      if (valid()) catalogLoading = false;
    }
  }
  new MutationObserver(() => ensureCatalog()).observe(element('tab-prototype'), {
    attributes: true, attributeFilter: ['aria-selected']
  });
  async function load() {
    controller?.abort(); controller = new AbortController();
    const c = context(), version = ++generation, signal = controller.signal;
    if (!c.doc || !c.screen || !Number.isSafeInteger(c.revision)) { reset(); return; }
    key = c.doc + ':' + c.screen + ':' + c.revision;
    const valid = () => version === generation && !signal.aborted && sameScreen(c) && workspace.revision === c.revision;
    scenarios=null;catalog=null; catalogLoading = false; loadState = 'loading';
    setInteractiveNodes([]); render();
    try {
      const items = await readAll(c, signal);
      if (!valid()) return;
      scenarios = items;
      setInteractiveNodes(items.map(s => s.nodeId));
      await ensureCatalog();
    } catch (error) {
      await loadFailed(error, c, valid, signal);
    }
  }

  function reset() {
    controller?.abort(); generation++; controller = null;
    collapsedGroups.clear();
    key = null; catalog=null;scenarios=null; catalogLoading = false; offset = 0; loadState = 'empty'; notice = errorNotice = '';
    leave = null; closeDialog(); editor.close(); setInteractiveNodes([]); render();
  }
  function refresh(screen:string|null|undefined) {
    if (!screen) { reset(); return; }
    const next = workspace.documentId + ':' + screen + ':' + workspace.revision;
    if (next === key) { editor.revisionChanged(); render(); return; }
    notice = errorNotice = '';
    editor.revisionChanged();
    load();
  }
  function onSelectionChanged() {
    offset = 0;
    if (editor.draft && editor.draft.scenario.nodeId !== context().node) editor.revisionChanged();
    render();
  }
  element('scenario-create').addEventListener('click', () => {
    const c = context();
    if (!c.editable || !c.node || !c.screen || loadState !== 'ready' || opPending()) return;
    editor.open({ id: crypto.randomUUID(), screenId: c.screen, nodeId: c.node, event: null, actions: [] }, element('scenario-create'), true);
    render();
  });
  element('scenario-edit-reload').addEventListener('click', () => {
    const old = editor.draft;
    if (!old || loadState !== 'ready') return;
    const latest = scenarios?.find(s => s.id === old.scenario.id);
    editor.close();
    if (latest && context().node === latest.nodeId && context().editable) editor.open(latest, null);
    else if (!old.creating) errorNotice = 'Взаимодействие больше недоступно.';
    render();
  });
  element('scenarios-retry').addEventListener('click', load);
  element('scenarios-previous').addEventListener('click', () => { offset = Math.max(0, offset - pageSize); render(); });
  element('scenarios-next').addEventListener('click', () => { offset += pageSize; render(); });

  function begin(kind:CommandKind,scenario:ScenarioDraft,revision:number|null) {
    const c = context(), k = operationKey(c);
    if (!c.editable || !c.doc || !c.screen || revision===null || c.revision !== revision || operations.has(k)) return;
    const body = { commandId: crypto.randomUUID(), expectedRevision: revision,
      ...(kind === 'delete' ? { scenarioId: scenario.id } : { scenario: structuredClone(scenario) }) };
    const op:Operation = { kind, body, state: 'ready', token: c.token, doc: c.doc, screen: c.screen };
    operations.set(k, op); notice = errorNotice = ''; send(op);
  }
  const commandMessages = { create: 'Создание сценария подтверждено.', update: 'Изменение сценария подтверждено.', delete: 'Удаление сценария подтверждено.' };
  const sanitize = (value:unknown) => String(value ?? '').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'объект');
  async function send(op:Operation) {
    const c = context(), k = operationKey(op);
    if (!c.editable || op.token !== token || op.doc !== c.doc || op.screen !== c.screen || operations.get(k) !== op || op.state === 'pending') return;
    const active = () => sameScreen(c) && operations.get(k) === op;
    op.state = 'pending'; render();
    try {
      const result=requiredRecord(await request('/api/v1/documents/'+encodeURIComponent(op.doc)+'/commands/'+op.kind+'-scenario',{method:'POST',body:JSON.stringify(op.body)}));
      if (result.status !== 'ACCEPTED' || result.documentId !== op.doc || result.commandId !== op.body.commandId ||
          typeof result.revision!=='number'||!Number.isSafeInteger(result.revision) || result.revision <= op.body.expectedRevision)
        throw new TypeError('Некорректное подтверждение');
      if (operations.get(k) !== op) return;
      if (!active()) { op.state = 'uncertain'; return; }
      await reloadPages(Math.max(workspace.revision??0, result.revision), active);
      if (!active() || (workspace.revision??0) < result.revision) { op.state = 'uncertain'; return; }
      operations.delete(k);
      const next = leave; leave = null; closeDialog(); editor.close();
      notice = commandMessages[op.kind]; errorNotice = '';
      render(); next?.();
    } catch (error) {
      if (operations.get(k) !== op) return;
      if (!active() || !(error instanceof ApiError) || !error.status || error.status === 408 || error.status >= 500) { op.state = 'uncertain'; return; }
      operations.delete(k); leave = null; closeDialog();
      if (error.code === 'REVISION_CONFLICT') {
        await reloadPages(null, () => sameScreen(c));
        if (!sameScreen(c)) return;
        editor.revisionChanged();
        errorNotice = 'Документ изменился. Черновик не сохранён.';
      } else if (error.status === 403 || error.code === 'DOCUMENT_NOT_FOUND') {
        const role = error.code === 'DOCUMENT_NOT_FOUND' ? null : await findRole(op.doc).catch(() => undefined);
        if (!sameScreen(c)) return;
        if (role === null) { closeInaccessibleDocument(error.status); return; }
        if (role === 'Viewer') setDocumentRole(role);
        errorNotice = 'Доступ к документу утрачен или недостаточен.';
      } else {
        errorNotice = 'Команда отклонена: ' + sanitize(error.message);
        if (!editor.draft && op.kind !== 'delete' && op.body.scenario && c.node === op.body.scenario.nodeId && workspace.revision === op.body.expectedRevision)
          editor.open(op.body.scenario, null, op.kind === 'create');
      }
      render();
    } finally {
      if (sameScreen(c)) render();
    }
  }
  element('scenario-command-retry').addEventListener('click', () => {
    const op = currentOperation(); if (op?.state === 'uncertain') send(op);
  });
  return {
    reset, refresh, retainAfterNodeEdit: refresh, clearLayerSelection: onSelectionChanged, onLayerSelected: onSelectionChanged,
    requestLeave, hasDirtyDraft: editor.dirty,
    clearDocumentCommands(doc:string) { for (const [key, op] of operations) if (op.doc === doc) operations.delete(key); },
    clearCommands() { operations.clear(); editor.close(); }
  };
}
