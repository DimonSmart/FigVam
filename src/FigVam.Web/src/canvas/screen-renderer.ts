import { resolveTokenValue, resolvePropertyToken } from '../core/tokens/token-resolution.js';
import type { NodePropertyValue, ResolvableValue, Theme, TokenMap } from '../core/tokens/token-model';
import type { Bounds, CanvasNode, CanvasKind, LayoutBox, NodeProperties, PropertyDefinitions } from './canvas-model';

export interface RenderModel {
  screen: string; nodes: ReadonlyMap<string, CanvasNode>; boxes: ReadonlyMap<string, LayoutBox>;
  overrides: ReadonlyMap<string, NodeProperties>; kinds: ReadonlyMap<string, CanvasKind>;
  tokens: TokenMap; theme: Theme; assets: ReadonlyMap<string, unknown>;
  fontFamilies?: ReadonlyMap<string, string>;
}
interface RenderOptions {
  preview: boolean;
  report(node: CanvasNode, name: string, message: string): void;
  trigger?(id: string, event: number): void;
  getInput?(id: string, fallback: string): string;
  setInput?(id: string, value: string): void;
}
type Property = (name: string) => NodePropertyValue | null | undefined;
type Reporter = (name: string, message: string) => void;
interface RenderImage { assetId: string; surface: HTMLImageElement; report: Reporter }
function scalar(value: ResolvableValue | null | undefined): unknown {
  return value && 'value' in value ? value.value : undefined;
}
function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function isInput(element: HTMLElement): element is HTMLInputElement | HTMLTextAreaElement {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

const enumStyles: Record<'fontFallback' | 'fontWeight' | 'fontStyle' | 'textAlignment' | 'fit', Record<string, string | undefined>> = {
  fontFallback: { SansSerif: 'sans-serif', Serif: 'serif', Monospace: 'monospace' },
  fontWeight: { Normal: '400', Medium: '500', Semibold: '600', Bold: '700' },
  fontStyle: { Normal: 'normal', Italic: 'italic' },
  textAlignment: { Start: 'start', Center: 'center', End: 'end' },
  fit: { Contain: 'contain', Cover: 'cover', Stretch: 'fill' }
};

const px = (value: number) => `${value}px`;

function place(wrapper: HTMLElement, { bounds, clip }: LayoutBox, parent: Bounds) {
  Object.assign(wrapper.style, {
    left: px(bounds.x - parent.x), top: px(bounds.y - parent.y),
    width: px(bounds.width), height: px(bounds.height)
  });
  if (clip) {
    wrapper.style.clipPath = !clip.width || !clip.height ? 'polygon(0 0, 0 0, 0 0)' :
      `inset(${px(clip.y - bounds.y)} ${px(bounds.x + bounds.width - clip.x - clip.width)} ${px(bounds.y + bounds.height - clip.y - clip.height)} ${px(clip.x - bounds.x)})`;
  }
}

function color(property: ResolvableValue, tokens: TokenMap, theme: Theme) {
  const result = resolveTokenValue(property, tokens, theme, 'Color');
  const value = result.value;
  if (result.error || value?.type !== 'color') return null;
  return 'rgba(' + [value.red, value.green, value.blue, value.alpha / 255].join(', ') + ')';
}

function appearance(surface: HTMLElement, property: Property, tokens: TokenMap, theme: Theme, bounds: Bounds, report: Reporter, definitions: PropertyDefinitions, fontFamilies?: ReadonlyMap<string, string>) {
  function resolved(name: string) {
    const value = property(name);
    if (!value) return null;
    if (value.type !== 'token') return value;
    const definition = definitions[name];
    if (!definition) return null;
    const result = resolvePropertyToken(value, tokens, theme, definition);
    if (result.error) report(name, result.error);
    return result.error ? null : result.value;
  }
  const style = surface.style;
  for (const [name, key] of Object.entries({ backgroundColor: 'backgroundColor', textColor: 'color', borderColor: 'borderColor' } as const)) {
    const value = property(name);
    if (!value) continue;
    const resolved = color(value, tokens, theme);
    if (resolved) style[key] = resolved;
    else report(name, 'Не удалось разрешить цветовой токен.');
  }
  for (const [name, key] of Object.entries({ borderWidth: 'borderWidth', cornerRadius: 'borderRadius', fontSize: 'fontSize' } as const)) {
    const propertyValue = resolved(name);
    const value = propertyValue?.type === 'geometry' ? propertyValue.radius : scalar(propertyValue);
    if (finite(value)) style[key] = px(name === 'borderWidth' ? Math.min(value, bounds.width / 2, bounds.height / 2) : value);
  }
  for (const name of ['fontStyle', 'textAlignment'] as const) {
    const value = enumStyles[name][string(scalar(property(name)))];
    if (value) style[name === 'textAlignment' ? 'textAlign' : name] = value;
  }
  const weight = scalar(resolved('fontWeight'));
  const weightValue = enumStyles.fontWeight[String(weight)] ?? (finite(weight) && Number.isInteger(weight) && weight >= 1 && weight <= 1000 ? String(weight) : null);
  if (weightValue) style.fontWeight = weightValue;
  const requestedFamily = string(scalar(resolved('fontFamily')));
  const family = fontFamilies?.get(requestedFamily.toLowerCase()) ?? requestedFamily;
  const fallback = enumStyles.fontFallback[string(scalar(property('fontFallback')))];
  if (fallback) style.fontFamily = family && /^[\p{L}\p{N}][\p{L}\p{M}\p{N} _-]*$/u.test(family) ? `"${family}", ${fallback}` : fallback;
  const lineHeight = scalar(resolved('lineHeight'));
  if (finite(lineHeight)) style.lineHeight = String(lineHeight);
  const letterSpacing = scalar(resolved('letterSpacing'));
  if (finite(letterSpacing)) style.letterSpacing = px(letterSpacing);
  if (scalar(property('wrap')) === false) style.whiteSpace = 'pre';
  if (isInput(surface)) {
    for (const name of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const) {
      const value = scalar(resolved(name));
      if (finite(value)) style[name] = px(Math.min(value, name === 'paddingTop' || name === 'paddingBottom' ? bounds.height / 2 : bounds.width / 2));
    }
    for (const [name, variable] of [['placeholderColor', '--figvam-placeholder-color'], ['focusBorderColor', '--figvam-focus-color']] as const) {
      const value = property(name);
      if (!value) continue;
      const rgba = color(value, tokens, theme);
      if (rgba) style.setProperty(variable, rgba);
      else report(name, 'Не удалось разрешить цветовой токен.');
    }
    const focusWidth = scalar(resolved('focusBorderWidth'));
    if (finite(focusWidth)) style.setProperty('--figvam-focus-width', px(Math.min(focusWidth, bounds.width / 2, bounds.height / 2)));
    if (property('focusBorderColor') || property('focusBorderWidth')) surface.dataset.customFocus = 'true';
  }
}

function intersects({ bounds, clip }: LayoutBox) {
  return bounds.width > 0 && bounds.height > 0 && (!clip || (
    Math.min(bounds.x + bounds.width, clip.x + clip.width) > Math.max(bounds.x, clip.x) &&
    Math.min(bounds.y + bounds.height, clip.y + clip.height) > Math.max(bounds.y, clip.y)));
}

export function renderScreen(model: RenderModel, options: RenderOptions) {
  const { screen, nodes, boxes, overrides, kinds, tokens, theme, assets } = model;
  const root = document.createDocumentFragment();
  const elements = new Map<string, DocumentFragment | HTMLElement>([[screen, root]]);
  const images: RenderImage[] = [];
  for (const [id, node] of nodes) {
    const kind = kinds.get(node.kind);
    const box = boxes.get(id);
    const parent = elements.get(node.parentId);
    if (!kind || !box || !parent) throw new Error('Структура компонентов не соответствует рассчитанной геометрии.');
    const property: Property = name => {
      const definition = kind.properties[name];
      return definition && (overrides.get(id)?.[name] ?? node.properties[name] ?? definition.defaultValue);
    };
    const value = (name: string) => scalar(property(name));
    const role = kind.semanticRole;
    const report: Reporter = (name, message) => options.report(node, name, message);
    const wrapper = document.createElement('div');
    wrapper.className = 'visual-node';
    wrapper.dataset.visualNode = id;
    wrapper.dataset.semanticRole = role;
    // Native clipping in Design follows live bounds during a local gesture.
    const parentBox = boxes.get(node.parentId);
    if (!parentBox) throw new Error('Отсутствует геометрия родительского слоя.');
    // A node's own clip is for descendants; only the inherited clip may clip its effect.
    place(wrapper, { bounds: box.bounds, clip: options.preview ? parentBox.clip : null }, parentBox.bounds);
    if (value('visible') === false) wrapper.style.visibility = 'hidden';
    const opacityValue = property('opacity');
    const resolvedOpacity = opacityValue?.type === 'token'
      ? resolvePropertyToken(opacityValue, tokens, theme, kind.properties.opacity ?? {}) : { value: opacityValue, error: null };
    if (resolvedOpacity.error) report('opacity', resolvedOpacity.error);
    const opacity = scalar(resolvedOpacity.value);
    if (finite(opacity)) wrapper.style.opacity = String(opacity);
    // Descendants must paint together with their parent, below later siblings in tree order.
    wrapper.style.isolation = 'isolate';

    let surface: HTMLElement;
    if (role === 'Button') {
      const button = document.createElement('button');
      button.type = 'button';
      surface = button;
      surface.textContent = string(value('text'));
      if (!surface.textContent) surface.setAttribute('aria-label', node.name || 'Кнопка');
      if (options.preview && kind.previewEvents.includes(0)) surface.addEventListener('click', () => options.trigger?.(id, 0));
    } else if (role === 'TextInput') {
      const input = value('multiline') ? document.createElement('textarea') : document.createElement('input');
      surface = input;
      if (input instanceof HTMLInputElement) input.type = value('inputType') === 'Password' ? 'password' : 'text';
      input.placeholder = string(value('placeholder'));
      const fallback = string(value('value'));
      input.value = options.getInput?.(id, fallback) ?? fallback;
      const maxLength = kind.properties.value?.maxLength;
      if (finite(maxLength) && Number.isInteger(maxLength)) input.maxLength = maxLength;
      input.setAttribute('aria-label', node.name || input.placeholder || 'Поле ввода');
      if (options.preview) {
        input.addEventListener('input', () => options.setInput?.(id, input.value));
        if (kind.previewEvents.includes(1)) input.addEventListener('change', () => options.trigger?.(id, 1));
        if (input instanceof HTMLInputElement && kind.previewEvents.includes(4))
          input.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.isComposing) {
              event.preventDefault();
              options.trigger?.(id, 4);
            }
          });
      } else input.readOnly = true;
    } else if (role === 'Image') {
      const asset = property('asset');
      const assetId = asset?.type === 'asset' ? asset.assetId : undefined;
      const alt = string(value('altText'));
      surface = document.createElement('div');
      if (assetId && assets.has(assetId)) {
        const image = document.createElement('img');
        surface = image;
        image.alt = alt;
        image.draggable = false;
        image.style.objectFit = enumStyles.fit[string(value('fit'))] ?? 'fill';
        image.dataset.assetId = assetId;
        images.push({ assetId, surface: image, report });
      } else {
        surface.textContent = alt || 'Изображение недоступно';
        report('asset', 'Ассет отсутствует в документе.');
      }
    } else {
      surface = document.createElement('div');
      if (role === 'Text') surface.textContent = string(value('text'));
    }
    surface.className = 'visual-surface';
    if (options.preview && !intersects(box)) surface.inert = true;
    if (value('enabled') === false) {
      if (options.preview) {
        if (isInput(surface) || surface instanceof HTMLButtonElement) surface.disabled = true;
      } else surface.dataset.disabled = 'true';
    }
    if (!options.preview && surface.matches('input, textarea, button')) surface.tabIndex = -1;
    appearance(surface, property, tokens, theme, box.bounds, report, kind.properties, model.fontFamilies);
    const rawShadow = property('shadow');
    const shadowResult = rawShadow?.type === 'token' ? resolvePropertyToken(rawShadow, tokens, theme, kind.properties.shadow ?? {}) : { value: rawShadow, error: null };
    if (shadowResult.error) report('shadow', shadowResult.error);
    const shadow = shadowResult.value;
    if (shadow?.type === 'shadow') {
      const { offsetX, offsetY, blurRadius, spreadRadius, color: rgba } = shadow;
      if ([offsetX, offsetY, blurRadius, spreadRadius].every(Number.isFinite) && rgba) {
        wrapper.style.borderRadius = role === 'Image' ? '0px' : surface.style.borderRadius;
        wrapper.style.boxShadow = [offsetX, offsetY, blurRadius, spreadRadius].map(px).join(' ') +
          ' rgba(' + [rgba.red, rgba.green, rgba.blue, rgba.alpha / 255].join(', ') + ')';
      }
    }
    wrapper.append(surface);
    parent.append(wrapper);
    // Clip descendants on a square host, independently of the rounded shadow caster.
    const childHost = document.createElement('div');
    childHost.className = 'visual-children';
    childHost.style.overflow = value('overflow') === 'Clip' ? 'clip' : 'visible';
    if (kind.canContainChildren) wrapper.append(childHost);
    elements.set(id, kind.canContainChildren ? childHost : wrapper);
  }
  return { root, images };
}

// Patch a Design view by stable node IDs. The renderer remains the source of
// appearance and layout; only the DOM reconciliation is incremental.
export function reconcileScreen(host: HTMLElement, next: DocumentFragment) {
  const existing = new Map([...host.querySelectorAll<HTMLElement>('[data-visual-node]')]
    .map(node => [node.dataset.visualNode, node] as const));

  function attributes(current: HTMLElement, target: HTMLElement, preserve = new Set<string>()) {
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

  function update(current: HTMLElement, target: HTMLElement) {
    attributes(current, target, new Set(['data-selected', 'data-canvas-editable']));
    const before = current.querySelector<HTMLElement>(':scope > .visual-surface');
    const after = target.querySelector<HTMLElement>(':scope > .visual-surface');
    if (!before || !after || before.tagName !== after.tagName) {
      if (before && after) before.replaceWith(after);
      else if (before) before.remove();
      else if (after) current.prepend(after);
    } else {
      const assetChanged = before.dataset.assetId !== after.dataset.assetId;
      attributes(before, after, before.tagName === 'IMG' ? new Set(['src', 'data-loaded-asset']) : new Set());
      if (assetChanged && before.tagName === 'IMG') {
        before.removeAttribute('src');
        delete before.dataset.loadedAsset;
      }
      if (isInput(before) && isInput(after)) {
        if (before.value !== after.value) before.value = after.value;
      } else if (before.tagName !== 'IMG' && before.textContent !== after.textContent)
        before.textContent = after.textContent;
    }
    const beforeChildren = current.querySelector<HTMLElement>(':scope > .visual-children');
    const afterChildren = target.querySelector<HTMLElement>(':scope > .visual-children');
    if (beforeChildren && afterChildren) {
      attributes(beforeChildren, afterChildren);
      children(beforeChildren, afterChildren);
    } else if (afterChildren) current.append(afterChildren);
    else if (beforeChildren) beforeChildren.remove();
    else children(current, target);
  }

  function children(parent: HTMLElement, template: HTMLElement | DocumentFragment) {
    const wanted = [...template.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-visual-node'));
    const ids = new Set(wanted.map(child => child.dataset.visualNode));
    let nextSibling = parent.querySelector(':scope > .canvas-resize-handle');
    for (let index = wanted.length - 1; index >= 0; index--) {
      const fresh = wanted[index];
      if (!fresh) continue;
      const id = fresh.dataset.visualNode;
      let node = existing.get(id);
      if (node && node.dataset.semanticRole === fresh.dataset.semanticRole) update(node, fresh);
      else node = fresh;
      if (node.parentNode !== parent || node.nextElementSibling !== nextSibling)
        parent.insertBefore(node, nextSibling);
      nextSibling = node;
    }
    for (const child of [...parent.children]) {
      if (child instanceof HTMLElement && child.hasAttribute('data-visual-node') && !ids.has(child.dataset.visualNode)) child.remove();
    }
  }

  children(host, next);
}
