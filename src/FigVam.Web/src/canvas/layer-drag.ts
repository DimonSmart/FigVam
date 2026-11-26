export type DropZone = 'before' | 'after' | 'inside';
export interface LayerContext {
  parent: string;
  index: number;
  count: number;
  ancestors: string[];
  item: { id: string; canContainChildren?: boolean; childCount: number };
}
export interface LayerDropPlan {
  expectedParentId: string;
  targetParentId: string;
  position: number;
  reveal: string[];
}
interface LayerDragOptions {
  tree: HTMLElement;
  canMove(): boolean;
  context(id: string): LayerContext | null;
  stamp(): string;
  resolve(source: string, target: string, zone: DropZone): LayerDropPlan | null;
  expand(id: string): void;
  commit(id: string, plan: LayerDropPlan): void;
}
interface Gesture {
  id: string; pointerId: number; stamp: string;
  x: number; y: number; startX: number; startY: number;
  dragging: boolean; plan: LayerDropPlan | null; label: HTMLElement;
}
// Pure destination calculation uses the order after removal of the source.
export function resolveLayerDrop(source: LayerContext | null, target: LayerContext | null, zone: DropZone): LayerDropPlan | null {
  if (!source || !target || source.item.id === target.item.id || !['before', 'after', 'inside'].includes(zone)) return null;
  const inside = zone === 'inside';
  if (inside && target.item.canContainChildren !== true) return null;
  const targetParentId = inside ? target.item.id : target.parent;
  const reveal = inside ? [...target.ancestors, target.item.id] : target.ancestors;
  if (reveal.includes(source.item.id)) return null;
  let position = inside ? target.item.childCount : target.index + (zone === 'after' ? 1 : 0);
  if (source.parent === targetParentId && source.index < position) position--;
  if (source.parent === targetParentId && position === source.index) return null;
  return { expectedParentId: source.parent, targetParentId, position, reveal };
}

export function createLayerDrag({ tree, canMove, context, stamp, resolve, expand, commit }: LayerDragOptions) {
  let gesture: Gesture | null = null, marked: HTMLElement | null = null, ghost: HTMLElement | null = null;
  let frame = 0, hoverId: string | null = null, hoverSince = 0;
  const listeners = new AbortController();
  const signal = listeners.signal;
  let suppressClick = false;
  const labelAt = (x: number, y: number) => {
    const label = document.elementFromPoint(x, y)?.closest<HTMLElement>('.layer-label');
    return label && tree.contains(label) ? label : null;
  };
  function mark(row: HTMLElement | null, kind?: DropZone | 'invalid') {
    if (marked !== row) marked?.removeAttribute('data-layer-drop');
    marked = row;
    if (row && kind) row.dataset.layerDrop = kind;
  }
  function cancel() {
    if (!gesture) return;
    const wasDragging = gesture.dragging;
    gesture = null;
    cancelAnimationFrame(frame); frame = 0;
    mark(null);
    ghost?.remove(); ghost = null;
    tree.querySelectorAll('[data-layer-drag-source]').forEach(row => row.removeAttribute('data-layer-drag-source'));
    tree.classList.remove('layer-dragging');
    hoverId = null;
    if (wasDragging) {
      suppressClick = true;

    }
  }
  function valid() { return gesture && canMove() && stamp() === gesture.stamp; }
  function update() {
    if (!gesture || !ghost) return;
    const { x, y, id } = gesture;
    ghost.style.left = (x + 10) + 'px';
    ghost.style.top = (y + 10) + 'px';
    const label = labelAt(x, y), row = label?.closest<HTMLElement>('[role=treeitem]');
    gesture.plan = null;
    if (!row || !label || !row.dataset.id) { mark(null); hoverId = null; return; }
    const target = context(row.dataset.id);
    if (!target) { mark(row, 'invalid'); hoverId = null; return; }
    const rect = label.getBoundingClientRect(), ratio = (y - rect.top) / rect.height;
    const container = target.item.canContainChildren === true;
    const zone = container ? (ratio < .25 ? 'before' : ratio > .75 ? 'after' : 'inside') : (ratio < .5 ? 'before' : 'after');
    const plan = resolve(id, row.dataset.id, zone);
    gesture.plan = plan;
    mark(row, plan ? zone : 'invalid');
    const candidate = plan && zone === 'inside' && row.getAttribute('aria-expanded') === 'false' ? row.dataset.id : null;
    if (candidate !== hoverId) { hoverId = candidate; hoverSince = performance.now(); }
    if (hoverId && performance.now() - hoverSince >= 600) {
      const id = hoverId; hoverId = null; expand(id);
    }
  }
  function tick() {
    if (!gesture || !valid()) { cancel(); return; }
    const scroll = tree.closest('.layer-tree-group') || tree;
    const bounds = scroll.getBoundingClientRect(), { x, y } = gesture;
    if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
      const edge = 32;
      const delta = y < bounds.top + edge ? -Math.ceil((bounds.top + edge - y) / 3) :
        y > bounds.bottom - edge ? Math.ceil((y - bounds.bottom + edge) / 3) : 0;
      if (delta) scroll.scrollTop += delta;
    }
    update();
    frame = requestAnimationFrame(tick);
  }
  tree.addEventListener('pointerdown', event => {
    suppressClick = false;
    if (event.button !== 0 || !event.isPrimary || event.pointerType === 'touch' || !canMove()) return;
    const label = event.target instanceof Element ? event.target.closest<HTMLElement>('.layer-label') : null;
    if (!label || !tree.contains(label)) return;
    const row = label.closest<HTMLElement>('[role=treeitem]');
    if (!row?.dataset.id || !context(row.dataset.id)) return;
    cancel();
    gesture = { id: row.dataset.id, pointerId: event.pointerId, stamp: stamp(),
      x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, dragging: false, plan: null, label };
  }, { signal });
  window.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!valid() || !(event.buttons & 1)) { cancel(); return; }
    gesture.x = event.clientX; gesture.y = event.clientY;
    if (!gesture.dragging) {
      if (Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < 5) return;
      gesture.dragging = true;
      const source = gesture.label.closest<HTMLElement>('[role=treeitem]');
      if (!source) { cancel(); return; }
      source.dataset.layerDragSource = '';
      tree.classList.add('layer-dragging');
      const clone = gesture.label.cloneNode(true);
      if (!(clone instanceof HTMLElement)) { cancel(); return; }
      ghost = clone;
      ghost.classList.add('layer-drag-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.width = gesture.label.getBoundingClientRect().width + 'px';
      tree.append(ghost);
      frame = requestAnimationFrame(tick);
    }
    event.preventDefault();
    update();
  }, { passive: false, signal });
  window.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (gesture.dragging && valid()) {
      gesture.x = event.clientX; gesture.y = event.clientY;
      update();
      const { id, plan } = gesture;
      cancel();
      if (plan) commit(id, plan);
    } else cancel();
  }, { signal });
  window.addEventListener('pointercancel', cancel, { signal });
  window.addEventListener('blur', cancel, { signal });
  window.addEventListener('keydown', event => {
    if (gesture && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
  }, { capture: true, signal });
  tree.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
  }, { capture: true, signal });
  tree.addEventListener('dragstart', event => event.preventDefault(), { signal });
  return { cancel, dispose() { cancel(); listeners.abort(); } };
}
