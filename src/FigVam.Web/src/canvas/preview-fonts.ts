import { requiredRecord, text, array } from '../api/decode';
import { number } from './render-model';
import { DocumentFontRegistry, type FontAssetLoader, type FontContentType, type DocumentFontStyle } from './document-font-registry';

// Both render paths resolve user-facing family names to isolated, revision-specific CSS names.
export async function loadPreviewFonts(registry: DocumentFontRegistry, documentId: string, rawFamilies: unknown, rawAssets: unknown, loader: FontAssetLoader): Promise<ReadonlyMap<string, string>> {
  const assets = new Map(array(rawAssets, item => { const a = requiredRecord(item); return [text(a.id), a] as const; }));
  const families = array(rawFamilies ?? [], item => {
    const family = requiredRecord(item);
    const faces = array(family.faces, item => {
      const face = requiredRecord(item), assetId = text(face.assetId), asset = requiredRecord(assets.get(assetId));
      const style: DocumentFontStyle | null = face.style === 0 || face.style === 'Normal' ? 'normal' : face.style === 1 || face.style === 'Italic' ? 'italic' : null;
      if (!style) throw new TypeError('Invalid font style');
      return { id: text(face.id), assetId, sha256: text(asset.sha256), contentType: text(asset.contentType) as FontContentType,
        byteLength: number(asset.byteLength), weightFrom: number(face.weightFrom), weightTo: number(face.weightTo), style };
    });
    return { id: text(family.id), name: text(family.name), faces };
  });
  registry.replace(documentId, families, loader);
  const names = new Map<string, string>();
  for (const family of families) names.set(family.name.toLowerCase(), await registry.ensure(family.id));
  return names;
}
