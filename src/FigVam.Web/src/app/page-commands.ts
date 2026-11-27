import { createDocumentCommand, type DocumentCommandRequest } from '../api/document-commands';

type PageCommandName = 'add-page' | 'rename-page' | 'delete-page' | 'add-screen' | 'rename-screen' | 'duplicate-screen';
export type PageCommandData = { [K in PageCommandName]: Omit<DocumentCommandRequest<K>, 'commandId'> };

export function preparePageCommand<K extends PageCommandName>(documentId: string, command: K, data: PageCommandData[K]) {
  return createDocumentCommand(documentId, command, data);
}

import type { ApiClient } from '../api/api-client';
export async function postPageCommand<K extends PageCommandName>(request: ApiClient, documentId: string, command: K, data: PageCommandData[K], signal: AbortSignal): Promise<unknown> {
  const operation=preparePageCommand(documentId,command,data);
  const result=await operation.execute({request,signal,isCurrent:()=>!signal.aborted,synchronize:async()=>true});
  if(result.kind==='confirmed')return result.confirmation;
  if('error' in result)throw result.error;
  throw new DOMException('Cancelled','AbortError');
}
