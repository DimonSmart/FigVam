export type DocumentFontStyle = 'normal' | 'italic';
export type FontContentType = 'font/woff2' | 'font/woff' | 'font/ttf' | 'font/otf';

export interface DocumentFontFace {
  id: string;
  assetId: string;
  sha256: string;
  contentType: FontContentType;
  byteLength: number;
  weightFrom: number;
  weightTo: number;
  style: DocumentFontStyle;
}

export interface DocumentFontFamily {
  id: string;
  faces: readonly DocumentFontFace[];
}

export type FontAssetLoader = (face: DocumentFontFace, signal: AbortSignal) => Promise<ArrayBuffer>;
type FaceFactory = (family: string, bytes: ArrayBuffer, descriptors: FontFaceDescriptors) => FontFace;
type FontSet = Pick<FontFaceSet, 'add' | 'delete'>;

interface LoadedFace {
  face: FontFace;
  bytes: ArrayBuffer;
  descriptor: DocumentFontFace;
}

interface Entry {
  cssName: string;
  key: string;
  family: DocumentFontFamily;
  abort: AbortController;
  loaded: LoadedFace[];
  pending?: Promise<string>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
const formats = new Set<string>(['font/woff2', 'font/woff', 'font/ttf', 'font/otf']);
const cancelled = () => new DOMException('Font load cancelled', 'AbortError');

function id(value: string): string {
  if (!uuid.test(value) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)) throw new TypeError('Invalid font identifier');
  return value.toLowerCase();
}

function validate(face: DocumentFontFace): void {
  id(face.id); id(face.assetId);
  if (!hash.test(face.sha256) || !formats.has(face.contentType) ||
      !Number.isInteger(face.byteLength) || face.byteLength < 1 || face.byteLength > 5 * 1024 * 1024 ||
      !Number.isInteger(face.weightFrom) || !Number.isInteger(face.weightTo) ||
      face.weightFrom < 1 || face.weightTo > 1000 || face.weightFrom > face.weightTo ||
      (face.style !== 'normal' && face.style !== 'italic')) throw new TypeError('Invalid font face');
}

const weight = (face: DocumentFontFace) => face.weightFrom === face.weightTo
  ? String(face.weightFrom) : face.weightFrom + ' ' + face.weightTo;

// Only validated ASCII values are used to construct the internal CSS identifier.
// The complete composition (rather than a non-cryptographic hash) makes historical
// revisions with reused identifiers but different bytes distinct.
function identity(documentId: string, family: DocumentFontFamily): { key: string; cssName: string } {
  const faces = [...family.faces].sort((a, b) => a.id.localeCompare(b.id));
  const composition = faces.map(face => {
    validate(face);
    return [id(face.id), id(face.assetId), face.sha256, face.weightFrom, face.weightTo, face.style].join('-');
  }).join('--');
  const key = id(documentId) + '-' + id(family.id) + '--' + composition;
  return { key, cssName: 'figvam-font-' + key };
}

function base64(bytes: ArrayBuffer): string {
  const data = new Uint8Array(bytes);
  let binary = '';
  for (let offset = 0; offset < data.length; offset += 8192)
    binary += String.fromCharCode(...data.subarray(offset, offset + 8192));
  return btoa(binary);
}

// One registry owns one rendering context. An editor can keep it across revisions;
// capture can create an isolated, revision-pinned instance and dispose it in finally.
export class DocumentFontRegistry {
  private entries = new Map<string, Entry>();
  private loader: FontAssetLoader;

  constructor(
    loader: FontAssetLoader,
    private readonly fonts: FontSet = document.fonts,
    private readonly createFace: FaceFactory = (name, bytes, descriptors) => new FontFace(name, bytes, descriptors),
  ) {
    this.loader = loader;
  }

  replace(documentId: string, families: readonly DocumentFontFamily[], loader = this.loader): void {
    id(documentId);
    if (families.length > 64) throw new TypeError('Too many font families');
    let count = 0, bytes = 0;
    const seen = new Set<string>();
    const next = new Map<string, Entry>();
    for (const family of families) {
      const familyId = id(family.id);
      if (!family.faces.length || next.has(familyId)) throw new TypeError('Invalid font family');
      const snapshot = { id: familyId, faces: family.faces.map(face => ({ ...face })) };
      const { key, cssName } = identity(documentId, snapshot);
      for (const face of snapshot.faces) {
        bytes += face.byteLength;
        if (++count > 128 || bytes > 32 * 1024 * 1024 || seen.has(id(face.id)) || seen.has(id(face.assetId)))
          throw new TypeError('Invalid font manifest');
        seen.add(id(face.id)); seen.add(id(face.assetId));
      }
      const previous = this.entries.get(familyId);
      next.set(familyId, previous?.key === key ? previous :
        { cssName, key, family: snapshot, abort: new AbortController(), loaded: [] });
    }
    for (const [familyId, entry] of this.entries)
      if (next.get(familyId) !== entry) this.release(entry);
    this.loader = loader;
    this.entries = next;
  }

  cssName(familyId: string): string | undefined {
    return this.entries.get(id(familyId))?.cssName;
  }

  ensure(familyId: string): Promise<string> {
    const entry = this.entries.get(id(familyId));
    if (!entry) return Promise.reject(new Error('Document font family not found'));
    if (entry.pending) return entry.pending;
    const loader = this.loader;
    const promise = this.load(entry, loader);
    entry.pending = promise;
    void promise.catch(() => {
      if (entry.pending === promise) entry.pending = undefined;
    });
    return promise;
  }

  private async load(entry: Entry, loader: FontAssetLoader): Promise<string> {
    const signal = entry.abort.signal;
    const faces: LoadedFace[] = [];
    try {
      // Sequential fetches bound peak decode memory and avoid leaving other
      // registration operations running after a single face fails.
      for (const descriptor of entry.family.faces) {
        if (signal.aborted) throw cancelled();
        const bytes = await loader(descriptor, signal);
        if (signal.aborted) throw cancelled();
        if (bytes.byteLength !== descriptor.byteLength) throw new Error('Font content length mismatch');
        const face = this.createFace(entry.cssName, bytes, { weight: weight(descriptor), style: descriptor.style });
        await face.load();
        if (signal.aborted) throw cancelled();
        faces.push({ face, bytes, descriptor });
      }
      // A family is published atomically only after all faces loaded.
      for (const loaded of faces) {
        this.fonts.add(loaded.face);
        entry.loaded.push(loaded);
      }
      return entry.cssName;
    } catch (error) {
      for (const loaded of entry.loaded) this.fonts.delete(loaded.face);
      entry.loaded = [];
      throw error;
    }
  }

  // Self-contained rules for SVG foreignObject. Call only for families used by
  // the surface; errors propagate rather than silently producing fallback PNG.
  async embeddedCss(familyIds: Iterable<string>): Promise<string> {
    const rules: string[] = [];
    for (const familyId of new Set(Array.from(familyIds, id))) {
      const entry = this.entries.get(familyId);
      if (!entry) throw new Error('Document font family not found');
      await this.ensure(familyId);
      if (this.entries.get(familyId) !== entry || entry.abort.signal.aborted) throw cancelled();
      for (const { bytes, descriptor } of entry.loaded)
        rules.push('@font-face{font-family:' + entry.cssName + ';src:url(data:' +
          descriptor.contentType + ';base64,' + base64(bytes) + ');font-weight:' +
          weight(descriptor) + ';font-style:' + descriptor.style + ';}');
    }
    return rules.join('\n');
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
  }

  private release(entry: Entry): void {
    entry.abort.abort();
    for (const loaded of entry.loaded) this.fonts.delete(loaded.face);
    entry.loaded = [];
  }
}
