import type { ApiClient } from '../api/api-client';
import type { createDocumentQueries } from '../api/document-queries';
import type { DocumentListItem } from '../api/document-list';
import type { createDocumentCatalog } from './document-catalog';
import type { createRequestRunner } from './request-runner';
import type { createDocumentShellModel } from './document-shell-state';

interface Options {
  request: ApiClient;
  queries: Pick<ReturnType<typeof createDocumentQueries>, 'readName' | 'findRole'>;
  catalog: ReturnType<typeof createDocumentCatalog>;
  run: ReturnType<typeof createRequestRunner>['run'];
  pageSize: number;
  authenticated(): boolean;
  leaveDeletion(): void;
  deletingId(): string | null;
  replaceCatalogRoute(): void;
  transition(id:string|null): void;
  showCatalog(): void;
  publishCatalog(items:DocumentListItem[],index:number,canGoBack:boolean,canGoForward:boolean):void;
  prepareDocument(name:string,role:ReturnType<ReturnType<typeof createDocumentShellModel>['getSnapshot']>['role']):void;
  readPages(signal:AbortSignal):Promise<unknown>;
  showDocument():void;
  message(status?:string):void;
}

/** Owns the catalog/document opening workflow; application bindings own UI snapshots. */
export function createWorkspaceNavigation(o:Options){
  async function loadList(index=0,cursor:string|null|undefined=null):Promise<void>{
    o.leaveDeletion();
    if(!o.authenticated())return;
    o.transition(null);
    o.showCatalog();
    o.catalog.beginLoad();
    await o.run(()=>loadList(index,cursor),async(signal,current)=>{
      const result=await o.catalog.read(o.request,index,cursor,o.pageSize,signal,current);
      if(!result)return;
      o.publishCatalog(result.items,index,o.catalog.canGoBack,o.catalog.canGoForward);
      o.message(result.items.length ? `Документов на странице: ${result.items.length}` : 'Доступных документов нет. Создайте документ или запросите права у владельца.');
    });
  }
  async function openDocument(id:string):Promise<void>{
    o.leaveDeletion();
    if(o.deletingId()===id){o.replaceCatalogRoute();return loadList();}
    o.transition(id);
    await o.run(()=>openDocument(id),async(signal,current)=>{
      const name=await o.queries.readName(id,signal);
      const role=await o.queries.findRole(id,signal);
      if(!current())return;
      o.prepareDocument(name,role);
      await o.readPages(signal);
      if(current())o.showDocument();
    });
  }
  return {loadList,openDocument};
}
