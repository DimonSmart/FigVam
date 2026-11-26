import type { ApiClient } from './api-client';
import { parseDocumentList } from './document-list';
import { array, requiredRecord, text } from './decode';
import type { components } from './schema.generated';

type WireItem = components['schemas']['StructureItem'];
type WireResponse = components['schemas']['StructureResponse'];
export type PageItem = Pick<WireItem, 'id' | 'type'> & { name: string; childCount: number };
export type ScreenItem = Pick<WireItem, 'id' | 'type' | 'name'> & { dimensions: { width: number; height: number } };
type Structure<T> = Pick<WireResponse, 'documentId'> & { items: T[]; total: number; revision: number };
type Current = () => boolean;
const alwaysCurrent = () => true;

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError('Некорректный ответ сервера.');
  return value;
}
function dimension(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new TypeError('Некорректный размер экрана.');
  return value;
}
function item(value: unknown, kind: string) {
  const obj = requiredRecord(value);
  if (obj.type !== kind) throw new TypeError('Некорректный тип объекта.');
  return { obj, id: text(obj.id), type: kind };
}
function decodePage(value: unknown): PageItem {
  const { obj, id, type } = item(value, 'page');
  return { id, type, name: text(obj.name), childCount: integer(obj.childCount) };
}
function decodeScreen(value: unknown): ScreenItem {
  const { obj, id, type } = item(value, 'screen');
  const dimensions = requiredRecord(obj.dimensions);
  return { id, type, ...(obj.name === undefined ? {} : { name: obj.name === null ? null : text(obj.name) }),
    dimensions: { width: dimension(dimensions.width), height: dimension(dimensions.height) } };
}
function decodeStructure<T>(value: unknown, decode: (item: unknown) => T): Structure<T> {
  const obj = requiredRecord(value);
  return { documentId: text(obj.documentId), revision: integer(obj.revision), total: integer(obj.total),
    items: array(obj.items, decode) };
}
export function createDocumentQueries(request: ApiClient) {
  const base = (id: string) => '/api/v1/documents/' + encodeURIComponent(id);
  // All pages in a result must be from one immutable server revision.
  async function readAll<T>(url: string, fields: string, decode: (item: unknown) => T,
    signal: AbortSignal, valid: Current, pinnedRevision: number | null): Promise<{items: T[]; total: number; revision: number} | null> {
    const items: T[] = [];
    let revision = pinnedRevision, total = 0;
    do {
      if (signal.aborted || !valid()) return null;
      const query = new URLSearchParams({ offset: String(items.length), limit: '100', fields });
      if (revision !== null) query.set('revision', String(revision));
      const response = await request(url + '?' + query, {}, signal, valid);
      if (signal.aborted || !valid()) return null;
      const result = decodeStructure(response, decode);
      if (revision !== null && result.revision !== revision)
        throw new Error('Ревизия документа изменилась во время загрузки дерева.');
      revision = result.revision;
      total = result.total;
      if (!result.items.length && items.length < total) throw new Error('Не удалось загрузить полный список.');
      items.push(...result.items);
      if (items.length > total) throw new TypeError('Некорректный размер списка.');
    } while (items.length < total);
    return { items, total, revision };
  }

  async function findRole(id: string, signal?: AbortSignal): Promise<string | null> {
    let cursor: string | null | undefined = null;
    do {
      const query = new URLSearchParams({ limit: '100' });
      if (cursor) query.set('cursor', cursor);
      const result = parseDocumentList(await request('/api/v1/documents?' + query, {}, signal));
      const match = result.items.find(entry => entry.documentId.toLowerCase() === id.toLowerCase());
      if (match) return match.role;
      cursor = result.nextCursor;
    } while (cursor);
    return null;
  }

  async function readName(id: string, signal: AbortSignal, revision: number | null = null, valid: Current = alwaysCurrent): Promise<string> {
    const query = new URLSearchParams({ fields: 'name' });
    if (revision !== null) query.set('revision', String(revision));
    const result = decodeStructure(await request(base(id) + '?' + query, {}, signal, valid), value => {
      const { obj } = item(value, 'document');
      return text(obj.name);
    });
    if (revision !== null && result.revision !== revision) throw new Error('Ревизия документа изменилась.');
    const name = result.items[0];
    if (name === undefined) throw new TypeError('Имя документа отсутствует.');
    return name;
  }

  return {
    findRole,
    readName,
    readPages: (id: string, signal: AbortSignal, valid: Current = alwaysCurrent, revision: number | null = null) =>
      readAll(base(id) + '/pages', 'name,childCount', decodePage, signal, valid, revision),
    readScreens: (id: string, page: string, signal: AbortSignal, valid: Current = alwaysCurrent, revision: number | null = null) =>
      readAll(base(id) + '/pages/' + encodeURIComponent(page) + '/screens', 'dimensions,name', decodeScreen, signal, valid, revision),
  };
}
