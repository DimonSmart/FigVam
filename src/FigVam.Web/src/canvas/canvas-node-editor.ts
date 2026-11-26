import { resolvePropertyToken } from '../core/tokens/token-resolution.js';
import type { CanvasModel, CanvasNode, Bounds, PropertyDefinitions } from './canvas-model';

type Axis = keyof Bounds;
type Geometry = Partial<Record<Axis, { type: 'number'; value: number }>>;
type GeometryStyle = 'left' | 'top' | 'width' | 'height';
interface GeometryCommand { nodeId: string; expectedParentId: string; expectedRevision: number; properties: Geometry }
interface NodeEditorOptions {
  element(id: string): HTMLElement;
  getContext(): { documentRole: string | null; revision: number; selection?: { id: string } | null };
  getModel(): CanvasModel | null;
  getScale(): number;
  selectLayer(node: CanvasNode, orderedNodes: CanvasNode[]): boolean | void;
  editGeometry(command: GeometryCommand, settle: (confirmed: boolean) => void): boolean;
  isEditPending(): boolean;
}
interface Target { model: CanvasModel; node: CanvasNode; bounds: Bounds; parentBounds: Bounds; definitions: PropertyDefinitions; inStack: boolean }
interface Edit extends Target {
  wrapper: HTMLElement; names: Axis[]; initial: Partial<Record<Axis, number>>; revision: number;
  properties: Geometry; style: Partial<Record<GeometryStyle, string>>;
}
interface Gesture extends Edit { pointer: number; x: number; y: number; scale: number; moved: boolean }


const arrows: Record<string, [number, number] | undefined> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
};
const geometryStyles: Record<Axis, GeometryStyle> = { x: 'left', y: 'top', width: 'width', height: 'height' };

export function createCanvasNodeEditor({
  element, getContext, getModel, getScale, selectLayer, editGeometry, isEditPending
}: NodeEditorOptions) {
  const listeners = new AbortController();
  const signal = listeners.signal;
  const viewport = element('viewport'), boundary = element('screen-boundary');
  const resizeHandle = document.createElement('span');
  resizeHandle.className = 'canvas-resize-handle';
  resizeHandle.title = 'Изменить размер';
  resizeHandle.setAttribute('aria-hidden', 'true');
  let gesture: Gesture | null = null, selectedWrapper: HTMLElement | null = null;

  function target(id: string | undefined): Target | null {
    const model = getModel();
    if (!id || !model) return null;
    const node = model.nodes.get(id);
    if (!node) return null;
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
    if (gesture && (gesture.node.id !== id || gesture.model !== selected?.model || !writable())) cancel();
    selectedWrapper?.removeAttribute('data-canvas-editable');
    selectedWrapper = boundary.querySelector<HTMLElement>('[data-selected=true]');
    const stack = writable() && selected?.inStack;
    element('canvas-edit-hint').textContent = stack ?
      'Положение слоя задаёт стек. Изменить размер можно в инспекторе, порядок — в дереве слоёв.' : '';
    if (!selectedWrapper || !selected || stack || !writable()) {
      resizeHandle.remove();
      return;
    }
    selectedWrapper.dataset.canvasEditable = '';
    if (resizeHandle.parentElement !== selectedWrapper) selectedWrapper.append(resizeHandle);
    const tokenSized = ['width', 'height'].filter(name =>
      selected.node.properties[name]?.type === 'token');
    resizeHandle.title = tokenSized.length
      ? 'Изменить размер (отвязать токен: ' + tokenSized.join(', ') + ')'
      : 'Изменить размер';
  }

  function begin(id: string | undefined, wrapper: HTMLElement, resize: boolean): Edit | null {
    const selected = target(id);
    if (!selected || selected.inStack || !writable() || isEditPending()) return null;
    const names: Axis[] = resize ? ['width', 'height'] : ['x', 'y'];
    const initial: Edit['initial'] = {};
    for (const name of names) {
      const definition = selected.definitions[name];
      if (!definition) return null;
      const value = selected.node.properties[name] ?? definition.defaultValue;
      const resolved = value?.type === 'token'
        ? resolvePropertyToken(value, selected.model.tokens, 'Light', definition)
        : { value, error: null };
      if (resolved.error || resolved.value?.type !== (value?.type === 'token' ? 'dimension' : 'number') || !('value' in resolved.value) || typeof resolved.value.value !== 'number') return null;
      initial[name] = resolved.value.value;
    }
    return {
      ...selected, wrapper, names, initial, revision: getContext().revision, properties: {},
      style: Object.fromEntries(names.map(name => [geometryStyles[name], wrapper.style[geometryStyles[name]]]))
    };
  }

  function preview(edit: Edit, deltaX: number, deltaY: number) {
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

  function commit(edit: Edit) {
    if (!Object.keys(edit.properties).length) return;
    const accepted = editGeometry({
      nodeId: edit.node.id, expectedParentId: edit.node.parentId,
      expectedRevision: edit.revision, properties: edit.properties
    }, confirmed => { if (!confirmed) restore(edit); });
    if (!accepted) restore(edit);
  }

  function release(edit: Gesture): Gesture {
    gesture = null;
    if (viewport.hasPointerCapture(edit.pointer)) viewport.releasePointerCapture(edit.pointer);
    return edit;
  }

  function cancel() {
    if (gesture) restore(release(gesture));
  }

  viewport.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || event.altKey) return;
    const wrapper = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-visual-node]') : null;
    if (!wrapper || !boundary.contains(wrapper)) return;
    event.preventDefault();
    viewport.focus({ preventScroll: true });
    const id = wrapper.dataset.visualNode, selected = target(id);
    if (!selected || gesture) return;
    if (getContext().selection?.id !== id && selectLayer(selected.node, selected.model.orderedNodes) === false) return;
    const edit = begin(id, wrapper, event.target === resizeHandle);
    if (!edit) return;
    gesture = { ...edit, pointer: event.pointerId, x: event.clientX, y: event.clientY, scale: getScale(), moved: false };
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
    preview(gesture, dx / gesture.scale, dy / gesture.scale);
  }

  viewport.addEventListener('pointermove', track, { signal });
  viewport.addEventListener('pointerup', event => {
    track(event);
    if (gesture?.pointer === event.pointerId) commit(release(gesture));
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
      if (!gesture && !isEditPending()) element('node-delete').click();
      return;
    }
    if (!delta) return;
    event.preventDefault();
    const edit = begin(selectedWrapper.dataset.visualNode, selectedWrapper, event.shiftKey);
    if (!edit) return;
    preview(edit, ...delta);
    commit(edit);
  }, { capture: true, signal });

  return { sync, dispose() { cancel(); listeners.abort(); resizeHandle.remove(); } };
}
