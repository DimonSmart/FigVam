import { resolvePropertyToken } from '../core/tokens/token-resolution.js';
import type { CanvasModel, CanvasNode, Bounds, PropertyDefinitions } from './canvas-model';
import { closestSnap, proportionalSize, selectionRoots, inheritedLock, type GridSettings } from './visual-geometry';

type Axis = keyof Bounds;
type Geometry = Partial<Record<Axis, { type: 'number'; value: number }>>;
type GeometryStyle = 'left' | 'top' | 'width' | 'height';
interface GeometryCommand { nodeId: string; expectedParentId: string; expectedRevision: number; properties: Geometry }
interface NodeEditorOptions {
  element(id: string): HTMLElement;
  getContext(): { documentRole: string | null; revision: number | null; selection?: { id: string } | null;selectedIds?:readonly string[] };
  getModel(): CanvasModel | null;
  getScale(): number;
  getGrid(): GridSettings;
  selectLayer(node: CanvasNode, orderedNodes: CanvasNode[],mode?:'replace'|'toggle'|'preserve'): boolean | void;
  editBatch(operations:({action:'set';nodeId:string;expectedParentId:string;properties:Geometry}|{action:'delete';nodeId:string})[],revision:number,settle:(confirmed:boolean)=>void):boolean;
  editGeometry(command: GeometryCommand, settle: (confirmed: boolean) => void): boolean;
  isEditPending(): boolean;
  setHint(hint:string):void;
  deleteSelected():void;
}
interface Target { model: CanvasModel; node: CanvasNode; bounds: Bounds; parentBounds: Bounds; definitions: PropertyDefinitions; inStack: boolean }
interface Edit extends Target {
  wrapper: HTMLElement; names: Axis[]; initial: Partial<Record<Axis, number>>; revision: number;
  properties: Geometry; style: Partial<Record<GeometryStyle, string>>;
}
interface Gesture extends Edit { others:Edit[]; pointer: number; x: number; y: number; scale: number; moved: boolean }


const arrows: Record<string, [number, number] | undefined> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
};
const geometryStyles: Record<Axis, GeometryStyle> = { x: 'left', y: 'top', width: 'width', height: 'height' };

export function createCanvasNodeEditor({
  element, getContext, getModel, getScale, getGrid, selectLayer, editGeometry, editBatch, isEditPending, setHint, deleteSelected
}: NodeEditorOptions) {
  const listeners = new AbortController();
  const signal = listeners.signal;
  const viewport = element('viewport'), boundary = element('screen-boundary');
  const resizeHandle = document.createElement('span');
  resizeHandle.className = 'canvas-resize-handle';
  resizeHandle.title = 'Изменить размер (Shift — сохранить пропорции)';
  resizeHandle.setAttribute('aria-hidden', 'true');
  let gesture: Gesture | null = null, selectedWrapper: HTMLElement | null = null;
  const guideX=element('canvas-snap-x'),guideY=element('canvas-snap-y');
  function guides(x?:number,y?:number) {
    guideX.hidden=x===undefined;guideY.hidden=y===undefined;
    if(x!==undefined)guideX.style.left=x+'px';
    if(y!==undefined)guideY.style.top=y+'px';
    guideX.parentElement?.style.setProperty('--canvas-scale',String(getScale()));
  }

  function target(id: string | undefined): Target | null {
    const model = getModel();
    if (!id || !model) return null;
    const node = model.nodes.get(id);
    if (!node || inheritedLock(model,id)) return null;
    const parent = model.nodes.get(node.parentId);
    const layout = parent && (parent.properties.layout ?? model.kinds.get(parent.kind)?.properties.layout?.defaultValue);
    const parentLayout = layout && 'value' in layout ? layout.value : undefined;
    const definitions = model.kinds.get(node.kind)?.properties;
    const bounds = model.boxes.get(id)?.bounds, parentBounds = model.boxes.get(node.parentId)?.bounds;
    if (!definitions || !bounds || !parentBounds) return null;
    return { model, node, bounds, parentBounds, definitions, inStack: Boolean(parent && parentLayout !== 'Free') };
  }

  function writable() {
    return ['Owner', 'Editor'].includes(getContext().documentRole ?? '');
  }

  function sync() {
    const id = getContext().selection?.id, selected = target(id);
    if (gesture && (!getContext().selectedIds?.includes(gesture.node.id) || gesture.model !== selected?.model || !writable())) cancel();
    selectedWrapper?.removeAttribute('data-canvas-editable');
    selectedWrapper = id ? boundary.querySelector<HTMLElement>(`[data-visual-node="${CSS.escape(id)}"]`) : null;
    const stack = writable() && selected?.inStack;
    setHint(stack ? 'Положение слоя задаёт стек. Изменить размер можно в инспекторе, порядок — в дереве слоёв.' : '');
    if (!selectedWrapper || !selected || stack || !writable() || (getContext().selectedIds?.length??0)>1) {
      resizeHandle.remove();
      return;
    }
    selectedWrapper.dataset.canvasEditable = '';
    if (resizeHandle.parentElement !== selectedWrapper) selectedWrapper.append(resizeHandle);
    const tokenSized = ['width', 'height'].filter(name =>
      selected.node.properties[name]?.type === 'token');
    resizeHandle.title = tokenSized.length
      ? 'Размер связан с токеном: ' + tokenSized.join(', ')
      : 'Изменить размер (Shift — сохранить пропорции)';
  }

  function begin(id: string | undefined, wrapper: HTMLElement, resize: boolean): Edit | null {
    const revision = getContext().revision;
    if (revision === null) return null;
    const selected = target(id);
    if (!selected || selected.inStack || !writable() || isEditPending()) return null;
    const names: Axis[] = resize ? ['width', 'height'] : ['x', 'y'];
    const initial: Edit['initial'] = {};
    for (const name of names) {
      const definition = selected.definitions[name];
      if (!definition) return null;
      const value = selected.node.properties[name] ?? definition.defaultValue;
      if(resize&&value?.type==='token')return null;
      const resolved = value?.type === 'token'
        ? resolvePropertyToken(value, selected.model.tokens, 'Light', definition)
        : { value, error: null };
      if (resolved.error || resolved.value?.type !== (value?.type === 'token' ? 'dimension' : 'number') || !('value' in resolved.value) || typeof resolved.value.value !== 'number') return null;
      initial[name] = resolved.value.value;
    }
    return {
      ...selected, wrapper, names, initial, revision, properties: {},
      style: Object.fromEntries(names.map(name => [geometryStyles[name], wrapper.style[geometryStyles[name]]]))
    };
  }

  function localDelta(edit: Edit, dx: number, dy: number): [number, number] {
    // The selected element's own rotation affects resize but not translation.
    let matrix = new DOMMatrixReadOnly();
    let wrapper: HTMLElement | null = edit.names.includes('width') ? edit.wrapper : edit.wrapper.parentElement;
    while (wrapper && wrapper !== boundary) {
      if (wrapper.hasAttribute('data-visual-node')) {
        const transform = getComputedStyle(wrapper).transform;
        if (transform !== 'none') matrix = new DOMMatrixReadOnly(transform).multiply(matrix);
      }
      wrapper = wrapper.parentElement;
    }
    const local = matrix.inverse().transformPoint(new DOMPoint(dx, dy, 0, 0));
    return [local.x, local.y];
  }

  function preview(edit: Edit, deltaX: number, deltaY: number, keepRatio=false, snap=false) {
    [deltaX, deltaY] = localDelta(edit, deltaX, deltaY);
    guides();
    const resizing=edit.names.includes('width');
    const grid=getGrid();
    if ((keepRatio || edit.node.properties.aspectRatioLocked?.type==='boolean'&&edit.node.properties.aspectRatioLocked.value) && resizing) {
      if (['width','height'].some(name=>(edit.node.properties[name]??edit.definitions[name]?.defaultValue)?.type==='token')) {
        restore(edit);edit.properties={};return;
      }
      const width=edit.initial.width??0,height=edit.initial.height??0;
      const range=(name:Axis)=>({min:edit.definitions[name]?.minimum??0,max:edit.definitions[name]?.maximum??Infinity});
      const size=proportionalSize(width,height,deltaX,deltaY,range('width'),range('height'));
      if(size){deltaX=size[0]-width;deltaY=size[1]-height;}
    } else if(snap && (grid.snap || grid.snapObjects)) {
      // Layout boxes are screen-space and unrotated. Do not mix coordinate spaces in a rotated gesture.
      let unrotated=true;
      for(let wrapper:HTMLElement|null=edit.wrapper;wrapper&&wrapper!==boundary;wrapper=wrapper.parentElement) {
        if(wrapper.hasAttribute('data-visual-node')&&getComputedStyle(wrapper).transform!=='none'){unrotated=false;break;}
      }
      if(unrotated){
        const {x,y,width,height}=edit.bounds;
        const origin=boundary.getBoundingClientRect(),scale=getScale();
        const targetsX:number[]=[],targetsY:number[]=[];
        const add=(bounds:Bounds)=>{targetsX.push(bounds.x,bounds.x+bounds.width/2,bounds.x+bounds.width);targetsY.push(bounds.y,bounds.y+bounds.height/2,bounds.y+bounds.height);};
        if(grid.snapObjects){
          add(edit.parentBounds);
          for(const guide of grid.guides){const limit=edit.model.boxes.get(edit.model.screen)?.bounds[guide.axis==='x'?'width':'height'];if(limit!==undefined&&guide.position<=limit)(guide.axis==='x'?targetsX:targetsY).push(guide.position);}
          for(const node of edit.model.orderedNodes){
            if(node.id===edit.node.id||node.parentId!==edit.node.parentId)continue;
            const wrapper=boundary.querySelector<HTMLElement>(`[data-visual-node="${CSS.escape(node.id)}"]`);
            if(!wrapper||getComputedStyle(wrapper).visibility==='hidden')continue;
            const box=wrapper.getBoundingClientRect();
            add({x:(box.left-origin.left)/scale,y:(box.top-origin.top)/scale,width:box.width/scale,height:box.height/scale});
          }
        }
        const step=grid.snap?grid.step:null,tolerance=6/scale;
        const sx=closestSnap(resizing?[x+width+deltaX]:[x+deltaX,x+width/2+deltaX,x+width+deltaX],targetsX,step,tolerance);
        const sy=closestSnap(resizing?[y+height+deltaY]:[y+deltaY,y+height/2+deltaY,y+height+deltaY],targetsY,step,tolerance);
        if(sx)deltaX+=sx.delta;if(sy)deltaY+=sy.delta;
        guides(sx?.guide,sy?.guide);
      }
    }
    edit.properties = {};
    for (const [index, name] of edit.names.entries()) {
      const { minimum = -Infinity, maximum = Infinity } = edit.definitions[name] ?? {};
      // Ignore subpixel noise introduced by the inverse viewport transform.
      const delta = Math.round((index ? deltaY : deltaX) * 1000) / 1000;
      const initial = edit.initial[name];
      if (initial === undefined) continue;
      const value = Math.max(minimum ?? -Infinity, Math.min(maximum ?? Infinity, initial + delta));
      const style = geometryStyles[name];
      if (value === initial) {
        edit.wrapper.style[style] = edit.style[style] ?? '';
        continue;
      }
      edit.properties[name] = { type: 'number', value };
      const parentOrigin = name === 'x' || name === 'y' ? edit.parentBounds[name] : 0;
      edit.wrapper.style[style] = `${edit.bounds[name] - parentOrigin + value - initial}px`;
    }
  }

  function restore(edit: Edit) {
    Object.assign(edit.wrapper.style, edit.style);
  }

  function commit(edit: Edit,others:Edit[]=[]) {
    if(others.length){const edits=[edit,...others];const operations=edits.filter(e=>Object.keys(e.properties).length).map(e=>({action:'set' as const,nodeId:e.node.id,expectedParentId:e.node.parentId,properties:e.properties}));if(!operations.length)return;const settle=(confirmed:boolean)=>{if(!confirmed)edits.forEach(restore);};if(!editBatch(operations,edit.revision,settle))settle(false);return;}
    if (!Object.keys(edit.properties).length) return;
    const accepted = editGeometry({
      nodeId: edit.node.id, expectedParentId: edit.node.parentId,
      expectedRevision: edit.revision, properties: edit.properties
    }, confirmed => { if (!confirmed) restore(edit); });
    if (!accepted) restore(edit);
  }

  function release(edit: Gesture): Gesture {
    gesture = null;
    guides();
    if (viewport.hasPointerCapture(edit.pointer)) viewport.releasePointerCapture(edit.pointer);
    return edit;
  }

  function cancel() {
    if (gesture) {const edit=release(gesture);[edit,...edit.others].forEach(restore);}
  }

  viewport.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || event.altKey) return;
    const wrapper = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-visual-node]') : null;
    if (!wrapper || !boundary.contains(wrapper)) return;
    event.preventDefault();
    viewport.focus({ preventScroll: true });
    const id = wrapper.dataset.visualNode, selected = target(id);
    if (!selected || gesture) return;
    const resize=event.target===resizeHandle;
    if(!resize&&(event.shiftKey||event.ctrlKey||event.metaKey)){selectLayer(selected.node,selected.model.orderedNodes,'toggle');return;}
    const ids=getContext().selectedIds??[];
    if (getContext().selection?.id !== id && selectLayer(selected.node, selected.model.orderedNodes,ids.includes(selected.node.id)?'preserve':'replace') === false) return;
    const roots=selectionRoots(selected.model,getContext().selectedIds??[selected.node.id]);
    const edits=roots.map(nodeId=>{const el=boundary.querySelector<HTMLElement>(`[data-visual-node="${CSS.escape(nodeId)}"]`);return el?begin(nodeId,el,resize):null;});
    if(edits.some(e=>!e))return;
    const edit=edits.find(e=>e?.node.id===id)??edits[0];
    if (!edit) return;
    const others=edits.filter((e):e is Edit=>!!e&&e!==edit);
    gesture = { ...edit, others, pointer: event.pointerId, x: event.clientX, y: event.clientY, scale: getScale(), moved: false };
    viewport.setPointerCapture(event.pointerId);
  }, { capture: true, signal });

  function track(event: PointerEvent) {
    if (gesture?.pointer !== event.pointerId) return;
    if (gesture.scale !== getScale()) {
      cancel();
      return;
    }
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
    gesture.moved = true;
    preview(gesture, dx / gesture.scale, dy / gesture.scale, event.shiftKey, !gesture.others.length&&!event.ctrlKey && !event.metaKey);
    for(const edit of gesture.others)preview(edit,dx/gesture.scale,dy/gesture.scale);
  }

  viewport.addEventListener('pointermove', track, { signal });
  viewport.addEventListener('pointerup', event => {
    track(event);
    if (gesture?.pointer === event.pointerId) {const edit=release(gesture);commit(edit,edit.others);}
  }, { signal });
  for (const type of ['pointercancel', 'lostpointercapture'] as const) {
    viewport.addEventListener(type, event => {
      if (gesture?.pointer === event.pointerId) cancel();
    }, { signal });
  }
  viewport.addEventListener('wheel', event => {
    if (gesture) event.preventDefault();
  }, { capture: true, passive: false, signal });
  viewport.addEventListener('keydown', event => {
    if(event.target instanceof Element&&event.target.closest('[data-guide-id]'))return;
    if (event.key === 'Escape' && gesture) {
      event.preventDefault();
      cancel();
      return;
    }
    const delta = arrows[event.key];
    if (gesture && delta) {
      event.preventDefault();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || !selectedWrapper || !writable()) return;
    if (event.key === 'Delete') {
      event.preventDefault();
      if (!gesture && !isEditPending()) {const model=getModel(),ids=getContext().selectedIds??[];if(model&&ids.length>1){if(ids.some(id=>inheritedLock(model,id)))return;if(confirm('Удалить выбранные слои и их поддеревья?'))editBatch(selectionRoots(model,ids).map(nodeId=>({action:'delete',nodeId})),model.revision,()=>{});}else deleteSelected();}
      return;
    }
    if (!delta) return;
    event.preventDefault();
    if((getContext().selectedIds?.length??0)>1)return;
    const edit = begin(selectedWrapper.dataset.visualNode, selectedWrapper, event.shiftKey);
    if (!edit) return;
    preview(edit, ...delta);
    commit(edit);
  }, { capture: true, signal });

  return { sync, dispose() { cancel(); listeners.abort(); resizeHandle.remove(); } };
}
