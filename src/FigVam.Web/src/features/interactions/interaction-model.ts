export type ActionKind='navigate'|'openOverlay'|'closeOverlay'|'showVariant'|'setDemoValue'|'selectDataset'|'resetPreview';
export interface ActionDraft {type:ActionKind|'';screenId?:string;variantId?:string|null;datasetId?:string|null;nodeId?:string;value?:string|null}
export interface ScenarioDraft {id:string;screenId:string;nodeId:string;event:number|null;actions:ActionDraft[]}
export const eventLabels = ['По нажатию', 'При изменении', 'При наведении', 'При уходе указателя', 'При отправке'];
export const actionLabels:Record<ActionKind,string> = {
  navigate: 'Перейти на экран', openOverlay: 'Открыть оверлей', closeOverlay: 'Закрыть оверлей',
  showVariant: 'Переключить вариант', setDemoValue: 'Установить значение',
  selectDataset: 'Выбрать датасет', resetPreview: 'Сбросить Preview'
};
export const noValue = '__null__';
export const id = (value:unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const clone = <T,>(value:T):T => structuredClone(value);
export const isActionKind=(value:string):value is ActionKind=>Object.hasOwn(actionLabels,value);
export function actionComplete(a:ActionDraft) {
  switch (a.type) {
    case 'navigate': case 'openOverlay': return id(a.screenId);
    case 'showVariant': return a.variantId === null || id(a.variantId);
    case 'selectDataset': return a.datasetId === null || id(a.datasetId);
    case 'setDemoValue': return id(a.nodeId) && (a.value === null || typeof a.value === 'string' && a.value.length <= 4096);
    case 'closeOverlay': case 'resetPreview': return true;
    default: return false;
  }
}
export function emptyAction(type:string):ActionDraft {
  if (type === 'setDemoValue') return { type, value: null };
  return { type:isActionKind(type)?type:'' };
}

export function parameter(action:ActionDraft):string|null|undefined {
  if (action.type === 'navigate' || action.type === 'openOverlay') return action.screenId;
  if (action.type === 'showVariant') return action.variantId === null ? noValue : action.variantId;
  if (action.type === 'selectDataset') return action.datasetId === null ? noValue : action.datasetId;
  if (action.type === 'setDemoValue') return action.nodeId;
  return '';
}

