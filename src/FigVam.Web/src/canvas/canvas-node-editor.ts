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
  selectRegion(nodes:CanvasNode[],orderedNodes:CanvasNode[],add:boolean):void;
  editBatch(operations:({action:'set';nodeId:string;expectedParentId:string;properties:Geometry}|{action:'delete';nodeId:string})[],revision:number,settle:(confirmed:boolean)=>void):boolean;
  editGeometry(command: GeometryCommand, settle: (confirmed: boolean) => void): boolean;
  isEditPending(): boolean;
  setHint(hint:string):void;
  deleteSelected():void;
}
interface Target { model: CanvasModel; node: CanvasNode; bounds: Bounds; parentBounds: Bounds; definitions: PropertyDefinitions; inStack: boolean }
interface Edit extends Target {
  wrapper: HTMLElement; screenBounds:Bounds; matrix:DOMMatrixReadOnly; names: Axis[]; initial: Partial<Record<Axis, number>>; revision: number;
  properties: Geometry; style: Partial<Record<GeometryStyle, string>>;
}
interface Gesture extends Edit { others:Edit[]; pointer: number; x: number; y: number; scale: number; moved: boolean }


const arrows: Record<string, [number, number] | undefined> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
};
const geometryStyles: Record<Axis, GeometryStyle> = { x: 'left', y: 'top', width: 'width', height: 'height' };

export function createCanvasNodeEditor({
  element, getContext, getModel, getScale, getGrid, selectLayer, selectRegion, editGeometry, editBatch, isEditPending, setHint, deleteSelected
}: NodeEditorOptions) {
  const listeners = new AbortController();
  const signal = listeners.signal;
  const viewport = element('viewport'), boundary = element('screen-boundary');
  const resizeHandle = document.createElement('span');
  resizeHandle.className = 'canvas-resize-handle';
  resizeHandle.title = 'Изменить размер (Shift — сохранить пропорции)';
  resizeHandle.setAttribute('aria-hidden', 'true');
  let gesture: Gesture | null = null, selectedWrapper: HTMLElement | null = null;
  const marquee=document.createElement('div');marquee.className='canvas-marquee';marquee.hidden=true;viewport.append(marquee);
  let region:{pointer:number;x:number;y:number;model:CanvasModel;scale:number;add:boolean}|null=null;
  function regionBounds(event:PointerEvent){if(!region)return null;return {left:Math.min(region.x,event.clientX),top:Math.min(region.y,event.clientY),right:Math.max(region.x,event.clientX),bottom:Math.max(region.y,event.clientY)};}
  function cancelRegion(){const old=region;region=null;marquee.hidden=true;if(old&&viewport.hasPointerCapture(old.pointer))viewport.releasePointerCapture(old.pointer);}
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
    if(region&&(region.model!==getModel()||region.scale!==getScale()))cancelRegion();
    if (gesture && (!(getContext().selectedIds??(id?[id]:[])).includes(gesture.node.id) || gesture.model !== selected?.model || !writable())) cancel();
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
      ...selected, wrapper,screenBounds:screenBounds(wrapper),matrix:localMatrix(wrapper,resize), names, initial, revision, properties: {},
      style: Object.fromEntries(names.map(name => [geometryStyles[name], wrapper.style[geometryStyles[name]]]))
    };
  }

  function screenBounds(wrapper:HTMLElement):Bounds{
    const rect=wrapper.getBoundingClientRect(),origin=boundary.getBoundingClientRect(),scale=getScale();
    return {x:(rect.left-origin.left)/scale,y:(rect.top-origin.top)/scale,width:rect.width/scale,height:rect.height/scale};
  }
  function localMatrix(element:HTMLElement,resize:boolean){
    let matrix=new DOMMatrixReadOnly(),wrapper:HTMLElement|null=resize?element:element.parentElement;
    while(wrapper&&wrapper!==boundary){
      if(wrapper.hasAttribute('data-visual-node')){
        const transform=getComputedStyle(wrapper).transform;
        if(transform!=='none')matrix=new DOMMatrixReadOnly(transform).multiply(matrix);
      }
      wrapper=wrapper.parentElement;
    }
    return matrix;
  }
  function transform(matrix:DOMMatrixReadOnly,x:number,y:number):[number,number]{
    const result=matrix.transformPoint(new DOMPoint(x,y,0,0));return [result.x,result.y];
  }
  function snapTargets(edits:Edit[]){
    const grid=getGrid(),x:number[]=[],y:number[]=[];
    const excluded=new Set(edits.map(e=>e.node.id)),parents=new Set(edits.map(e=>e.node.parentId));
    const first=edits[0];if(!first)return {x,y,step:null,tolerance:0};
    const add=(b:Bounds)=>{x.push(b.x,b.x+b.width/2,b.x+b.width);y.push(b.y,b.y+b.height/2,b.y+b.height);};
    if(grid.snapObjects){
      for(const parent of parents){const wrapper=parent===first.model.screen?boundary:boundary.querySelector<HTMLElement>(`[data-visual-node="${CSS.escape(parent)}"]`);if(wrapper)add(screenBounds(wrapper));}
      for(const guide of grid.guides){const limit=first.model.boxes.get(first.model.screen)?.bounds[guide.axis==='x'?'width':'height'];if(limit!==undefined&&guide.position<=limit)(guide.axis==='x'?x:y).push(guide.position);}
      for(const node of first.model.orderedNodes){if(excluded.has(node.id)||!parents.has(node.parentId))continue;
        const wrapper=boundary.querySelector<HTMLElement>(`[data-visual-node="${CSS.escape(node.id)}"]`);
        if(wrapper&&wrapper.getClientRects().length&&getComputedStyle(wrapper).visibility!=='hidden')add(screenBounds(wrapper));
      }
    }
    return {x,y,step:grid.snap?grid.step:null,tolerance:6/getScale()};
  }
  function snapTranslation(edits:Edit[],dx:number,dy:number):[number,number]{
    const targets=snapTargets(edits),bounds=edits.map(e=>e.screenBounds);
    const x=Math.min(...bounds.map(b=>b.x)),right=Math.max(...bounds.map(b=>b.x+b.width));
    const y=Math.min(...bounds.map(b=>b.y)),bottom=Math.max(...bounds.map(b=>b.y+b.height));
    const sx=closestSnap([x+dx,(x+right)/2+dx,right+dx],targets.x,targets.step,targets.tolerance);
    const sy=closestSnap([y+dy,(y+bottom)/2+dy,bottom+dy],targets.y,targets.step,targets.tolerance);
    guides(sx?.guide,sy?.guide);
    return [dx+(sx?.delta??0),dy+(sy?.delta??0)];
  }
  function preview(edit: Edit, deltaX: number, deltaY: number, keepRatio=false, snap=false) {
    const resizing=edit.names.includes('width');
    const ratio=resizing&&(keepRatio||edit.node.properties.aspectRatioLocked?.type==='boolean'&&edit.node.properties.aspectRatioLocked.value);
    [deltaX,deltaY]=transform(edit.matrix.inverse(),deltaX,deltaY);
    const width=edit.initial.width??0,height=edit.initial.height??0;
    const range=(name:Axis)=>({min:edit.definitions[name]?.minimum??0,max:edit.definitions[name]?.maximum??Infinity});
    if(ratio){
      const size=proportionalSize(width,height,deltaX,deltaY,range('width'),range('height'));
      if(!size){restore(edit);edit.properties={};return;}
      deltaX=size[0]-width;deltaY=size[1]-height;
    }
    if(snap&&resizing){
      const targets=snapTargets([edit]),b=edit.screenBounds;
      const [wx,wy]=transform(edit.matrix,width,0),[hx,hy]=transform(edit.matrix,0,height);
      const anchorX=b.x-Math.min(0,wx,hx,wx+hx)+wx+hx,anchorY=b.y-Math.min(0,wy,hy,wy+hy)+wy+hy;
      const [dx,dy]=transform(edit.matrix,deltaX,deltaY);
      const sx=closestSnap([anchorX+dx],targets.x,targets.step,targets.tolerance),sy=closestSnap([anchorY+dy],targets.y,targets.step,targets.tolerance);
      if(ratio){
        const [vx,vy]=transform(edit.matrix,width,height);
        const fx=sx&&Math.abs(vx)>1e-8?sx.delta/vx:null,fy=sy&&Math.abs(vy)>1e-8?sy.delta/vy:null;
        const useX=fx!==null&&(fy===null||Math.abs(fx)<=Math.abs(fy)),f=useX?fx:fy;
        if(f!==null&&Math.hypot(vx*f,vy*f)<=targets.tolerance){
          const size=proportionalSize(width,height,deltaX+width*f,deltaY+height*f,range('width'),range('height'));
          if(size&&Math.abs(size[0]-width-deltaX-width*f)<1e-6){deltaX=size[0]-width;deltaY=size[1]-height;guides(useX?sx?.guide:undefined,useX?undefined:sy?.guide);}
        }
      }else{
        [deltaX,deltaY]=transform(edit.matrix.inverse(),dx+(sx?.delta??0),dy+(sy?.delta??0));
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
    if(others.length||(getContext().selectedIds?.length??0)>1){const edits=[edit,...others];const operations=edits.filter(e=>Object.keys(e.properties).length).map(e=>({action:'set' as const,nodeId:e.node.id,expectedParentId:e.node.parentId,properties:e.properties}));if(!operations.length)return;const settle=(confirmed:boolean)=>{if(!confirmed)edits.forEach(restore);};if(!editBatch(operations,edit.revision,settle))settle(false);return;}
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
    if (!wrapper || !boundary.contains(wrapper)) {
      const model=getModel();
      if(model&&event.shiftKey&&!(event.target instanceof Element&&event.target.closest('[data-guide-id]'))){event.preventDefault();viewport.focus({preventScroll:true});region={pointer:event.pointerId,x:event.clientX,y:event.clientY,model,scale:getScale(),add:event.ctrlKey||event.metaKey};viewport.setPointerCapture(event.pointerId);}
      return;
    }
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
    if(region?.pointer===event.pointerId){const b=regionBounds(event),v=viewport.getBoundingClientRect();if(b){marquee.hidden=false;Object.assign(marquee.style,{left:b.left-v.left+'px',top:b.top-v.top+'px',width:b.right-b.left+'px',height:b.bottom-b.top+'px'});}return;}
    if (gesture?.pointer !== event.pointerId) return;
    if (gesture.scale !== getScale()) {
      cancel();
      return;
    }
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
    gesture.moved = true;
    guides();
    let deltaX=dx/gesture.scale,deltaY=dy/gesture.scale;
    const grid=getGrid(),snap=(grid.snap||grid.snapObjects)&&!event.ctrlKey&&!event.metaKey;
    if(snap&&!gesture.names.includes('width'))[deltaX,deltaY]=snapTranslation([gesture,...gesture.others],deltaX,deltaY);
    preview(gesture,deltaX,deltaY,event.shiftKey,snap);
    for(const edit of gesture.others)preview(edit,deltaX,deltaY);
  }

  viewport.addEventListener('pointermove', track, { signal });
  viewport.addEventListener('pointerup', event => {
    track(event);
    if(region?.pointer===event.pointerId){const current=region,b=regionBounds(event);cancelRegion();if(b&&current.model===getModel()&&current.scale===getScale()){const items=current.model.orderedNodes.filter(node=>{const el=boundary.querySelector<HTMLElement>(`[data-visual-node="${CSS.escape(node.id)}"]`);if(!el||inheritedLock(current.model,node.id)||getComputedStyle(el).visibility==='hidden'||!el.getClientRects().length)return false;const r=el.getBoundingClientRect();return r.left>=b.left&&r.right<=b.right&&r.top>=b.top&&r.bottom<=b.bottom;});selectRegion(items,current.model.orderedNodes,current.add);}return;}
    if (gesture?.pointer === event.pointerId) {const edit=release(gesture);commit(edit,edit.others);}
  }, { signal });
  for (const type of ['pointercancel', 'lostpointercapture'] as const) {
    viewport.addEventListener(type, event => {
      if(region?.pointer===event.pointerId)cancelRegion();
      if (gesture?.pointer === event.pointerId) cancel();
    }, { signal });
  }
  viewport.addEventListener('wheel', event => {
    if (gesture||region) event.preventDefault();
  }, { capture: true, passive: false, signal });
  viewport.addEventListener('keydown', event => {
    if(event.target instanceof Element&&event.target.closest('[data-guide-id]'))return;
    if(event.key==='Escape'&&region){event.preventDefault();cancelRegion();return;}
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
    const ids=getContext().selectedIds??[],model=getModel();
    if(model&&ids.length>1){
      if(event.shiftKey)return;
      const edits=selectionRoots(model,ids).map(id=>{const wrapper=boundary.querySelector<HTMLElement>(`[data-visual-node="${CSS.escape(id)}"]`);return wrapper?begin(id,wrapper,false):null;});
      if(edits.some(e=>!e))return;const valid=edits.filter((e):e is Edit=>!!e);const first=valid[0];if(first){valid.forEach(e=>preview(e,...delta));commit(first,valid.slice(1));}return;
    }
    const edit = begin(selectedWrapper.dataset.visualNode, selectedWrapper, event.shiftKey);
    if (!edit) return;
    preview(edit, ...delta);
    commit(edit);
  }, { capture: true, signal });

  return { sync, dispose() { cancel();cancelRegion(); listeners.abort(); resizeHandle.remove();marquee.remove(); } };
}
