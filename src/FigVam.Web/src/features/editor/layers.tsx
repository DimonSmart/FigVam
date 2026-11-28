import { createLayersModel, type LayerItem, type MetadataKind } from './layer-views';
export { createLayersModel } from './layer-views';
import { prepareDocumentCommand, type DocumentCommandOperation } from '../../api/document-commands';
import { flushSync } from 'react-dom';
import type { ApiClient } from '../../api/api-client';
import { ApiError } from '../../api/api-client';
import { requiredRecord, array, text, errorMessage, aborted } from '../../api/decode';
import type { LayerCaptionSource } from '../../core/layer-caption';
import type { LayerContext } from '../../canvas/layer-drag';
import type { components } from '../../api/schema.generated';
type Schema=components['schemas'];
interface Workspace { isEditorVisible(): boolean; documentId:string|null;documentRole:string|null;selectedScreen:string|null;revision:number|null;navigationEpoch:number;token:string|null}
type Work=(signal:AbortSignal,current:()=>boolean)=>Promise<unknown>;
interface Options {editLayerProperties(id:string,properties:Record<string,{type:'boolean';value:boolean}>):boolean;deleteMultiple(ids:string[]):boolean;setMoveEnabled(enabled:boolean):void;model:ReturnType<typeof createLayersModel>;element(id:string):HTMLElement;request:ApiClient;workspace:Workspace;refreshPages():Promise<unknown>;runPageRefresh(work:Work):Promise<unknown>;readCurrentPages(signal:AbortSignal,isCurrent:()=>boolean,reveal?:string[]):Promise<unknown>;closeInaccessibleDocument(status:number):void;message(status?:string,error?:string):void;onSelectionCleared():void;onLayerSelected():void;beforeSelectionChange?(next:()=>void):boolean}
type State='ready'|'pending'|'uncertain'|'sync'|'rejected';
interface Metadata {id?:string;name?:string|null;semanticKey?:string|null;error?:string}
type MetadataOperation=({kind:'name';body:{commandId:string;nodeId:string;name:string};state:State}|{kind:'key';body:{commandId:string;nodeId:string;semanticKey:string|null};state:State}) & {mutation?:DocumentCommandOperation};
interface DeleteOperation {doc:string;screen:string;name:string;body:{commandId:string;nodeId:string};state:State;error?:string;mutation?:DocumentCommandOperation}
interface MoveOperation {doc:string;screen:string;name:string;reveal:string[];body:Schema['MoveNodeRequest'] & {position:number;expectedRevision:number};state:State;mutation?:DocumentCommandOperation}
interface Snapshot {screen:string|null;roots:LayerItem[];children:Map<string,LayerItem[]>;expanded:Set<string>;initialExpansion:Set<string>}
interface SnapshotOptions {base:string;screen:string|null;revision:number;signal:AbortSignal;isCurrent:()=>boolean;reveal:string[];shouldReportFailure:()=>boolean}
function layer(value:unknown,parentId?:string):LayerItem{
  const v=requiredRecord(value),props=v.properties==null?{}:requiredRecord(v.properties);
  const childCount=v.childCount==null?0:v.childCount;
  if(typeof childCount!=='number'||!Number.isSafeInteger(childCount)||childCount<0)throw new TypeError('Invalid layer child count');
  return {id:text(v.id),parentId:parentId??text(v.parentId),kind:text(v.kind),name:v.name==null?null:text(v.name),childCount,canContainChildren:v.canContainChildren===true,
    properties:Object.fromEntries(Object.entries(props).map(([key,val])=>{const p=requiredRecord(val);return[key,{...p,type:text(p.type),value:p.value}];}))};
}
const retryable=(op:{state:State}|undefined)=>op?.state==='uncertain'||op?.state==='sync';
import { createLayerDrag, resolveLayerDrop } from '../../canvas/layer-drag';

import { layerDisplayName } from '../../core/layer-caption';
export { layerDisplayName };
export function createLayers({
  editLayerProperties,deleteMultiple,setMoveEnabled, model, element, request, workspace, refreshPages, runPageRefresh, readCurrentPages,
  closeInaccessibleDocument, message, onSelectionCleared, onLayerSelected, beforeSelectionChange = () => true
}:Options) {
  let layerController:AbortController|null=null,layerGeneration=0,layerSelection:LayerItem|null=null;
  const setLayerStatus=(text:string)=>model.status.publish({text});
  const setCaption=(text:string)=>model.caption.publish({text});
  let selectedIds=new Set<string>();
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
  const lifetime = new AbortController();

  function reset() {
    drag.cancel(); clearTimeout(metadataTimer);
    layerController?.abort(); layerController = null; layerGeneration++;
    layerSelection = null; selectedIds.clear(); interactiveNodes = new Set(); layerRoots = []; layerExpanded = new Set(); layerChildren = new Map();
    onSelectionCleared();
    renderLayers();
    setLayerStatus('Выберите экран.');
    setCaption('Выберите слой.');
    nodeReadGeneration++; nodeMetadata = null; renderNodeMetadata();
  }

  function selectLayer(item:LayerItem, preserve=false) {
    const changed = layerSelection?.id !== item.id || (!preserve && selectedIds.size!==1);
    if(!preserve)selectedIds=new Set([item.id]);else selectedIds.add(item.id);
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
    setCaption(selectedIds.size>1?'Выбрано слоёв: '+selectedIds.size:caption);
    renderNodeOrder();
    renderLayers();
  }

  function nodeOperationKey(doc:string|null,node:string) { return `${doc}:${node}`; }
  function renderNodeDeletion() {
    renderNodeOrder();
    let op = nodeDeletions.get(`${workspace.documentId}:${workspace.selectedScreen}`);
    const editable = ['Owner', 'Editor'].includes(workspace.documentRole??'');
    model.deletion.publish({hidden:!layerSelection||!editable,
      disabled:[...selectedIds].some(id=>locked(id)) || !!op && op.state !== 'rejected' || !!(layerSelection && nodeOperations.get(nodeOperationKey(workspace.documentId, layerSelection.id))),
      retryHidden:!editable || !retryable(op),
      status:op?.state === 'pending' ? 'Удаление слоя…' : op?.state === 'sync' ? 'Удаление подтверждено. Повторите обновление.' : op?.state === 'uncertain' ? `Результат удаления слоя «${op.name}» неизвестен. Повторите ту же команду.` : op?.error || '',
      remove:deleteNode,retry:retryNodeDeletion});
  }
  function renderNodeMetadata() {
    renderNodeDeletion();
    const selected=layerSelection,op=selected?nodeOperations.get(nodeOperationKey(workspace.documentId, selected.id)):undefined;
    const visible = !!selected && selectedIds.size===1;
    const editable = ['Owner', 'Editor'].includes(workspace.documentRole??'');
    const ready = !!selected && nodeMetadata?.id === selected.id;
    const drafts = selected ? metadataDrafts.get(nodeOperationKey(workspace.documentId, selected.id)) : undefined;
    const name = (editable ? drafts?.get('name') : undefined) ?? (ready ? (editable && op?.kind === 'name' ? op.body.name : nodeMetadata?.name) : '') ?? '';
    const keyValue = (editable ? drafts?.get('key') : undefined) ?? (ready ? (editable && op?.kind === 'key' ? op.body.semanticKey : nodeMetadata?.semanticKey) : '') ?? '';
    model.metadata.publish({visible,readOnly:!editable||!ready||!!op||locked(selected?.id),name,keyValue,
      status:op?.state === 'pending' ? 'Ожидание подтверждения…' : (!ready && !nodeMetadata?.error ? 'Загрузка слоя…' : ''),
      error:op?.state === 'sync' ? 'Изменение подтверждено. Повторите обновление.' : op?.state === 'uncertain' ? 'Результат неизвестен. Повторите ту же команду.' : (nodeMetadata?.error ?? ''),
      retryHidden:!editable||!retryable(op),change:changeNodeMetadata,submit:submitNodeMetadata,cancel:cancelNodeMetadata,retry:retryNodeMetadata});
  }
  async function loadNodeMetadata() {
    const current = ++nodeReadGeneration, doc = workspace.documentId, screen = workspace.selectedScreen, node = layerSelection?.id, atRevision = workspace.revision, epoch = workspace.navigationEpoch, requestToken = workspace.token;
    nodeMetadata = null; renderNodeMetadata();
    if (!doc || !node || !Number.isSafeInteger(atRevision)) return;
    const active = () => current === nodeReadGeneration && doc === workspace.documentId && screen === workspace.selectedScreen && node === layerSelection?.id && atRevision === workspace.revision && epoch === workspace.navigationEpoch && requestToken === workspace.token && workspace.isEditorVisible();
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
      nodeMetadata.error = 'Проверьте значение: не более 256 символов, без управляющих символов; semantic key не может состоять из пробелов.'; renderNodeMetadata(); return;
    }
    const body={commandId:crypto.randomUUID(),nodeId:node};
    const op:MetadataOperation=kind==='name'?{kind,body:{...body,name:value},state:'pending'}:{kind,body:{...body,semanticKey:value===''?null:value},state:'pending'};
    nodeOperations.set(key, op); sendNodeMetadata(doc, screen, node, op);
  }
  function changeNodeMetadata(kind:MetadataKind,value:string) {
    if (!layerSelection || nodeMetadata?.id !== layerSelection.id || !['Owner','Editor'].includes(workspace.documentRole??'')) return;
    const key = nodeOperationKey(workspace.documentId, layerSelection.id);
    if (nodeOperations.has(key)) return;
    if (!metadataDrafts.has(key)) metadataDrafts.set(key, new Map());
    metadataDrafts.get(key)?.set(kind,value);
    clearTimeout(metadataTimer);
    metadataTimer = setTimeout(() => {
      if (layerSelection && key === nodeOperationKey(workspace.documentId, layerSelection.id)) submitNodeMetadata(kind);
    }, 500);
    renderNodeMetadata();
  }
  function cancelNodeMetadata(kind:MetadataKind) {
    if(!layerSelection)return;
    clearTimeout(metadataTimer);
    metadataDrafts.get(nodeOperationKey(workspace.documentId, layerSelection.id))?.delete(kind);
    renderNodeMetadata();
  }
  function retryNodeMetadata() {
    const op = layerSelection && nodeOperations.get(nodeOperationKey(workspace.documentId, layerSelection.id));
    if(op&&retryable(op)&&workspace.documentId&&workspace.selectedScreen&&layerSelection)void sendNodeMetadata(workspace.documentId,workspace.selectedScreen,layerSelection.id,op);
  }
  async function sendNodeMetadata(doc:string,screen:string,node:string,op:MetadataOperation) {
    const key = nodeOperationKey(doc, node), epoch = workspace.navigationEpoch, requestToken = workspace.token, selectionEpoch = layerSelectionEpoch;
    const active = () => nodeOperations.get(key) === op && workspace.documentId === doc && workspace.selectedScreen === screen && workspace.navigationEpoch === epoch && workspace.token === requestToken && workspace.isEditorVisible();
    op.state = 'pending'; if (active()) renderNodeMetadata();
    try {
      op.mutation??=op.kind==='name'?prepareDocumentCommand(doc,'set-node-name',op.body):prepareDocumentCommand(doc,'set-node-semantic-key',op.body);
      const result=await op.mutation.execute({request,isCurrent:active,synchronize:async()=>{
        let synced=false;
        await runPageRefresh(async signal=>{synced=await readCurrentPages(signal,active)===true;});
        return synced;
      }});
      if(nodeOperations.get(key)!==op)return;
      if(result.kind==='rejected'||result.kind==='conflict')throw result.error;
      if(result.kind!=='confirmed'){op.state='uncertain';return;}
      if(result.synchronization!=='synced'){op.state='sync';return;}
      nodeOperations.delete(key);metadataDrafts.get(key)?.delete(op.kind);
      if(nodeMetadata?.id===node){if(op.kind==='name')nodeMetadata.name=op.body.name;else nodeMetadata.semanticKey=op.body.semanticKey;}
      if(activeContext())renderNodeMetadata();
      function activeContext(){return workspace.documentId===doc&&workspace.selectedScreen===screen&&workspace.navigationEpoch===epoch&&workspace.token===requestToken&&workspace.isEditorVisible();}
    } catch (error) {
      if (nodeOperations.get(key) !== op) return;
      if (!(error instanceof ApiError)) op.state = 'uncertain';
      else {
        const stillActive=active();
        nodeOperations.delete(key);
        if (error instanceof ApiError && error.status === 403) { if(stillActive)closeInaccessibleDocument(error.status); return; }
        if(!stillActive)return;
        if (error.code === 'NODE_NOT_FOUND') {
          const currentContext = () => workspace.documentId === doc && workspace.selectedScreen === screen && layerSelection?.id === node && layerSelectionEpoch === selectionEpoch && workspace.navigationEpoch === epoch && workspace.token === requestToken && workspace.isEditorVisible();
          await runPageRefresh(signal => readCurrentPages(signal, currentContext));
          if (workspace.documentId === doc && workspace.selectedScreen === screen && workspace.navigationEpoch === epoch && workspace.token === requestToken && workspace.isEditorVisible() && !layerSelection) setLayerStatus('Слой больше не существует.');
          return;
        }
        if (nodeMetadata?.id === node && layerSelection?.id === node) { nodeMetadata.error = error.message; renderNodeMetadata(); }
        return;
      }
    } finally { if (nodeOperations.get(key) === op && workspace.documentId === doc && workspace.selectedScreen === screen && layerSelection?.id === node && workspace.navigationEpoch === epoch && workspace.token === requestToken && workspace.isEditorVisible()) renderNodeMetadata(); }
  }

  function locked(id:string|undefined,includeSelf=true):boolean {
    if(!id)return false;const item=findLayer(id);if(!item)return false;
    return (includeSelf&&item.properties?.editorLocked?.value===true)||locked(item.parentId);
  }
  function deleteNode() {
    if([...selectedIds].some(id=>locked(id)))return;
    if(selectedIds.size>1){if(confirm('Удалить выбранные слои и их поддеревья?'))deleteMultiple([...selectedIds]);return;}
    const node = layerSelection, doc = workspace.documentId, screen = workspace.selectedScreen, key = `${doc}:${screen}`;
    if (!doc || !screen || !node || !['Owner', 'Editor'].includes(workspace.documentRole??'') || (nodeDeletions.has(key) && nodeDeletions.get(key)?.state !== 'rejected') || nodeOperations.has(nodeOperationKey(doc, node.id))) return;
    const name = node.name?.trim() || 'Без имени';
    if (!confirm(`Удалить слой «${name}»? Будет удалено всё его поддерево.`)) return;
    const op:DeleteOperation = { doc, screen, name, body: { commandId: crypto.randomUUID(), nodeId: node.id }, state: 'ready' };
    nodeDeletions.set(key, op); sendNodeDeletion(op);
  }
  function retryNodeDeletion() {
    const op = nodeDeletions.get(`${workspace.documentId}:${workspace.selectedScreen}`);
    if (op&&retryable(op)) sendNodeDeletion(op);
  }
  async function sendNodeDeletion(op:DeleteOperation) {
    const key = `${op.doc}:${op.screen}`;
    if (nodeDeletions.get(key) !== op || op.state === 'pending') return;
    const epoch = workspace.navigationEpoch, screenEpoch = screenContextEpoch, requestToken = workspace.token;
    const active = () => screenEpoch === screenContextEpoch && nodeDeletions.get(key) === op && workspace.documentId === op.doc && workspace.selectedScreen === op.screen && workspace.navigationEpoch === epoch && workspace.token === requestToken && workspace.isEditorVisible();
    op.state = 'pending'; renderNodeDeletion();
    try {
      op.mutation??=prepareDocumentCommand(op.doc,'delete-node',op.body);
      const result=await op.mutation.execute({request,isCurrent:active,synchronize:async()=>{
        let synced=false;
        await runPageRefresh(async signal=>{synced=await readCurrentPages(signal,active)===true;});
        return synced;
      }});
      if(result.kind==='rejected'||result.kind==='conflict')throw result.error;
      if(result.kind!=='confirmed'){op.state='uncertain';return;}
      if(result.synchronization==='synced'&&nodeDeletions.get(key)===op){nodeDeletions.delete(key);if(workspace.documentId===op.doc&&workspace.selectedScreen===op.screen)renderNodeDeletion();}
      else op.state='sync';
    } catch (error) {
      if (!(error instanceof ApiError)) { op.state = 'uncertain'; return; }
      if (error instanceof ApiError && error.status === 403) { const stillActive=active();nodeDeletions.delete(key);if(stillActive)closeInaccessibleDocument(403);return; }
      if(!active()){nodeDeletions.delete(key);return;}
      if (error.code === 'NODE_NOT_FOUND') {
        await runPageRefresh(signal => readCurrentPages(signal, active));
        if (!active()) { op.state = 'rejected'; return; }
        op.error = 'Слой уже удалён другим участником.';
      } else op.error = ({ SCENARIO_IN_USE: 'Слой или его поддерево используется в сценариях. Сначала удалите ссылки сценариев.', SCREEN_VARIANT_IN_USE: 'Слой или его поддерево используется в вариантах. Сначала удалите ссылки вариантов.', INVALID_REPEATER: 'Слой используется повторителем. Сначала удалите зависимость.', INVALID_COMPONENT: 'Слой используется компонентом. Сначала удалите зависимость.' } as Record<string,string>)[error.code??''] || error.message;
      op.state = 'rejected';
    } finally { if (nodeDeletions.get(key) === op && workspace.documentId === op.doc && workspace.selectedScreen === op.screen && workspace.token === requestToken && workspace.isEditorVisible()) renderNodeDeletion(); }
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
  const canMove = () => ['Owner', 'Editor'].includes(workspace.documentRole??'') && !nodeMoves.has(moveKey()) && workspace.isEditorVisible();
  function renderNodeOrder() {
    const op = nodeMoves.get(moveKey());
    const editable = ['Owner', 'Editor'].includes(workspace.documentRole??'');
    setMoveEnabled(editable && !op);
    const context=siblingContext(layerSelection?.id),free=!!context&&(context.parent===workspace.selectedScreen||(findLayer(context.parent)?.properties?.layout?.value??'Free')==='Free');
    const enabled=editable&&!op&&free&&selectedIds.size===1&&!locked(layerSelection?.id);
    model.order.publish({up:!!(enabled&&context&&context.index>0),down:!!(enabled&&context&&context.index<context.count-1),move:(delta,extreme)=>{if(enabled)beginNodeMove(delta,extreme);},retryHidden:!editable||!retryable(op),retry:retryNodeOrder,status:!editable ? '' : op?.state === 'pending' ? 'Перемещение слоя…' : op?.state === 'sync' ? 'Перемещение подтверждено. Повторите обновление.' : op?.state === 'uncertain' ? `Результат перемещения неизвестен. Повторите ту же команду для слоя «${op.name}».` : nodeMoveNotices.get(moveKey()) || ''});
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
      if (!item || !canMove()||locked(item.id)||locked(plan.targetParentId)) return;
      // A dirty inspector draft must be resolved before moving, never during a gesture.
      if (layerSelection?.id !== id && !beforeSelectionChange(() => selectLayer(item))) return;
      selectLayer(item);
      renderLayers(id);
      startNodeMove(plan.expectedParentId, plan.targetParentId, plan.position, plan.reveal);
    }
  });

  function beginNodeMove(delta:number, extreme=false) {
    const context = siblingContext(layerSelection?.id);
    if (!context||!layerSelection||selectedIds.size!==1||locked(layerSelection.id)) return;
    // Extreme z-order operations apply only to a free parent; stack order is layout order.
    if (extreme && context.parent !== workspace.selectedScreen) {
      const parent=findLayer(context.parent);
      if(!parent || (parent.properties?.layout?.value ?? 'Free')!=='Free')return;
    }
    const position = extreme ? (delta < 0 ? 0 : context.count-1) : context.index + delta;
    if (position === context.index || position < 0 || position >= context.count) return;
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
  function retryNodeOrder() {
    const op = nodeMoves.get(`${workspace.documentId}:${workspace.selectedScreen}`);
    if (op&&retryable(op)) sendNodeMove(op);
  }
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
    const epoch = workspace.navigationEpoch, screenEpoch = screenContextEpoch, requestToken = workspace.token;
    const context = () => nodeMoves.get(key) === op && workspace.documentId === op.doc && workspace.selectedScreen === op.screen && screenContextEpoch === screenEpoch && workspace.navigationEpoch === epoch && workspace.token === requestToken && workspace.isEditorVisible();
        const restoreFocus = element('layers').contains(document.activeElement) || document.activeElement === element('node-order-retry');
    op.state = 'pending'; renderNodeOrder();
    try {
      op.mutation??=prepareDocumentCommand(op.doc,'move-node',op.body);
      const result=await op.mutation.execute({request,isCurrent:context,
        synchronize:()=>refreshNodeMoveTree(context,layerSelection?.id===op.body.nodeId?op.reveal:[])});
      if(result.kind==='rejected'||result.kind==='conflict')throw result.error;
      if(result.kind!=='confirmed'){op.state='uncertain';return;}
      const synced=result.synchronization==='synced';
      if (context() && synced) {
        nodeMoves.delete(key);
        nodeMoveNotices.set(key, (op.body.expectedParentId !== op.body.targetParentId ? 'Слой перемещён к новому родителю.' : 'Порядок слоёв изменён.') + ` Позиция: ${op.body.position + 1}.`);
        if (layerSelection?.id === op.body.nodeId && restoreFocus &&
            (element('layers').contains(document.activeElement) || document.activeElement === document.body || document.activeElement === element('node-order-retry'))) {
          renderLayers(op.body.nodeId);
          element('layers').querySelector('[role=treeitem][aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      } else op.state = 'sync';
    } catch (error) {
      if (!(error instanceof ApiError)) { op.state = 'uncertain'; return; }
      if (error.status === 403 || error.code === 'DOCUMENT_NOT_FOUND') { const stillActive=context();nodeMoves.delete(key);if(stillActive)closeInaccessibleDocument(error.status);return; }
      if(!context()){nodeMoves.delete(key);return;}
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
      if (workspace.documentId === op.doc && workspace.selectedScreen === op.screen && workspace.token === requestToken && (workspace.navigationEpoch === epoch || nodeMoves.get(key) === op) && workspace.isEditorVisible())
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
    const onSelect = (id:string, row:HTMLElement|null, toggle=false) => {
      const latest = findLayer(id);
      if (!latest) return;
      const select = () => { if(toggle)toggleSelection(latest);else selectLayer(latest); row?.focus(); if (!toggle && latest.childCount) void toggleLayer(latest); };
      if (layerSelection?.id === latest.id || beforeSelectionChange(select)) select();
    };
    // Keyboard navigation and drag/drop read the committed tree geometry immediately.
    flushSync(() => model.publish({layerRoots, layerChildren: new Map(layerChildren),
      layerExpanded: new Set(layerExpanded), interactiveNodes, selectedIds:new Set(selectedIds), focus, onSelect,editable:['Owner','Editor'].includes(workspace.documentRole??''),onProperty:(id,name,value)=>{if(name!=='editorLocked'&&locked(id)||locked(id,false))return;editLayerProperties(id,{[name]:{type:'boolean',value}});}}));
    if (focusId || (focusedId && focus)) {
      const row = [...tree.querySelectorAll<HTMLElement>('[role=treeitem]')].find(item => item.dataset.id === focus);
      if (row && document.activeElement !== row) row.focus({preventScroll: true});
    }
  }

  function toggleSelection(item:LayerItem){
    if(!selectedIds.has(item.id)){selectLayer(item,true);return;}
    selectedIds.delete(item.id);
    const next=findLayer([...selectedIds].at(-1));
    if(next){selectLayer(next,true);onLayerSelected();setCaption(selectedIds.size>1?'Выбрано слоёв: '+selectedIds.size:'Слой: '+(next.name??next.kind));}
    else {layerSelection=null;nodeReadGeneration++;nodeMetadata=null;renderNodeMetadata();setCaption('Выберите слой.');onSelectionCleared();renderLayers();}
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
    setLayerStatus(error instanceof TypeError ? 'Не удалось загрузить слои. Проверьте соединение и обновите страницы.' : `${errorMessage(error)} Обновите страницы.`);
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
        setLayerStatus('Загрузка слоёв…');
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
      setLayerStatus('Стрелки перемещают выбор, Enter выбирает слой.');
    } catch (error) { layerFailure(error, current); }
  }

  element('layers').addEventListener('keydown', event => {
    const row=event.target instanceof Element?event.target.closest<HTMLElement>('[role=treeitem]'):null;
    if (!row || event.target instanceof Element&&event.target.closest('button')) return;
    const rows = [...element('layers').querySelectorAll<HTMLElement>('[role=treeitem]')], index = rows.indexOf(row);
    let target:HTMLElement|null|undefined;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (canMove() && layerSelection) beginNodeMove(event.key === 'ArrowUp' ? -1 : 1, event.shiftKey);
      return;
    }
    if (event.key === 'ArrowDown') target = rows[index + 1];
    else if (event.key === 'ArrowUp') target = rows[index - 1];
    else if (event.key === 'Home') target = rows[0];
    else if (event.key === 'End') target = rows.at(-1);
    else if (event.key === 'ArrowLeft') {
      if (layerExpanded.has(row.dataset.id??'')) { layerExpanded.delete(row.dataset.id??''); renderLayers(row.dataset.id); }
      else target = row.parentElement?.closest<HTMLElement>('[role=treeitem]');
    } else if (event.key === 'ArrowRight') {
      const item = findLayer(row.dataset.id);
      if (item?.childCount && !layerExpanded.has(item.id)) void toggleLayer(item);
      else if (item?.childCount && layerExpanded.has(item.id)) target = row.querySelector<HTMLElement>('[role=treeitem]');
    } else if (event.key === 'Enter' || event.key === ' ') {
      const item = findLayer(row.dataset.id);
      if (item) {const select=()=>event.ctrlKey||event.metaKey||event.shiftKey?toggleSelection(item):selectLayer(item);if(layerSelection?.id===item.id||beforeSelectionChange(select))select();}
    } else return;
    event.preventDefault();
    if (target) { row.tabIndex = -1; target.tabIndex = 0; target.focus(); }
  }, {signal:lifetime.signal});

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
    if (selected) {selectedIds=new Set([...selectedIds].filter(id=>!!findLayer(id)));selectLayer(selected,selectedIds.has(selected.id));}
    else if (layerSelection) {
      layerSelection = null; selectedIds.clear();
      layerSelectionEpoch++;
      nodeReadGeneration++;
      nodeMetadata = null;
      renderNodeMetadata();
      setCaption('Выберите слой.');
      onSelectionCleared();
    }
    renderLayers();
    setLayerStatus(screen ? (roots.length ? 'Стрелки перемещают выбор, Enter выбирает слой.' : 'На экране нет слоёв.') : 'Выберите экран.');
  }

  function selectFromCanvas(rawItem:unknown,rawNodes:unknown[],confirmed=false,mode:'replace'|'toggle'|'preserve'='replace') {
    const item=layer(rawItem),nodes=rawNodes.map(n=>layer(n));
    if (!confirmed && layerSelection?.id !== item.id && !beforeSelectionChange(() => selectFromCanvas(item, nodes, true,mode))) return false;
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
    if(mode==='toggle')toggleSelection(item);else selectLayer(item,mode==='preserve');
    renderLayers();
    return true;
  }

  function selectRegion(rawItems:unknown[],rawNodes:unknown[],add:boolean,confirmed=false){
    if(!confirmed&&!beforeSelectionChange(()=>selectRegion(rawItems,rawNodes,add,true)))return;
    const nodes=rawNodes.map(n=>layer(n)),items=rawItems.map(n=>layer(n));
    if(!items.length){if(!add&&layerSelection){layerSelection=null;selectedIds.clear();nodeMetadata=null;nodeReadGeneration++;renderNodeMetadata();setCaption('Выберите слой.');onSelectionCleared();renderLayers();}return;}
    const byId=new Map(nodes.map(n=>[n.id,n]));
    layerChildren=new Map();for(const n of nodes){const branch=layerChildren.get(n.parentId)??[];branch.push(n);layerChildren.set(n.parentId,branch);}
    layerRoots=layerChildren.get(workspace.selectedScreen??'')??[];
    if(!add)selectedIds.clear();
    for(const item of items){selectedIds.add(item.id);for(let p=byId.get(item.parentId);p;p=byId.get(p.parentId))layerExpanded.add(p.id);}
    const item=items.at(-1);if(item){selectLayer(item,true);onLayerSelected();}
  }
  function clearCommands() {
    clearTimeout(metadataTimer); metadataDrafts.clear(); nodeOperations.clear(); nodeDeletions.clear(); nodeMoves.clear(); nodeMoveNotices.clear();
  }

  return {
    reset, clearCommands, discardDocument(doc:string){clearTimeout(metadataTimer);for(const map of [metadataDrafts,nodeOperations,nodeDeletions,nodeMoves,nodeMoveNotices])for(const key of map.keys())if(key.startsWith(doc+':'))map.delete(key);}, dispose(){lifetime.abort();drag.dispose();layerController?.abort();clearCommands();}, deleteNode, readSnapshot, isExpansionCurrent, applySnapshot, findLayer, selectFromCanvas,selectRegion,
    selectById(id:string){const item=findLayer(id);if(!item)return;const select=()=>{selectLayer(item);if(item.childCount)void toggleLayer(item);renderLayers(id);};if(layerSelection?.id===id||beforeSelectionChange(select))select();},
    refreshMoveAvailability() { if (!canMove()) drag.cancel(); renderNodeOrder(); },
    setInteractiveNodes(ids:string[]) { interactiveNodes = new Set(ids); renderLayers(); },
    clearSelection() {
      if (!layerSelection) return;
      layerSelection = null; selectedIds.clear(); layerSelectionEpoch++; nodeReadGeneration++; nodeMetadata = null;
      drag.cancel(); renderNodeMetadata(); renderNodeOrder(); renderLayers();
      setCaption('Выберите слой.');
      onSelectionCleared();
    },
    onScreenContextChanged: () => { drag.cancel(); screenContextEpoch++; },
    get selection() { return layerSelection; },
    get selectedIds() { return [...selectedIds]; },
    get hasLayers() { return layerRoots.length > 0; }
  };
}
