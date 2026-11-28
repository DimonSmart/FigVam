import { renderScreen } from './screen-renderer';
import { previewSurface } from './preview-surface';
import { readRenderModel } from './render-model';
import { requiredRecord, text, array } from '../api/decode';

const status = document.documentElement.dataset;
status.renderStatus = 'loading';
try {
  const node = document.getElementById('snapshot');
  const host = document.getElementById('render-root');
  if (!node?.textContent || !host) throw new Error('Missing render snapshot');
  const snapshot = requiredRecord(JSON.parse(node.textContent));
  node.remove();
  const data = requiredRecord(snapshot.assetData), values = requiredRecord(snapshot.values);
  const surfaces = array(snapshot.surfaces, requiredRecord);
  const images: Promise<void>[] = [];
  for (const [index, surface] of surfaces.entries()) {
    const model = readRenderModel({ ...surface, assets: snapshot.assets, tokens: snapshot.tokens, kinds: snapshot.kinds });
    const drawing = renderScreen(model, {
      preview: true, report() {},
      getInput: (id, fallback) => Object.hasOwn(values, id) ? (values[id] == null ? '' : text(values[id])) : fallback
    });
    host.append(previewSurface(model, drawing.root, index === surfaces.length - 1));
    for (const { assetId, surface } of drawing.images) {
      const asset = requiredRecord(model.assets.get(assetId));
      const bytes = Uint8Array.from(atob(text(data[assetId])), c => c.charCodeAt(0));
      surface.src = URL.createObjectURL(new Blob([bytes], { type: text(asset.contentType) }));
      images.push(surface.decode());
    }
  }
  await Promise.all(images);
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  status.renderStatus = 'ready';
} catch {
  // A fixed diagnostic code is safe to return; do not expose document values.
  status.renderStatus = 'failed';
}
