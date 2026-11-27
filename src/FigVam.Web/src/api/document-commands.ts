import { ApiError } from './api-client';
import type { paths } from './schema.generated';

type NameOf<T> = T extends `/api/v1/documents/{documentId}/commands/${infer Name}` ? Name : never;
export type DocumentCommandName = NameOf<keyof paths>;
type CommandBody = { commandId: string };
type Transport = (path: string, options: RequestInit, signal?: AbortSignal | null, isCurrent?: () => boolean) => Promise<unknown>;

/** Allocate an ID only at the user-intent boundary. Retry the original body, not this factory. */
export function createCommandBody<T extends object>(data: T, commandId: string = crypto.randomUUID()): T & CommandBody {
  return { ...data, commandId };
}

/** Feature modules own typed payloads, acknowledgement validation and revision-specific synchronization.
 * This transport never creates a new ID, changes the payload or retries a write. */
export function postDocumentCommand<T extends CommandBody>(request: Transport, documentId: string, command: DocumentCommandName,
  body: T, signal?: AbortSignal | null, isCurrent?: () => boolean): Promise<unknown> {
  return request('/api/v1/documents/' + encodeURIComponent(documentId) + '/commands/' + command,
    { method: 'POST', body: JSON.stringify(body) }, signal, isCurrent);
}

export type CommandFailure = 'rejected' | 'conflict' | 'uncertain';
/** A timeout or lost response is not evidence of rejection. Never automatically allocate another ID. */
export function classifyCommandFailure(error: unknown, current = true, timeoutIsUncertain = true): CommandFailure {
  if (!current || !(error instanceof ApiError) || error.status >= 500 || (timeoutIsUncertain && error.status === 408)) return 'uncertain';
  return error.status === 409 || error.code === 'REVISION_CONFLICT' ? 'conflict' : 'rejected';
}
