import { describe, expect, it, vi } from 'vitest';
import { DocumentFontRegistry, type DocumentFontFace, type DocumentFontFamily } from '../src/canvas/document-font-registry';

const doc = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const familyId = '20000000-0000-0000-0000-000000000001';
const descriptor: DocumentFontFace = {
  id: '30000000-0000-0000-0000-000000000001', assetId: '40000000-0000-0000-0000-000000000001',
  sha256: 'a'.repeat(64), contentType: 'font/woff2', byteLength: 3, weightFrom: 100, weightTo: 900, style: 'normal',
};
const family: DocumentFontFamily = { id: familyId, faces: [descriptor] };
const bytes = () => new Uint8Array([1, 2, 3]).buffer;

function harness(loader = vi.fn(async () => bytes())) {
  const add = vi.fn(), remove = vi.fn();
  const create = vi.fn(() => ({ load: async () => {} } as unknown as FontFace));
  const registry = new DocumentFontRegistry(loader, { add, delete: remove }, create);
  registry.replace(doc, [family]);
  return { registry, loader, add, remove, create };
}

describe('document font registry', () => {
  it('deduplicates concurrent loads and preserves unchanged families', async () => {
    const { registry, loader, add, create, remove } = harness();
    const [a, b] = await Promise.all([registry.ensure(familyId), registry.ensure(familyId)]);
    expect(a).toBe(b);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(a, expect.any(ArrayBuffer), { weight: '100 900', style: 'normal' });
    expect(add).toHaveBeenCalledTimes(1);
    registry.replace(doc, [family]);
    expect(await registry.ensure(familyId)).toBe(a);
    expect(loader).toHaveBeenCalledTimes(1);
    registry.dispose();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('isolates documents and different historical compositions', async () => {
    const { registry, remove } = harness();
    const first = await registry.ensure(familyId);
    registry.replace(other, [family]);
    const second = await registry.ensure(familyId);
    registry.replace(other, [{ ...family, faces: [{ ...descriptor, sha256: 'b'.repeat(64) }] }]);
    expect(registry.cssName(familyId)).not.toBe(second);
    expect(second).not.toBe(first);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('embeds data only for requested registered families', async () => {
    const { registry, loader } = harness();
    expect(await registry.embeddedCss([])).toBe('');
    expect(loader).not.toHaveBeenCalled();
    const css = await registry.embeddedCss([familyId, familyId]);
    expect(css).toContain('src:url(data:font/woff2;base64,AQID)');
    expect(css).toContain('font-weight:100 900');
    expect(css).toContain('font-style:normal');
    expect(css.match(/@font-face/g)).toHaveLength(1);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('does not register a stale result after switching documents', async () => {
    let complete!: (value: ArrayBuffer) => void;
    const loader = vi.fn(() => new Promise<ArrayBuffer>(resolve => { complete = resolve; }));
    const { registry, add } = harness(loader);
    const pending = registry.ensure(familyId);
    registry.replace(other, []);
    complete(bytes());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(add).not.toHaveBeenCalled();
  });

  it('propagates failed capture loads and permits retry', async () => {
    const loader = vi.fn(async () => bytes()).mockRejectedValueOnce(new Error('unavailable'));
    const { registry, add } = harness(loader);
    await expect(registry.embeddedCss([familyId])).rejects.toThrow('unavailable');
    expect(add).not.toHaveBeenCalled();
    await expect(registry.ensure(familyId)).resolves.toMatch(/^figvam-font-/);
    expect(add).toHaveBeenCalledTimes(1);
  });
});
