// Pure destination calculation uses the order after removal of the source.
export function resolveLayerDrop(source, target, zone) {
  if (!source || !target || source.item.id === target.item.id) return null;
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

export function createLayerDrag({ tree, canMove, context, stamp, resolve, expand, commit }) {
  let gesture = null, marked = null, ghost = null, frame = 0, hoverId = null, hoverSince = 0;
  let suppressClick = false;
  const labelAt = (x, y) => {
    const label = document.elementFromPoint(x, y)?.closest('.layer-label');
    return label && tree.contains(label) ? label : null;
  };
  function mark(row, kind) {
    if (marked !== row) marked?.removeAttribute('data-layer-drop');
    marked = row;
    if (row) row.dataset.layerDrop = kind;
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
    const { x, y, id } = gesture;
    ghost.style.left = (x + 10) + 'px';
    ghost.style.top = (y + 10) + 'px';
    const label = labelAt(x, y), row = label?.closest('[role=treeitem]');
    gesture.plan = null;
    if (!row) { mark(null); hoverId = null; return; }
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
    if (!valid()) { cancel(); return; }
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
    const label = event.target.closest('.layer-label');
    if (!label || !tree.contains(label)) return;
    const row = label.closest('[role=treeitem]');
    if (!context(row.dataset.id)) return;
    cancel();
    gesture = { id: row.dataset.id, pointerId: event.pointerId, stamp: stamp(),
      x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, dragging: false, plan: null, label };
  });
  window.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!valid() || !(event.buttons & 1)) { cancel(); return; }
    gesture.x = event.clientX; gesture.y = event.clientY;
    if (!gesture.dragging) {
      if (Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < 5) return;
      gesture.dragging = true;
      gesture.label.closest('[role=treeitem]').dataset.layerDragSource = '';
      tree.classList.add('layer-dragging');
      ghost = gesture.label.cloneNode(true);
      ghost.classList.add('layer-drag-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.width = gesture.label.getBoundingClientRect().width + 'px';
      tree.append(ghost);
      frame = requestAnimationFrame(tick);
    }
    event.preventDefault();
    update();
  }, { passive: false });
  window.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (gesture.dragging && valid()) {
      gesture.x = event.clientX; gesture.y = event.clientY;
      update();
      const { id, plan } = gesture;
      cancel();
      if (plan) commit(id, plan);
    } else cancel();
  });
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
  window.addEventListener('keydown', event => {
    if (gesture && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
  }, true);
  tree.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
  }, true);
  tree.addEventListener('dragstart', event => event.preventDefault());
  return { cancel };
}
