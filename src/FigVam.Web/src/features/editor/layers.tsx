import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createViewModel } from '../../app/view-model';
import { ChevronDown, ChevronRight, ArrowUpRight } from 'lucide-react';
import type { ApiClient } from '../../api/api-client';
import { ApiError } from '../../api/api-client';
import { requiredRecord, array, text, errorMessage, aborted } from '../../api/decode';
import type { LayerCaptionSource } from '../../core/layer-caption';
import type { LayerContext } from '../../canvas/layer-drag';
import type { components } from '../../api/schema.generated';
type Schema=components['schemas'];
interface LayerItem extends LayerCaptionSource {id:string;parentId:string;childCount:number;canContainChildren?:boolean}
interface Workspace {documentId:string|null;documentRole:string|null;selectedScreen:string|null;revision:number|null;navigationEpoch:number;token:string|null}
type Work=(signal:AbortSignal,current:()=>boolean)=>Promise<unknown>;
interface Options {model:ReturnType<typeof createLayersModel>;element(id:string):HTMLElement;request:ApiClient;workspace:Workspace;refreshPages():Promise<unknown>;runPageRefresh(work:Work):Promise<unknown>;readCurrentPages(signal:AbortSignal,isCurrent:()=>boolean,reveal?:string[]):Promise<unknown>;closeInaccessibleDocument(status:number):void;message(status?:string,error?:string):void;onSelectionCleared():void;onLayerSelected():void;beforeSelectionChange?(next:()=>void):boolean}
type MetadataKind='name'|'key';
type State='ready'|'pending'|'uncertain'|'rejected';
interface Metadata {id?:string;name?:string|null;semanticKey?:string|null;error?:string}
type MetadataOperation={kind:'name';body:{commandId:string;nodeId:string;name:string};state:State}|{kind:'key';body:{commandId:string;nodeId:string;semanticKey:string|null};state:State};
interface DeleteOperation {doc:string;screen:string;name:string;body:{commandId:string;nodeId:string};state:State;error?:string}
interface MoveOperation {doc:string;screen:string;name:string;reveal:string[];body:Schema['MoveNodeRequest'] & {position:number;expectedRevision:number};state:State}
interface Snapshot {screen:string|null;roots:LayerItem[];children:Map<string,LayerItem[]>;expanded:Set<string>;initialExpansion:Set<string>}
interface SnapshotOptions {base:string;screen:string|null;revision:number;signal:AbortSignal;isCurrent:()=>boolean;reveal:string[];shouldReportFailure:()=>boolean}
function typed<T extends HTMLElement>(node:HTMLElement,ctor:{new():T}):T{if(!(node instanceof ctor))throw new Error('Unexpected layer element '+node.id);return node;}
function layer(value:unknown,parentId?:string):LayerItem{
  const v=requiredRecord(value),props=v.properties==null?{}:requiredRecord(v.properties);
  const childCount=v.childCount==null?0:v.childCount;
  if(typeof childCount!=='number'||!Number.isSafeInteger(childCount)||childCount<0)throw new TypeError('Invalid layer child count');
  return {id:text(v.id),parentId:parentId??text(v.parentId),kind:text(v.kind),name:v.name==null?null:text(v.name),childCount,canContainChildren:v.canContainChildren===true,
    properties:Object.fromEntries(Object.entries(props).map(([key,val])=>{const p=requiredRecord(val);return[key,{...p,type:text(p.type),value:p.value}];}))};
}
function accepted(value:unknown,doc:string,commandId:string):void{
  const r=requiredRecord(value);
  if(r.status!=='ACCEPTED'||!Number.isSafeInteger(r.revision)||text(r.documentId).toLowerCase()!==doc.toLowerCase()||text(r.commandId).toLowerCase()!==commandId.toLowerCase())throw new TypeError('Некорректное подтверждение');
}
import { createLayerDrag, resolveLayerDrop } from '../../canvas/layer-drag';

import { layerDisplayName } from '../../core/layer-caption';
export { layerDisplayName };
const layerKindIcons: Record<string,string> = { Frame: '▣', Container: '▣', Text: 'T', Button: '▭', TextInput: '▤', Image: '▧' };

interface LayerTreeProps {
  layerRoots: LayerItem[];
  layerChildren: ReadonlyMap<string, LayerItem[]>;
  layerExpanded: ReadonlySet<string>;
  interactiveNodes: ReadonlySet<string>;
  selectedId: string | undefined;
  focus: string | undefined;
  onSelect(id: string, row: HTMLElement | null): void;
}

function LayerTree({layerRoots,layerChildren,layerExpanded,interactiveNodes,selectedId,focus,onSelect}: LayerTreeProps) {
    function renderBranch(items: LayerItem[]): ReactElement[] {
      return items.map((item, index) => {
        const {text: name, source, origin} = layerDisplayName(item);
        const expanded = layerExpanded.has(item.id);
        const interactive = interactiveNodes.has(item.id);
        return <div key={item.id} role="treeitem" data-id={item.id} tabIndex={focus === item.id ? 0 : -1}
          aria-posinset={index + 1} aria-setsize={items.length}
          aria-selected={selectedId === item.id} aria-expanded={item.childCount ? expanded : undefined}
          aria-label={name + ', ' + item.kind + (interactive ? ', есть взаимодействия' : '')}>
          <span className="layer-label" title={name + ' · ' + item.kind + ' · ' + origin} onClick={event => onSelect(item.id, event.currentTarget.closest<HTMLElement>('[role=treeitem]'))}>
            <span className="layer-disclosure" aria-hidden="true">{item.childCount ? (expanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>) : ''}</span>
            <span className="layer-kind-icon" aria-hidden="true" title={item.kind}>{layerKindIcons[item.kind] ?? '◇'}</span>
            <span className="layer-name" data-label-source={source}>{name}</span>
            {interactive && <span className="layer-interaction" title="Есть взаимодействия" aria-hidden="true"><ArrowUpRight size={12}/></span>}
          </span>
          {item.childCount > 0 && expanded && <div role="group">{renderBranch(layerChildren.get(item.id) ?? [])}</div>}
        </div>;
      });
    }
  return <>{renderBranch(layerRoots)}</>;
}
export function createLayersModel() { return createViewModel(LayerTree); }

export function createLayers({
  model, element, request, workspace, refreshPages, runPageRefresh, readCurrentPages,
  closeInaccessibleDocument, message, onSelectionCleared, onLayerSelected, beforeSelectionChange = () => true
}:Options) {
  let layerController:AbortController|null=null,layerGeneration=0,layerSelection:LayerItem|null=null;
  const input=(id:string)=>typed(element(id),HTMLInputElement),btn=(id:string)=>typed(element(id),HTMLButtonElement);
  let nodeReadGeneration=0,nodeMetadata:Metadata|null=null;
  const nodeOperations=new Map<string,MetadataOperation>();
  const metadataDrafts=new Map<string,Map<MetadataKind,string>>();
  let metadataTimer:ReturnType<typeof setTimeout>|undefined;
  const nodeDeletions=new Map<string,DeleteOperation>();
  const nodeMoves=new Map<string,MoveOperation>();
  const nodeMoveNotices=new Map<string,string>();
  let layerSelectionEpoch = 0;
  let screenContextEpoch = 0;
  let layerRoots:LayerItem[]=[],layerExpanded=new Set<string>(),layerChildren=new Map<string,LayerItem[]>();
  let interactiveNodes=new Set<string>();
  const tree = element('layers');

  function reset() {
    drag.cancel();
    layerController?.abort(); layerController = null; layerGeneration++;
    layerSelection = null; interactiveNodes = new Set(); layerRoots = []; layerExpanded = new Set(); layerChildren = new Map();
    onSelectionCleared();
    renderLayers();
    element('layers-status').textContent = 'Выберите экран.';
    element('inspector-selection').textContent = 'Выберите слой.';
    nodeReadGeneration++; nodeMetadata = null; renderNodeMetadata();
  }

  function selectLayer(item:LayerItem) {
    const changed = layerSelection?.id !== item.id;
    if (changed && layerSelection && nodeMetadata?.id === layerSelection.id) {
      const drafts = metadataDrafts.get(nodeOperationKey(workspace.documentId, layerSelection.id));
      if(drafts?.size===1){const kind=drafts.keys().next().value;if(kind)submitNodeMetadata(kind);}
    }
    if (changed) layerSelectionEpoch++;
    layerSelection = item;
    if (changed || nodeMetadata?.id !== item.id) loadNodeMetadata();
    if (changed) onLayerSelected();
    if (!changed && nodeMetadata?.id === item.id && nodeMetadata.name !== item.name) {
      nodeMetadata.name = item.name??'';
      renderNodeMetadata();
    }
    const caption = `Слой: ${item.name?.trim() || 'Без имени'} · ${item.kind} · ID: ${item.id}`;
    if (element('inspector-selection').textContent !== caption)
      element('inspector-selection').textContent = caption;
    renderNodeOrder();
    renderLayers();
  }

  function nodeOperationKey(doc:string|null,node:string) { return `${doc}:${node}`; }
  function renderNodeDeletion() {
    renderNodeOrder();
    let op = nodeDeletions.get(`${workspace.documentId}:${workspace.selectedScreen}`);
    const editable = ['Owner', 'Editor'].includes(workspace.documentRole??'');
    element('node-delete').hidden = !layerSelection || !editable;
    btn('node-delete').disabled = !!op && op.state !== 'rejected' || !!(layerSelection && nodeOperations.get(nodeOperationKey(workspace.documentId, layerSelection.id)));
    element('node-delete-retry').hidden = !editable || op?.state !== 'uncertain';
    element('node-delete-status').textContent = op?.state === 'pending' ? 'Удаление слоя…' : op?.state === 'uncertain' ? `Результат удаления слоя «${op.name}» неизвестен. Повторите ту же команду.` : op?.error || '';
  }
  function renderNodeMetadata() {
    renderNodeDeletion();
    const selected=layerSelection,op=selected?nodeOperations.get(nodeOperationKey(workspace.documentId, selected.id)):undefined;
    const visible = !!selected;
    element('node-metadata').hidden = !visible;
    if (!visible) return;
    const editable = ['Owner', 'Editor'].includes(workspace.documentRole??'');
    const ready = nodeMetadata?.id === selected.id;
    for (const id of ['node-name','node-key']) input(id).readOnly = !editable || !ready || !!op;
    const drafts = metadataDrafts.get(nodeOperationKey(workspace.documentId, selected.id));
    if (ready && nodeMetadata) {
      const name = (editable ? drafts?.get('name') : undefined) ?? (editable && op?.kind === 'name' ? op.body.name : nodeMetadata.name) ?? '';
      const key = (editable ? drafts?.get('key') : undefined) ?? (editable && op?.kind === 'key' ? op.body.semanticKey : nodeMetadata.semanticKey) ?? '';
      if (input('node-name').value !== name) input('node-name').value = name;
      if (input('node-key').value !== key) input('node-key').value = key;
    }
    else { input('node-name').value = editable ? drafts?.get('name') ?? '' : ''; input('node-key').value = editable ? drafts?.get('key') ?? '' : ''; }
    element('node-metadata-status').textContent = op?.state === 'pending' ? 'Ожидание подтверждения…' : (!ready ? 'Загрузка слоя…' : '');
    element('node-metadata-error').textContent = op?.state === 'uncertain' ? 'Результат неизвестен. Повторите ту же команду.' : (nodeMetadata?.error ?? '');
    element('node-metadata-retry').hidden = !editable || op?.state !== 'uncertain';
  }
  async function loadNodeMetadata() {
    const current = ++nodeReadGeneration, doc = workspace.documentId, screen = workspace.selectedScreen, node = layerSelection?.id, atRevision = workspace.revision, epoch = workspace.navigationEpoch, requestToken = workspace.token;
    nodeMetadata = null; renderNodeMetadata();
    if (!doc || !node || !Number.isSafeInteger(atRevision)) return;
    const active = () => current === nodeReadGeneration && doc === workspace.documentId && screen === workspace.selectedScreen && node === layerSelection?.id && atRevision === workspace.revision && epoch === workspace.navigationEpoch && requestToken === workspace.token && !element('editor-view').hidden;
    try {
      const result=requiredRecord(await request(`/api/v1/documents/${encodeURIComponent(doc)}/nodes/${encodeURIComponent(node)}?fields=name,semanticKey&revision=${atRevision}`,{},undefined,active));
      if (!active()) return;
      const item=array(result.items,requiredRecord)[0];
      if (result.revision !== atRevision || item?.id !== node || typeof item.name !== 'string') throw new TypeError('Некорректный ответ');
      nodeMetadata = { id: node, name: item.name, semanticKey:item.semanticKey==null?null:text(item.semanticKey) };
      renderNodeMetadata();
    } catch (error) {
      if (!active()) return;
      if (error instanceof ApiError && error.status === 403) { closeInaccessibleDocument(error.status); return; }
      nodeMetadata = { error: errorMessage(error) || 'Не удалось загрузить слой.' }; renderNodeMetadata();
      element('node-metadata-status').textContent = '';
      element('node-metadata-error').textContent = errorMessage(error) || 'Не удалось загрузить слой.';
    }
  }
  function submitNodeMetadata(kind:MetadataKind) {
    const doc = workspace.documentId, screen = workspace.selectedScreen, node = layerSelection?.id;
    if (!doc || !screen || !node || nodeMetadata?.id !== node || !['Owner', 'Editor'].includes(workspace.documentRole??'')) return;
    const key = nodeOperationKey(doc, node); if (nodeOperations.has(key)) return;
    clearTimeout(metadataTimer);
    const drafts = metadataDrafts.get(key);
    const value = drafts?.get(kind);
    if (value === undefined) return;
    if (value === ((kind === 'name' ? nodeMetadata.name : nodeMetadata.semanticKey) ?? '')) {
      drafts?.delete(kind); return;
    }
    if (value.length > 256 || /[\u0000-\u001f\u007f-\u009f]/.test(value) || (kind === 'key' && value !== '' && !value.trim())) {
      element('node-metadata-error').textContent = 'Проверьте значение: не более 256 символов, без управляющих символов; semantic key не может состоять из пробелов.'; return;
    }
    const body={commandId:crypto.randomUUID(),nodeId:node};
    const op:MetadataOperation=kind==='name'?{kind,body:{...body,name:value},state:'pending'}:{kind,body:{...body,semanticKey:value===''?null:value},state:'pending'};
    nodeOperations.set(key, op); sendNodeMetadata(doc, screen, node, op);
  }
  for (const [kind, id] of [['name', 'node-name'], ['key', 'node-key']] as const) {
    const field=input(id);
    field.addEventListener('input', () => {
      if (!layerSelection || nodeMetadata?.id !== layerSelection.id || field.readOnly) return;
      const key = nodeOperationKey(workspace.documentId, layerSelection.id);
      if (!metadataDrafts.has(key)) metadataDrafts.set(key, new Map());
      metadataDrafts.get(key)?.set(kind,field.value);
      clearTimeout(metadataTimer);
      metadataTimer = setTimeout(() => {
        if (layerSelection && key === nodeOperationKey(workspace.documentId, layerSelection.id)) submitNodeMetadata(kind);
      }, 500);
    });
    field.addEventListener('blur', () => submitNodeMetadata(kind));
    field.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); submitNodeMetadata(kind); }
      if (event.key === 'Escape' && layerSelection) {
        clearTimeout(metadataTimer);
        metadataDrafts.get(nodeOperationKey(workspace.documentId, layerSelection.id))?.delete(kind);
        renderNodeMetadata();
      }
    });
    element(id + '-form').addEventListener('submit', event => { event.preventDefault(); submitNodeMetadata(kind); });
  }
  element('node-metadata-retry').addEventListener('click', () => {
    const op = layerSelection && nodeOperations.get(nodeOperationKey(workspace.documentId, layerSelection.id));
    if(op?.state==='uncertain'&&workspace.documentId&&workspace.selectedScreen&&layerSelection)void sendNodeMetadata(workspace.documentId,workspace.selectedScreen,layerSelection.id,op);
  });
  async function sendNodeMetadata(doc:string,screen:string,node:string,op:MetadataOperation) {
    const key = nodeOperationKey(doc, node), epoch = workspace.navigationEpoch, requestToken = workspace.token, selectionEpoch = layerSelectionEpoch;
    // Rereading metadata for the same selected node must not invalidate a command.
    const active = () => layerSelectionEpoch === selectionEpoch && nodeOperations.get(key) === op && workspace.documentId === doc && workspace.selectedScreen === screen && layerSelection?.id === node && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden;
    op.state = 'pending'; if (active()) renderNodeMetadata();
    try {
      const result = await request(`/api/v1/documents/${encodeURIComponent(doc)}/commands/set-node-${op.kind === 'name' ? 'name' : 'semantic-key'}`, { method: 'POST', body: JSON.stringify(op.body) }, undefined, active);
      if (nodeOperations.get(key) !== op) return;
      accepted(result,doc,op.body.commandId);
      if (!active()) { op.state = 'uncertain'; return; }
      nodeOperations.delete(key);
      metadataDrafts.get(key)?.delete(op.kind);
      // Keep confirmed values stable while refreshing the same selected layer.
      if (nodeMetadata?.id === node) {
        if (op.kind === 'name') nodeMetadata.name = op.body.name;
        else nodeMetadata.semanticKey = op.body.semanticKey;
      }
      renderNodeMetadata();
      await runPageRefresh(signal => readCurrentPages(signal, activeAfterConfirmation));
      function activeAfterConfirmation() { return workspace.documentId === doc && workspace.selectedScreen === screen && layerSelection?.id === node && layerSelectionEpoch === selectionEpoch && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden; }
    } catch (error) {
      if (nodeOperations.get(key) !== op) return;
      if (!active() || !(error instanceof ApiError) || error.status >= 500) op.state = 'uncertain';
      else {
        nodeOperations.delete(key);
        if (error instanceof ApiError && error.status === 403) { closeInaccessibleDocument(error.status); return; }
        if (error.code === 'NODE_NOT_FOUND') {
          const currentContext = () => workspace.documentId === doc && workspace.selectedScreen === screen && layerSelection?.id === node && layerSelectionEpoch === selectionEpoch && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden;
          await runPageRefresh(signal => readCurrentPages(signal, currentContext));
          if (workspace.documentId === doc && workspace.selectedScreen === screen && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden && !layerSelection) element('layers-status').textContent = 'Слой больше не существует.';
          return;
        }
        if (nodeMetadata) nodeMetadata.error = error.message;
        renderNodeMetadata();
        const field=input(op.kind==='name'?'node-name':'node-key');
        field.value = (op.kind === 'name' ? op.body.name : op.body.semanticKey) ?? '';
        return;
      }
    } finally { if (nodeOperations.get(key) === op && workspace.documentId === doc && workspace.selectedScreen === screen && layerSelection?.id === node && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden) renderNodeMetadata(); }
  }

  element('node-delete').addEventListener('click', () => {
    const node = layerSelection, doc = workspace.documentId, screen = workspace.selectedScreen, key = `${doc}:${screen}`;
    if (!doc || !screen || !node || !['Owner', 'Editor'].includes(workspace.documentRole??'') || (nodeDeletions.has(key) && nodeDeletions.get(key)?.state !== 'rejected') || nodeOperations.has(nodeOperationKey(doc, node.id))) return;
    const name = node.name?.trim() || 'Без имени';
    if (!confirm(`Удалить слой «${name}»? Будет удалено всё его поддерево.`)) return;
    const op:DeleteOperation = { doc, screen, name, body: { commandId: crypto.randomUUID(), nodeId: node.id }, state: 'ready' };
    nodeDeletions.set(key, op); sendNodeDeletion(op);
  });
  element('node-delete-retry').addEventListener('click', () => {
    const op = nodeDeletions.get(`${workspace.documentId}:${workspace.selectedScreen}`);
    if (op?.state === 'uncertain') sendNodeDeletion(op);
  });
  async function sendNodeDeletion(op:DeleteOperation) {
    const key = `${op.doc}:${op.screen}`;
    if (nodeDeletions.get(key) !== op || op.state === 'pending') return;
    const epoch = workspace.navigationEpoch, screenEpoch = screenContextEpoch, requestToken = workspace.token;
    const active = () => screenEpoch === screenContextEpoch && nodeDeletions.get(key) === op && workspace.documentId === op.doc && workspace.selectedScreen === op.screen && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden;
    op.state = 'pending'; renderNodeDeletion();
    try {
      const result = await request(`/api/v1/documents/${encodeURIComponent(op.doc)}/commands/delete-node`, { method: 'POST', body: JSON.stringify(op.body) }, undefined, active);
      if (!active()) { op.state = 'uncertain'; return; }
      accepted(result,op.doc,op.body.commandId);
      let synced = false;
      await runPageRefresh(async signal => { await readCurrentPages(signal, active); synced = true; });
      if (active() && synced) { nodeDeletions.delete(key); renderNodeDeletion(); }
      else op.state = 'uncertain';
    } catch (error) {
      if (!active() || !(error instanceof ApiError) || error.status >= 500) { op.state = 'uncertain'; return; }
      if (error instanceof ApiError && error.status === 403) { nodeDeletions.delete(key); closeInaccessibleDocument(403); return; }
      if (error.code === 'NODE_NOT_FOUND') {
        await runPageRefresh(signal => readCurrentPages(signal, active));
        if (!active()) { op.state = 'uncertain'; return; }
        op.error = 'Слой уже удалён другим участником.';
      } else op.error = ({ SCENARIO_IN_USE: 'Слой или его поддерево используется в сценариях. Сначала удалите ссылки сценариев.', SCREEN_VARIANT_IN_USE: 'Слой или его поддерево используется в вариантах. Сначала удалите ссылки вариантов.', INVALID_REPEATER: 'Слой используется повторителем. Сначала удалите зависимость.', INVALID_COMPONENT: 'Слой используется компонентом. Сначала удалите зависимость.' } as Record<string,string>)[error.code??''] || error.message;
      op.state = 'rejected';
    } finally { if (nodeDeletions.get(key) === op && workspace.documentId === op.doc && workspace.selectedScreen === op.screen && workspace.token === requestToken && !element('editor-view').hidden) renderNodeDeletion(); }
  }

  function siblingContext(id:string|undefined):LayerContext|null {
    function find(parent:string,items:LayerItem[],ancestors:string[]=[]):LayerContext|null {
      const index = items.findIndex(item => item.id === id);
      const foundItem=items[index];if(index>=0&&foundItem)return{parent,index,count:items.length,ancestors,item:foundItem};
      for (const item of items) {
        const found = find(item.id, layerChildren.get(item.id) || [], [...ancestors, item.id]);
        if (found) return found;
      }
      return null;
    }
    return workspace.selectedScreen && id ? find(workspace.selectedScreen, layerRoots) : null;
  }
  const moveKey = () => `${workspace.documentId}:${workspace.selectedScreen}`;
  const canMove = () => ['Owner', 'Editor'].includes(workspace.documentRole??'') && !nodeMoves.has(moveKey()) && !element('editor-view').hidden;
  function renderNodeOrder() {
    const op = nodeMoves.get(moveKey());
    const editable = ['Owner', 'Editor'].includes(workspace.documentRole??'');
    element('layers').classList.toggle('layer-move-enabled', editable && !op);
    element('node-order-retry').hidden = !editable || op?.state !== 'uncertain';
    element('node-order-status').textContent = !editable ? '' : op?.state === 'pending' ? 'Перемещение слоя…' : op?.state === 'uncertain' ? `Результат перемещения неизвестен. Повторите ту же команду для слоя «${op.name}».` : nodeMoveNotices.get(moveKey()) || '';
  }

  const drag = createLayerDrag({
    tree: element('layers'), canMove, context: siblingContext,
    stamp: () => [workspace.documentId, workspace.selectedScreen, workspace.revision, layerGeneration, workspace.navigationEpoch, layerSelectionEpoch].join(':'),
    resolve: (source, target, zone) => resolveLayerDrop(siblingContext(source), siblingContext(target), zone),
    expand: id => {
      if (!layerExpanded.has(id) && layerChildren.has(id)) {
        layerExpanded.add(id);
        renderLayers();
      }
    },
    commit: (id, plan) => {
      const item = findLayer(id);
      if (!item || !canMove()) return;
      // A dirty inspector draft must be resolved before moving, never during a gesture.
      if (layerSelection?.id !== id && !beforeSelectionChange(() => selectLayer(item))) return;
      selectLayer(item);
      renderLayers(id);
      startNodeMove(plan.expectedParentId, plan.targetParentId, plan.position, plan.reveal);
    }
  });

  function beginNodeMove(delta:number) {
    const context = siblingContext(layerSelection?.id);
    if (!context||!layerSelection) return;
    const position = context.index + delta;
    if (position < 0 || position >= context.count) return;
    renderLayers(layerSelection.id);
    startNodeMove(context.parent, context.parent, position, context.ancestors);
  }
  function startNodeMove(expectedParentId:string,targetParentId:string,position:number,reveal:string[]=[]) {
    const key = `${workspace.documentId}:${workspace.selectedScreen}`;
    if (!workspace.documentId || !workspace.selectedScreen || workspace.revision===null || !layerSelection || !['Owner', 'Editor'].includes(workspace.documentRole??'') || nodeMoves.has(key)) return;
    const body = { commandId: crypto.randomUUID(), nodeId: layerSelection.id, expectedParentId, targetParentId, position, expectedRevision: workspace.revision };
    const op:MoveOperation = { doc: workspace.documentId, screen: workspace.selectedScreen, name: layerSelection.name?.trim() || layerSelection.kind, reveal, body, state: 'ready' };
    nodeMoveNotices.delete(key);
    nodeMoves.set(key, op);
    sendNodeMove(op);
  }
  element('node-order-retry').addEventListener('click', () => {
    const op = nodeMoves.get(`${workspace.documentId}:${workspace.selectedScreen}`);
    if (op?.state === 'uncertain') sendNodeMove(op);
  });
  async function refreshNodeMoveTree(active:()=>boolean,reveal:string[]=[]) {
    let synced = false;
    await runPageRefresh(async (signal, current) => {
      try {
        synced = await readCurrentPages(signal, active, reveal) === true;
      } catch (error) {
        if (active() && error instanceof ApiError && (error.status === 403 || error.code === 'DOCUMENT_NOT_FOUND')) closeInaccessibleDocument(error.status);
        else throw error;
      } finally {
        if (current()) message();
      }
    });
    return synced;
  }

  async function sendNodeMove(op:MoveOperation) {
    const key = `${op.doc}:${op.screen}`;
    if (nodeMoves.get(key) !== op || op.state === 'pending' || !['Owner', 'Editor'].includes(workspace.documentRole??'')) return;
    const epoch = workspace.navigationEpoch, screenEpoch = screenContextEpoch, selectionEpoch = layerSelectionEpoch, requestToken = workspace.token;
    const context = () => nodeMoves.get(key) === op && workspace.documentId === op.doc && workspace.selectedScreen === op.screen && screenContextEpoch === screenEpoch && workspace.navigationEpoch === epoch && workspace.token === requestToken && !element('editor-view').hidden;
    const active = () => context() && layerSelectionEpoch === selectionEpoch;
    const restoreFocus = element('layers').contains(document.activeElement) || document.activeElement === element('node-order-retry');
    op.state = 'pending'; renderNodeOrder();
    try {
      const result = await request(`/api/v1/documents/${encodeURIComponent(op.doc)}/commands/move-node`, { method: 'POST', body: JSON.stringify(op.body) }, undefined, active);
      if (!active()) { op.state = 'uncertain'; return; }
      accepted(result,op.doc,op.body.commandId);
      const reveal = layerSelection?.id === op.body.nodeId ? op.reveal : [];
      const synced = await refreshNodeMoveTree(active, reveal);
      if (context() && synced) {
        nodeMoves.delete(key);
        nodeMoveNotices.set(key, (op.body.expectedParentId !== op.body.targetParentId ? 'Слой перемещён к новому родителю.' : 'Порядок слоёв изменён.') + ` Позиция: ${op.body.position + 1}.`);
        if (layerSelection?.id === op.body.nodeId && restoreFocus &&
            (element('layers').contains(document.activeElement) || document.activeElement === document.body || document.activeElement === element('node-order-retry'))) {
          renderLayers(op.body.nodeId);
          element('layers').querySelector('[role=treeitem][aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      } else op.state = 'uncertain';
    } catch (error) {
      if (!active() || !(error instanceof ApiError) || error.status === 408 || error.status >= 500) { op.state = 'uncertain'; return; }
      if (error instanceof ApiError && error.status === 403 || error.code === 'DOCUMENT_NOT_FOUND') { nodeMoves.delete(key); closeInaccessibleDocument(error.status); return; }
      const explanations:Record<string,string> = {
        NODE_NOT_FOUND: 'Слой уже удалён другим участником.',
        PARENT_NOT_FOUND: 'Новый родитель уже удалён другим участником.',
        INVALID_LAYOUT_CONTEXT: 'Родитель слоя изменился.',
        INVALID_POSITION: 'Эта позиция больше недоступна.',
        REVISION_CONFLICT: 'Структура документа изменилась. Повторите жест.',
        CHILDREN_NOT_ALLOWED: 'Новый родитель не может содержать дочерние слои.',
        CYCLE_NOT_ALLOWED: 'Нельзя переместить слой внутрь его собственного поддерева.',
        INVALID_COMPONENT: 'Перемещение нарушит структуру компонента.',
        INVALID_REPEATER: 'Перемещение нарушит структуру повторителя.',
        SCENARIO_IN_USE: 'Перемещение нарушит ссылки сценария.',
        SCREEN_VARIANT_IN_USE: 'Перемещение нарушит ссылки варианта экрана.'
      };
      const notice = explanations[error.code??''] ?? error.message;
      const refresh = ['NODE_NOT_FOUND', 'PARENT_NOT_FOUND', 'INVALID_LAYOUT_CONTEXT', 'INVALID_POSITION', 'CYCLE_NOT_ALLOWED', 'REVISION_CONFLICT'].includes(error.code??'');
      const synced = refresh && await refreshNodeMoveTree(context);
      if (context())
        nodeMoveNotices.set(key, notice + (synced ? ' Дерево обновлено.' : ''));
      if (nodeMoves.get(key) === op) nodeMoves.delete(key);
    } finally {
      if (workspace.documentId === op.doc && workspace.selectedScreen === op.screen && workspace.token === requestToken && (workspace.navigationEpoch === epoch || nodeMoves.get(key) === op) && !element('editor-view').hidden)
        renderNodeOrder();
    }
  }

  function renderLayers(focusId?:string) {
    renderNodeDeletion();
    const focusedId = document.activeElement?.closest<HTMLElement>('[role=treeitem]')?.dataset.id;
    const visible: string[] = [];
    function collect(items: LayerItem[]) {
      for (const item of items) {
        visible.push(item.id);
        if (item.childCount && layerExpanded.has(item.id)) collect(layerChildren.get(item.id) ?? []);
      }
    }
    collect(layerRoots);
    const focus = [focusId, focusedId, layerSelection?.id, visible[0]].find(id => id && visible.includes(id));
    const onSelect = (id:string, row:HTMLElement|null) => {
      const latest = findLayer(id);
      if (!latest) return;
      const select = () => { selectLayer(latest); row?.focus(); if (latest.childCount) void toggleLayer(latest); };
      if (layerSelection?.id === latest.id || beforeSelectionChange(select)) select();
    };
    // Keyboard navigation and drag/drop read the committed tree geometry immediately.
    flushSync(() => model.publish({layerRoots, layerChildren: new Map(layerChildren),
      layerExpanded: new Set(layerExpanded), interactiveNodes, selectedId: layerSelection?.id, focus, onSelect}));
    if (focusId || (focusedId && focus)) {
      const row = [...tree.querySelectorAll<HTMLElement>('[role=treeitem]')].find(item => item.dataset.id === focus);
      if (row && document.activeElement !== row) row.focus({preventScroll: true});
    }
  }

  async function readLayerChildren(base:string,parentId:string,signal:AbortSignal,revision:number|null,isCurrent?:()=>boolean):Promise<LayerItem[]> {
    const items:LayerItem[]=[];let total:number;
    do {
      const query = new URLSearchParams({ offset: String(items.length), limit: '100', fields: 'name,kind,childCount,properties,canContainChildren', revision: String(revision) });
      const result=requiredRecord(await request(`${base}/children/${encodeURIComponent(parentId)}?${query}`,{},signal,isCurrent));
      if(typeof result.total!=='number'||!Number.isSafeInteger(result.total)||result.total<0||result.revision!==revision||result.offset!==items.length)throw new TypeError('Некорректный список слоёв');
      total=result.total;const batch=array(result.items,v=>layer(v,parentId));
      if ((!batch.length && items.length<total)||items.length+batch.length>total)throw new Error('Не удалось загрузить все слои. Обновите страницы.');
      items.push(...batch);
    } while (items.length < total);
    return items;
  }

  function layerFailure(error:unknown,current:number) {
    if (aborted(error) || current !== layerGeneration) return;
    if (error instanceof ApiError && error.status === 403) { closeInaccessibleDocument(403); return; }
    reset();
    element('layers-status').textContent = error instanceof TypeError ? 'Не удалось загрузить слои. Проверьте соединение и обновите страницы.' : `${errorMessage(error)} Обновите страницы.`;
  }

  function findLayer(id:string|undefined,items:LayerItem[]=layerRoots):LayerItem|undefined {
    for (const item of items) {
      if (item.id === id) return item;
      const found = findLayer(id, layerChildren.get(item.id) || []);
      if (found) return found;
    }
  }

  async function toggleLayer(item:LayerItem|undefined) {
    if(!item)return;
    if (layerExpanded.has(item.id)) {
      layerExpanded.delete(item.id); renderLayers(item.id); return;
    }
    const current = layerGeneration;
    layerExpanded.add(item.id);
    try {
      if (!layerChildren.has(item.id)) {
        element('layers-status').textContent = 'Загрузка слоёв…';
        if(!workspace.documentId||!layerController)return;
        const base=`/api/v1/documents/${encodeURIComponent(workspace.documentId)}`,signal=layerController.signal;
        const latest=requiredRecord(await request(`${base}/pages?limit=1&fields=name`,{},signal));
        if (current !== layerGeneration) return;
        if (latest.revision !== workspace.revision) { await refreshPages(); return; }
        const items = await readLayerChildren(base,item.id,signal,workspace.revision);
        if (current !== layerGeneration) return;
        layerChildren.set(item.id, items);
      }
      renderLayers(item.id);
      element('layers-status').textContent = 'Стрелки перемещают выбор, Enter выбирает слой.';
    } catch (error) { layerFailure(error, current); }
  }

  element('layers').addEventListener('keydown', event => {
    const row=event.target instanceof Element?event.target.closest<HTMLElement>('[role=treeitem]'):null;
    if (!row) return;
    const rows = [...element('layers').querySelectorAll<HTMLElement>('[role=treeitem]')], index = rows.indexOf(row);
    let target:HTMLElement|null|undefined;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (canMove() && layerSelection) beginNodeMove(event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (event.key === 'ArrowDown') target = rows[index + 1];
    else if (event.key === 'ArrowUp') target = rows[index - 1];
    else if (event.key === 'Home') target = rows[0];
    else if (event.key === 'End') target = rows.at(-1);
    else if (event.key === 'ArrowLeft') {
      if (row.getAttribute('aria-expanded') === 'true') { layerExpanded.delete(row.dataset.id??''); renderLayers(row.dataset.id); }
      else target = row.parentElement?.closest<HTMLElement>('[role=treeitem]');
    } else if (event.key === 'ArrowRight') {
      if (row.getAttribute('aria-expanded') === 'false') toggleLayer(findLayer(row.dataset.id));
      else if (row.getAttribute('aria-expanded') === 'true') target = row.querySelector<HTMLElement>('[role=treeitem]');
    } else if (event.key === 'Enter' || event.key === ' ') {
      const item = findLayer(row.dataset.id);
      if (item && (layerSelection?.id === item.id || beforeSelectionChange(() => selectLayer(item)))) selectLayer(item);
    } else return;
    event.preventDefault();
    if (target) { row.tabIndex = -1; target.tabIndex = 0; target.focus(); }
  });

  async function readSnapshot({base,screen,revision,signal,isCurrent,reveal,shouldReportFailure}:SnapshotOptions):Promise<Snapshot> {
    const children=new Map<string,LayerItem[]>(), initialExpansion = new Set(layerExpanded);
    const expanded = new Set(screen === workspace.selectedScreen ? [...initialExpansion, ...reveal] : []);
    async function readBranch(parent:string):Promise<LayerItem[]> {
      const items = await readLayerChildren(base, parent, signal, revision, isCurrent);
      if (!isCurrent()) return [];
      for (const item of items) if (item.childCount > 0 || expanded.has(item.id)) children.set(item.id, await readBranch(item.id));
      return items;
    }
    try {
      const roots = screen ? await readBranch(screen) : [];
      return { screen, roots, children, expanded, initialExpansion };
    } catch (error) {
      if (isCurrent() && shouldReportFailure()) layerFailure(error, layerGeneration);
      throw error;
    }
  }

  function isExpansionCurrent({initialExpansion}:Snapshot) {
    return initialExpansion.size === layerExpanded.size && [...initialExpansion].every(id => layerExpanded.has(id));
  }

  function applySnapshot({screen,roots,children,expanded}:Snapshot,selection:{id:string}|null|undefined) {
    drag.cancel();
    layerController?.abort();
    layerGeneration++;
    layerRoots = roots; layerChildren = children; layerExpanded = expanded;
    layerController = new AbortController();
    const selected = selection && findLayer(selection.id);
    if (selected) selectLayer(selected);
    else if (layerSelection) {
      layerSelection = null;
      layerSelectionEpoch++;
      nodeReadGeneration++;
      nodeMetadata = null;
      renderNodeMetadata();
      element('inspector-selection').textContent = 'Выберите слой.';
      onSelectionCleared();
    }
    renderLayers();
    element('layers-status').textContent = screen ? (roots.length ? 'Стрелки перемещают выбор, Enter выбирает слой.' : 'На экране нет слоёв.') : 'Выберите экран.';
  }

  function selectFromCanvas(rawItem:unknown,rawNodes:unknown[],confirmed=false) {
    const item=layer(rawItem),nodes=rawNodes.map(n=>layer(n));
    if (!confirmed && layerSelection?.id !== item.id && !beforeSelectionChange(() => selectFromCanvas(item, nodes, true))) return false;
    drag.cancel();
    const byId = new Map(nodes.map(node => [node.id, node]));
    const branches=new Map<string,LayerItem[]>();
    for (const node of nodes) {
      if (!branches.has(node.parentId)) branches.set(node.parentId, []);
      branches.get(node.parentId)?.push(node);
    }
    for (let parent = byId.get(item.parentId); parent; parent = byId.get(parent.parentId)) {
      layerExpanded.add(parent.id);
      layerChildren.set(parent.id,branches.get(parent.id)??[]);
    }
    layerRoots = branches.get(workspace.selectedScreen??'') ?? [];
    selectLayer(item);
    renderLayers();
    return true;
  }

  function clearCommands() {
    clearTimeout(metadataTimer); metadataDrafts.clear(); nodeOperations.clear(); nodeDeletions.clear(); nodeMoves.clear(); nodeMoveNotices.clear();
  }

  return {
    reset, clearCommands, readSnapshot, isExpansionCurrent, applySnapshot, findLayer, selectFromCanvas,
    selectById(id:string){const item=findLayer(id);if(!item)return;const select=()=>{selectLayer(item);if(item.childCount)void toggleLayer(item);renderLayers(id);};if(layerSelection?.id===id||beforeSelectionChange(select))select();},
    refreshMoveAvailability() { if (!canMove()) drag.cancel(); renderNodeOrder(); },
    setInteractiveNodes(ids:string[]) { interactiveNodes = new Set(ids); renderLayers(); },
    clearSelection() {
      if (!layerSelection) return;
      layerSelection = null; layerSelectionEpoch++; nodeReadGeneration++; nodeMetadata = null;
      drag.cancel(); renderNodeMetadata(); renderNodeOrder(); renderLayers();
      element('inspector-selection').textContent = 'Выберите слой.';
      onSelectionCleared();
    },
    onScreenContextChanged: () => { drag.cancel(); screenContextEpoch++; },
    get selection() { return layerSelection; },
    get hasLayers() { return layerRoots.length > 0; }
  };
}
