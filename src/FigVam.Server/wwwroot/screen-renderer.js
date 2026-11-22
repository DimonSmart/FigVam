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
  const visited = new Set();
  while (property?.type === 'token') {
    const id = property.tokenId;
    if (visited.has(id)) return null;
    visited.add(id);
    const expression = tokens.get(id)?.values?.[theme];
    property = expression?.expression === 'alias' ? { type: 'token', tokenId: expression.tokenId } : expression?.value;
  }
  if (property?.type !== 'color') return null;
  const channels = [property.red, property.green, property.blue, property.alpha];
  if (!channels.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) return null;
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${channels[3] / 255})`;
}

function appearance(surface, property, tokens, theme, bounds, report) {
  const style = surface.style;
  for (const [name, key] of Object.entries({ backgroundColor: 'backgroundColor', textColor: 'color', borderColor: 'borderColor' })) {
    const value = property(name);
    if (!value) continue;
    const resolved = color(value, tokens, theme);
    if (resolved) style[key] = resolved;
    else report(name, 'Не удалось разрешить цветовой токен.');
  }
  for (const [name, key] of Object.entries({ borderWidth: 'borderWidth', cornerRadius: 'borderRadius', fontSize: 'fontSize' })) {
    const value = property(name)?.value;
    if (Number.isFinite(value)) style[key] = px(name === 'borderWidth' ? Math.min(value, bounds.width / 2, bounds.height / 2) : value);
  }
  for (const name of ['fontWeight', 'fontStyle', 'textAlignment']) {
    const value = enumStyles[name][property(name)?.value];
    if (value) style[name === 'textAlignment' ? 'textAlign' : name] = value;
  }
  const family = property('fontFamily')?.value;
  const fallback = enumStyles.fontFallback[property('fontFallback')?.value];
  if (fallback) style.fontFamily = family && /^[\p{L}\p{N}][\p{L}\p{M}\p{N} _-]*$/u.test(family) ? `"${family}", ${fallback}` : fallback;
  const lineHeight = property('lineHeight')?.value;
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
    if (Number.isFinite(value('opacity'))) wrapper.style.opacity = String(value('opacity'));
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
      if (surface.tagName === 'INPUT') surface.type = 'text';
      surface.placeholder = value('placeholder') ?? '';
      surface.value = options.getInput?.(id, value('value') ?? '') ?? value('value') ?? '';
      if (Number.isInteger(kind.properties.value?.maxLength)) surface.maxLength = kind.properties.value.maxLength;
      surface.setAttribute('aria-label', node.name || surface.placeholder || 'Поле ввода');
      if (options.preview) {
        surface.addEventListener('input', () => options.setInput(id, surface.value));
        if (kind.previewEvents.includes(1)) surface.addEventListener('change', () => options.trigger(id, 1));
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
    appearance(surface, property, tokens, theme, box.bounds, report);
    wrapper.append(surface);
    parent.append(wrapper);
    elements.set(id, wrapper);
  }
  return { root, images };
}
