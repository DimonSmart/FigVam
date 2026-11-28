import type { RenderModel } from './screen-renderer';

// Preview and screenshot use the same stacking, dimensions and clipping semantics.
export function previewSurface(model: Pick<RenderModel, 'screen' | 'boxes'>, root: DocumentFragment, interactive: boolean): HTMLElement {
  const bounds = model.boxes.get(model.screen)?.bounds;
  if (!bounds) throw new Error('Missing preview geometry');
  const surface = document.createElement('div');
  surface.className = 'preview-screen';
  surface.dataset.previewScreen = model.screen;
  surface.style.width = `${bounds.width}px`;
  surface.style.height = `${bounds.height}px`;
  surface.inert = !interactive;
  surface.append(root);
  return surface;
}
