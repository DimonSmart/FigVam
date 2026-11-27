import { createPanelStore } from './panel-store';
export type MenuId='share'|'mcp'|'file'|'screen-create'|'palette'|`page:${string}`|`screen:${string}`;
export function createEditorMenu(){
  const store=createPanelStore<MenuId|null>(null);
  return {...store,toggle(id:MenuId){store.publish(store.getSnapshot()===id?null:id);},close(id:MenuId){if(store.getSnapshot()===id)store.publish(null);},closeRows(){const id=store.getSnapshot();if(id?.startsWith('page:')||id?.startsWith('screen:'))store.publish(null);}};
}
export type EditorMenu=ReturnType<typeof createEditorMenu>;
