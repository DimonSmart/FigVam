import { ApiError } from './api-client';
import { array, requiredRecord, text } from './decode';
import type { paths, components } from './schema.generated';

type NameOf<T> = T extends `/api/v1/documents/{documentId}/commands/${infer Name}` ? Name : never;
export type DocumentCommandName = NameOf<keyof paths>;
type Endpoint<K extends DocumentCommandName> = paths[`/api/v1/documents/{documentId}/commands/${K}`]['post'];
export type DocumentCommandRequest<K extends DocumentCommandName> = Endpoint<K>['requestBody']['content']['application/json'];
export type DocumentCommandResponse<K extends DocumentCommandName> = Endpoint<K>['responses'][200]['content']['application/json'];
type CommandBody = { commandId: string };
type Transport = (path: string, options: RequestInit, signal?: AbortSignal | null, isCurrent?: () => boolean) => Promise<unknown>;
export type CommandConfirmation = Omit<components['schemas']['CommandResponse'], 'revision'> & {revision: number};

export function createCommandBody<T extends object>(data: T, commandId: string = crypto.randomUUID()): T & CommandBody {
  return { ...data, commandId };
}

function commandPath(documentId: string, command: DocumentCommandName) {
  return '/api/v1/documents/' + encodeURIComponent(documentId) + '/commands/' + command;
}

export function decodeCommandConfirmation(raw: unknown, documentId: string, commandId: string): CommandConfirmation {
  const value = requiredRecord(raw);
  if (value.status !== 'ACCEPTED' || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      text(value.documentId).toLowerCase() !== documentId.toLowerCase() ||
      text(value.commandId).toLowerCase() !== commandId.toLowerCase())
    throw new TypeError('Некорректное подтверждение команды.');
  const nullableId = (id: unknown) => id === null ? null : text(id);
  return {status: value.status, documentId: text(value.documentId), commandId: text(value.commandId),
    revision: value.revision, pageId: nullableId(value.pageId), screenId: nullableId(value.screenId),
    nodeId: nullableId(value.nodeId), versionId: nullableId(value.versionId), affectedIds: array(value.affectedIds, text)};
}

/** Existing feature-owned operations use this validated transport while migrating to prepared operations. */
export async function postDocumentCommand<T extends CommandBody>(request: Transport, documentId: string, command: DocumentCommandName,
  body: T, signal?: AbortSignal | null, isCurrent?: () => boolean): Promise<CommandConfirmation> {
  const value = await request(commandPath(documentId, command), { method: 'POST', body: JSON.stringify(body) }, signal, isCurrent);
  return decodeCommandConfirmation(value, documentId, body.commandId);
}

export type CommandFailure = 'rejected' | 'conflict' | 'uncertain';
export function classifyCommandFailure(error: unknown, current = true, timeoutIsUncertain = true): CommandFailure {
  if (!current || !(error instanceof ApiError) || error.status >= 500 || (timeoutIsUncertain && error.status === 408)) return 'uncertain';
  return error.status === 409 || error.code === 'REVISION_CONFLICT' ? 'conflict' : 'rejected';
}

export type CommandState =
  | {kind: 'ready' | 'pending'}
  | {kind: CommandFailure; error: unknown}
  | {kind: 'confirmed'; confirmation: CommandConfirmation; synchronization: 'pending' | 'synced' | 'failed' | 'stale'; error?: unknown};

interface Execution {
  request: Transport;
  signal?: AbortSignal | null;
  isCurrent(): boolean;
  synchronize(confirmation: CommandConfirmation): Promise<boolean | void>;
  validate?(confirmation: CommandConfirmation): void;
}

/** Owns one intent and its serialized wire payload. A confirmed write is never resent,
 * including when subsequent read/synchronization fails. No automatic network retries. */
function preparedOperation(documentId: string, command: DocumentCommandName, commandId: string, payload: string) {
  let state: CommandState = {kind:'ready'};
  let running = false;
  async function execute(execution: Execution): Promise<CommandState> {
    if (running || state.kind === 'rejected' || state.kind === 'conflict' ||
        (state.kind === 'confirmed' && state.synchronization === 'synced') ||
        execution.signal?.aborted || !execution.isCurrent()) return state;
    running = true;
    try {
      let confirmation: CommandConfirmation;
      if (state.kind === 'confirmed') confirmation = state.confirmation;
      else {
        state = {kind:'pending'};
        try {
          const value = await execution.request(commandPath(documentId, command),
            {method:'POST',body:payload}, execution.signal);
          confirmation = decodeCommandConfirmation(value, documentId, commandId);
          execution.validate?.(confirmation);
        } catch (error) {
          state = {kind:classifyCommandFailure(error, execution.isCurrent()),error};
          return state;
        }
      }
      if (execution.signal?.aborted || !execution.isCurrent()) {
        state = {kind:'confirmed',confirmation,synchronization:'stale'};
        return state;
      }
      state = {kind:'confirmed',confirmation,synchronization:'pending'};
      try {
        const synchronized = await execution.synchronize(confirmation);
        state = {kind:'confirmed',confirmation,
          synchronization: execution.signal?.aborted || !execution.isCurrent() ? 'stale' : synchronized === false ? 'failed' : 'synced'};
      } catch (error) {
        state = {kind:'confirmed',confirmation,synchronization:'failed',error};
      }
      return state;
    } finally { running = false; }
  }
  return {documentId,command,commandId,getSnapshot:()=>state,execute};
}
export type DocumentCommandOperation = ReturnType<typeof preparedOperation>;

export function prepareDocumentCommand<K extends DocumentCommandName>(documentId: string, command: K,
  body: DocumentCommandRequest<NoInfer<K>>): DocumentCommandOperation {
  return preparedOperation(documentId, command, body.commandId, JSON.stringify(body));
}

export function createDocumentCommand<K extends DocumentCommandName>(documentId: string, command: K,
  data: Omit<DocumentCommandRequest<NoInfer<K>>, 'commandId'>, commandId = crypto.randomUUID()): DocumentCommandOperation {
  return preparedOperation(documentId, command, commandId, JSON.stringify({...data,commandId}));
}
