import type { components } from './schema.generated';

/** Decode the actual JSON response; OpenAPI's number|string also describes accepted request representations. */
type WireDocumentListItem = components['schemas']['DocumentListItem'];
type WireDocumentListResponse = components['schemas']['DocumentListResponse'];

export type DocumentListItem = Pick<WireDocumentListItem, 'documentId' | 'name' | 'role'> & {
  storageSchemaVersion: number | null;
  profileId: string | null;
  profileVersion: number | null;
  currentProfileVersion: number | null;
  revision: number | null;
  compatibilityIssue: string | null;
};

export type DocumentListResponse = Pick<WireDocumentListResponse, 'nextCursor'> & {
  items: DocumentListItem[];
};

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('Некорректный ответ списка документов');
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Некорректный ответ списка документов');
  return value;
}

function optionalString(value: unknown): string | null {
  return value == null ? null : string(value);
}

function optionalNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError('Некорректный ответ списка документов');
  return value;
}

export function parseDocumentList(value: unknown): DocumentListResponse {
  const response = record(value);
  if (!Array.isArray(response.items)) throw new TypeError('Некорректный ответ списка документов');
  return {
    items: response.items.map((value: unknown) => {
      const item = record(value);
      return {
        documentId: string(item.documentId), name: string(item.name), role: string(item.role),
        storageSchemaVersion: optionalNumber(item.storageSchemaVersion),
        profileId: optionalString(item.profileId), profileVersion: optionalNumber(item.profileVersion),
        currentProfileVersion: optionalNumber(item.currentProfileVersion), revision: optionalNumber(item.revision),
        compatibilityIssue: optionalString(item.compatibilityIssue),
      };
    }),
    nextCursor: optionalString(response.nextCursor),
  };
}
