import { DocumentFontRegistry } from './document-font-registry';
import { loadPreviewFonts } from './preview-fonts';
import { renderScreen } from './screen-renderer';
import { previewSurface } from './preview-surface';
import { readRenderModel } from './render-model';
import { requiredRecord, text, array } from '../api/decode';

const status = document.documentElement.dataset;
status.renderStatus = 'loading';
let phase = 'SNAPSHOT';
try {
  const node = document.getElementById('snapshot');
  const host = document.getElementById('preview-viewport');
  if (!node?.textContent || !host) throw new Error('Missing render snapshot');
  const snapshot = requiredRecord(JSON.parse(node.textContent));
  node.remove();
  const data = requiredRecord(snapshot.assetData), values = requiredRecord(snapshot.values);
  const surfaces = array(snapshot.surfaces, requiredRecord);
  const images: Promise<void>[] = [];
  phase = 'FONTS';
  const fonts = new DocumentFontRegistry(async () => { throw new Error('No font asset loader'); });
  const fontFamilies = await loadPreviewFonts(fonts, text(snapshot.documentId), snapshot.fonts, snapshot.assets, async face =>
    Uint8Array.from(atob(text(data[face.assetId])), c => c.charCodeAt(0)).buffer);
  phase = 'DOM';
  for (const [index, surface] of surfaces.entries()) {
    const model = readRenderModel({ ...surface, assets: snapshot.assets, tokens: snapshot.tokens, kinds: snapshot.kinds });
    const drawing = renderScreen({ ...model, fontFamilies }, {
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
  phase = 'IMAGES';
  await Promise.all(images);
  phase = 'FONTS';
  await document.fonts.ready;
  phase = 'LAYOUT';
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  status.renderStatus = 'ready';
} catch {
  // A fixed diagnostic code is safe to return; do not expose document values.
  status.renderError = phase;
  status.renderStatus = 'failed';
}
