import { createPanelStore } from './panel-store';

interface CanvasChromeState {caption:string;zoomPercent:number;available:boolean;hint:string}
export function createCanvasChrome(){
  const store=createPanelStore<CanvasChromeState>({caption:'Выберите экран, чтобы показать его на холсте.',zoomPercent:100,available:false,hint:''});
  return {...store,patch(next:Partial<CanvasChromeState>){
    const current=store.getSnapshot();
    if(Object.entries(next).some(([key,value])=>current[key as keyof CanvasChromeState]!==value))store.publish({...current,...next});
  }};
}
export type CanvasChrome=ReturnType<typeof createCanvasChrome>;
