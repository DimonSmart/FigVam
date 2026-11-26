import type { ApiClient } from '../api/api-client';
import type { components } from '../api/schema.generated';

type Schema = components['schemas'];
export interface PageCommandData {
  'add-page': Omit<Schema['AddPageRequest'], 'commandId'>;
  'rename-page': Omit<Schema['RenamePageRequest'], 'commandId'>;
  'delete-page': Omit<Schema['DeletePageRequest'], 'commandId'>;
  'add-screen': Omit<Schema['AddScreenRequest'], 'commandId'>;
  'rename-screen': Omit<Schema['RenameScreenRequest'], 'commandId'>;
  'duplicate-screen': Omit<Schema['DuplicateScreenRequest'], 'commandId'>;
}
/** The caller owns command lifetime and refresh. A new command id is created
 * once per intentional user action, never on an implicit retry. */
export function postPageCommand<K extends keyof PageCommandData>(
  request: ApiClient, documentId: string, command: K, data: PageCommandData[K], signal: AbortSignal,
): Promise<unknown> {
  return request('/api/v1/documents/' + encodeURIComponent(documentId) + '/commands/' + command,
    { method: 'POST', body: JSON.stringify({ ...data, commandId: crypto.randomUUID() }) }, signal);
}
