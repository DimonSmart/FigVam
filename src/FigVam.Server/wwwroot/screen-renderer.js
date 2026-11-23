import { resolveTokenValue, resolvePropertyToken } from './token-resolution.js';
const enumStyles = {
  fontFallback: { SansSerif: 'sans-serif', Serif: 'serif', Monospace: 'monospace' },
  fontWeight: { Normal: '400', Medium: '500', Semibold: '600', Bold: '700' },
  fontStyle: { Normal: 'normal', Italic: 'italic' },
  textAlignment: { Start: 'start', Center: 'center', End: 'end' },
  fit: { Contain: 'contain', Cover: 'cover', Stretch: 'fill' }
};

const px = value => `${value}px`;

function place(wrapper, { bounds, clip }, parent) {
  Object.assign(wrapper.style, {
    left: px(bounds.x - parent.x), top: px(bounds.y - parent.y),
    width: px(bounds.width), height: px(bounds.height)
  });
  if (clip) {
    wrapper.style.clipPath = !clip.width || !clip.height ? 'polygon(0 0, 0 0, 0 0)' :
      `inset(${px(clip.y - bounds.y)} ${px(bounds.x + bounds.width - clip.x - clip.width)} ${px(bounds.y + bounds.height - clip.y - clip.height)} ${px(clip.x - bounds.x)})`;
  }
}

function color(property, tokens, theme) {
  const result = resolveTokenValue(property, tokens, theme, 'Color');
  const value = result.value;
  if (result.error || value?.type !== 'color') return null;
  return 'rgba(' + [value.red, value.green, value.blue, value.alpha / 255].join(', ') + ')';
}

function appearance(surface, property, tokens, theme, bounds, report, definitions) {
  function resolved(name) {
    const value = property(name);
    if (!value) return null;
    if (value.type !== 'token') return value;
    const result = resolvePropertyToken(value, tokens, theme, definitions[name]);
    if (result.error) report(name, result.error);
    return result.error ? null : result.value;
  }
  const style = surface.style;
  for (const [name, key] of Object.entries({ backgroundColor: 'backgroundColor', textColor: 'color', borderColor: 'borderColor' })) {
    const value = property(name);
    if (!value) continue;
    const resolved = color(value, tokens, theme);
    if (resolved) style[key] = resolved;
    else report(name, 'Не удалось разрешить цветовой токен.');
  }
  for (const [name, key] of Object.entries({ borderWidth: 'borderWidth', cornerRadius: 'borderRadius', fontSize: 'fontSize' })) {
    const propertyValue = resolved(name);
    const value = propertyValue?.type === 'geometry' ? propertyValue.radius : propertyValue?.value;
    if (Number.isFinite(value)) style[key] = px(name === 'borderWidth' ? Math.min(value, bounds.width / 2, bounds.height / 2) : value);
  }
  for (const name of ['fontStyle', 'textAlignment']) {
    const value = enumStyles[name][property(name)?.value];
    if (value) style[name === 'textAlignment' ? 'textAlign' : name] = value;
  }
  const weight = resolved('fontWeight')?.value;
  const weightValue = enumStyles.fontWeight[weight] ?? (Number.isInteger(weight) && weight >= 1 && weight <= 1000 ? String(weight) : null);
  if (weightValue) style.fontWeight = weightValue;
  const family = resolved('fontFamily')?.value;
  const fallback = enumStyles.fontFallback[property('fontFallback')?.value];
  if (fallback) style.fontFamily = family && /^[\p{L}\p{N}][\p{L}\p{M}\p{N} _-]*$/u.test(family) ? `"${family}", ${fallback}` : fallback;
  const lineHeight = resolved('lineHeight')?.value;
  if (Number.isFinite(lineHeight)) style.lineHeight = String(lineHeight);
  if (property('wrap')?.value === false) style.whiteSpace = 'pre';
}

function intersects({ bounds, clip }) {
  return bounds.width > 0 && bounds.height > 0 && (!clip || (
    Math.min(bounds.x + bounds.width, clip.x + clip.width) > Math.max(bounds.x, clip.x) &&
    Math.min(bounds.y + bounds.height, clip.y + clip.height) > Math.max(bounds.y, clip.y)));
}

export function renderScreen(model, options) {
  const { screen, nodes, boxes, overrides, kinds, tokens, theme, assets } = model;
  const root = document.createDocumentFragment();
  const elements = new Map([[screen, root]]);
  const images = [];
  for (const [id, node] of nodes) {
    const kind = kinds.get(node.kind);
    const box = boxes.get(id);
    const parent = elements.get(node.parentId);
    if (!kind || !box || !parent) throw new Error('Структура компонентов не соответствует рассчитанной геометрии.');
    const property = name => {
      const definition = kind.properties[name];
      return definition && (overrides.get(id)?.[name] ?? node.properties[name] ?? definition.defaultValue);
    };
    const value = name => property(name)?.value;
    const role = kind.semanticRole;
    const report = (name, message) => options.report(node, name, message);
    const wrapper = document.createElement('div');
    wrapper.className = 'visual-node';
    wrapper.dataset.visualNode = id;
    wrapper.dataset.semanticRole = role;
    // Native clipping in Design follows live bounds during a local gesture.
    place(wrapper, options.preview ? box : { bounds: box.bounds }, boxes.get(node.parentId).bounds);
    if (!options.preview && value('overflow') === 'Clip') wrapper.style.overflow = 'clip';
    if (value('visible') === false) wrapper.style.visibility = 'hidden';
    const opacityValue = property('opacity');
    const resolvedOpacity = opacityValue?.type === 'token'
      ? resolvePropertyToken(opacityValue, tokens, theme, kind.properties.opacity) : { value: opacityValue };
    if (resolvedOpacity.error) report('opacity', resolvedOpacity.error);
    if (Number.isFinite(resolvedOpacity.value?.value)) wrapper.style.opacity = String(resolvedOpacity.value.value);
    // Descendants must paint together with their parent, below later siblings in tree order.
    wrapper.style.isolation = 'isolate';

    let surface;
    if (role === 'Button') {
      surface = document.createElement('button');
      surface.type = 'button';
      surface.textContent = value('text') ?? '';
      if (!surface.textContent) surface.setAttribute('aria-label', node.name || 'Кнопка');
      if (options.preview && kind.previewEvents.includes(0)) surface.addEventListener('click', () => options.trigger(id, 0));
    } else if (role === 'TextInput') {
      surface = document.createElement(value('multiline') ? 'textarea' : 'input');
      if (surface.tagName === 'INPUT') surface.type = value('inputType') === 'Password' ? 'password' : 'text';
      surface.placeholder = value('placeholder') ?? '';
      surface.value = options.getInput?.(id, value('value') ?? '') ?? value('value') ?? '';
      if (Number.isInteger(kind.properties.value?.maxLength)) surface.maxLength = kind.properties.value.maxLength;
      surface.setAttribute('aria-label', node.name || surface.placeholder || 'Поле ввода');
      if (options.preview) {
        surface.addEventListener('input', () => options.setInput(id, surface.value));
        if (kind.previewEvents.includes(1)) surface.addEventListener('change', () => options.trigger(id, 1));
        if (surface.tagName === 'INPUT' && kind.previewEvents.includes(4))
          surface.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.isComposing) {
              event.preventDefault();
              options.trigger(id, 4);
            }
          });
      } else surface.readOnly = true;
    } else if (role === 'Image') {
      const assetId = property('asset')?.assetId;
      const alt = value('altText') ?? '';
      surface = document.createElement('div');
      if (assetId && assets.has(assetId)) {
        surface = document.createElement('img');
        surface.alt = alt;
        surface.draggable = false;
        surface.style.objectFit = enumStyles.fit[value('fit')] ?? 'fill';
        surface.dataset.assetId = assetId;
        images.push({ assetId, surface, report });
      } else {
        surface.textContent = alt || 'Изображение недоступно';
        report('asset', 'Ассет отсутствует в документе.');
      }
    } else {
      surface = document.createElement('div');
      if (role === 'Text') surface.textContent = value('text') ?? '';
    }
    surface.className = 'visual-surface';
    if (options.preview && !intersects(box)) surface.inert = true;
    if (value('enabled') === false) {
      if (options.preview) surface.disabled = true;
      else surface.dataset.disabled = 'true';
    }
    if (!options.preview && surface.matches('input, textarea, button')) surface.tabIndex = -1;
    appearance(surface, property, tokens, theme, box.bounds, report, kind.properties);
    wrapper.append(surface);
    parent.append(wrapper);
    elements.set(id, wrapper);
  }
  return { root, images };
}

// Patch a Design view by stable node IDs. The renderer remains the source of
// appearance and layout; only the DOM reconciliation is incremental.
export function reconcileScreen(host, next) {
  const existing = new Map([...host.querySelectorAll('[data-visual-node]')]
    .map(node => [node.dataset.visualNode, node]));

  function attributes(current, target, preserve = new Set()) {
    // CSP permits individual CSSOM changes, but rejects setAttribute('style', ...).
    // A remote document revision must update the existing wrapper's geometry.
    for (const attribute of [...current.attributes]) {
      if (attribute.name === 'style') continue;
      if (!preserve.has(attribute.name) && !target.hasAttribute(attribute.name))
        current.removeAttribute(attribute.name);
    }
    for (const attribute of target.attributes) {
      if (attribute.name === 'style') continue;
      if (!preserve.has(attribute.name) && current.getAttribute(attribute.name) !== attribute.value)
        current.setAttribute(attribute.name, attribute.value);
    }
    for (const property of [...current.style]) {
      if (!target.style.getPropertyValue(property)) current.style.removeProperty(property);
    }
    for (const property of target.style) {
      const value = target.style.getPropertyValue(property);
      const priority = target.style.getPropertyPriority(property);
      if (current.style.getPropertyValue(property) !== value ||
          current.style.getPropertyPriority(property) !== priority)
        current.style.setProperty(property, value, priority);
    }
  }

  function update(current, target) {
    attributes(current, target, new Set(['data-selected', 'data-canvas-editable']));
    const before = current.querySelector(':scope > .visual-surface');
    const after = target.querySelector(':scope > .visual-surface');
    if (!before || !after || before.tagName !== after.tagName) {
      before?.replaceWith(after);
    } else {
      const assetChanged = before.dataset.assetId !== after.dataset.assetId;
      attributes(before, after, before.tagName === 'IMG' ? new Set(['src', 'data-loaded-asset']) : new Set());
      if (assetChanged && before.tagName === 'IMG') {
        before.removeAttribute('src');
        delete before.dataset.loadedAsset;
      }
      if (before.matches('input, textarea')) {
        if (before.value !== after.value) before.value = after.value;
      } else if (before.tagName !== 'IMG' && before.textContent !== after.textContent)
        before.textContent = after.textContent;
    }
    children(current, target);
  }

  function children(parent, template) {
    const wanted = [...template.children].filter(child => child.hasAttribute('data-visual-node'));
    const ids = new Set(wanted.map(child => child.dataset.visualNode));
    let nextSibling = parent.querySelector(':scope > .canvas-resize-handle');
    for (let index = wanted.length - 1; index >= 0; index--) {
      const fresh = wanted[index], id = fresh.dataset.visualNode;
      let node = existing.get(id);
      if (node && node.dataset.semanticRole === fresh.dataset.semanticRole) update(node, fresh);
      else node = fresh;
      if (node.parentNode !== parent || node.nextElementSibling !== nextSibling)
        parent.insertBefore(node, nextSibling);
      nextSibling = node;
    }
    for (const child of [...parent.children]) {
      if (child.hasAttribute('data-visual-node') && !ids.has(child.dataset.visualNode)) child.remove();
    }
  }

  children(host, next);
}
