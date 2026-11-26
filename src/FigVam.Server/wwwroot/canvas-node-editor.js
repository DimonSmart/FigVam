import { resolvePropertyToken } from './token-resolution.js';

const arrows = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
};
const geometryStyles = { x: 'left', y: 'top', width: 'width', height: 'height' };

export function createCanvasNodeEditor({
  element, getContext, getModel, getScale, selectLayer, editGeometry, isEditPending
}) {
  const viewport = element('viewport'), boundary = element('screen-boundary');
  const resizeHandle = document.createElement('span');
  resizeHandle.className = 'canvas-resize-handle';
  resizeHandle.title = 'Изменить размер';
  resizeHandle.setAttribute('aria-hidden', 'true');
  let gesture = null, selectedWrapper = null;

  function target(id) {
    const model = getModel(), node = model?.nodes.get(id);
    if (!node) return null;
    const parent = model.nodes.get(node.parentId);
    const parentLayout = parent && (parent.properties.layout ??
      model.kinds.get(parent.kind)?.properties.layout?.defaultValue)?.value;
    const definitions = model.kinds.get(node.kind).properties;
    const bounds = model.boxes.get(id).bounds, parentBounds = model.boxes.get(node.parentId).bounds;
    return { model, node, bounds, parentBounds, definitions, inStack: parent && parentLayout !== 'Free' };
  }

  function writable() {
    return ['Owner', 'Editor'].includes(getContext().documentRole);
  }

  function sync() {
    const id = getContext().selection?.id, selected = target(id);
    if (gesture && (gesture.node.id !== id || gesture.model !== selected?.model || !writable())) cancel();
    selectedWrapper?.removeAttribute('data-canvas-editable');
    selectedWrapper = boundary.querySelector('[data-selected=true]');
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

  function begin(id, wrapper, resize) {
    const selected = target(id);
    if (!selected || selected.inStack || !writable() || isEditPending()) return null;
    const names = resize ? ['width', 'height'] : ['x', 'y'];
    const initial = {};
    for (const name of names) {
      const value = selected.node.properties[name] ?? selected.definitions[name]?.defaultValue;
      const resolved = value?.type === 'token'
        ? resolvePropertyToken(value, selected.model.tokens, selected.model.theme, selected.definitions[name])
        : { value };
      if (resolved.error || resolved.value?.type !== (value?.type === 'token' ? 'dimension' : 'number')) return null;
      initial[name] = resolved.value.value;
    }
    return {
      ...selected, wrapper, names, initial, revision: getContext().revision, properties: {},
      style: Object.fromEntries(names.map(name => [geometryStyles[name], wrapper.style[geometryStyles[name]]]))
    };
  }

  function preview(edit, deltaX, deltaY) {
    edit.properties = {};
    for (const [index, name] of edit.names.entries()) {
      const { minimum = -Infinity, maximum = Infinity } = edit.definitions[name];
      // Ignore subpixel noise introduced by the inverse viewport transform.
      const delta = Math.round((index ? deltaY : deltaX) * 1000) / 1000;
      const initial = edit.initial[name];
      const value = Math.max(minimum ?? -Infinity, Math.min(maximum ?? Infinity, initial + delta));
      const style = geometryStyles[name];
      if (value === initial) {
        edit.wrapper.style[style] = edit.style[style];
        continue;
      }
      edit.properties[name] = { type: 'number', value };
      const parentOrigin = name === 'x' || name === 'y' ? edit.parentBounds[name] : 0;
      edit.wrapper.style[style] = `${edit.bounds[name] - parentOrigin + value - initial}px`;
    }
  }

  function restore(edit) {
    Object.assign(edit.wrapper.style, edit.style);
  }

  function commit(edit) {
    if (!Object.keys(edit.properties).length) return;
    const accepted = editGeometry({
      nodeId: edit.node.id, expectedParentId: edit.node.parentId,
      expectedRevision: edit.revision, properties: edit.properties
    }, confirmed => { if (!confirmed) restore(edit); });
    if (!accepted) restore(edit);
  }

  function release() {
    const edit = gesture;
    gesture = null;
    if (viewport.hasPointerCapture(edit.pointer)) viewport.releasePointerCapture(edit.pointer);
    return edit;
  }

  function cancel() {
    if (gesture) restore(release());
  }

  viewport.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || event.altKey) return;
    const wrapper = event.target.closest('[data-visual-node]');
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
  }, { capture: true });

  function track(event) {
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

  viewport.addEventListener('pointermove', track);
  viewport.addEventListener('pointerup', event => {
    track(event);
    if (gesture?.pointer === event.pointerId) commit(release());
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    viewport.addEventListener(type, event => {
      if (gesture?.pointer === event.pointerId) cancel();
    });
  }
  viewport.addEventListener('wheel', event => {
    if (gesture) event.preventDefault();
  }, { capture: true, passive: false });
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
  }, { capture: true });

  return { sync };
}
