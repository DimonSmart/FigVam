import { createPanelStore } from './panel-store';
import { defaultGridSettings } from '../canvas/visual-geometry';

import type { CanvasChromeState } from '../canvas/chrome-contracts';
export function createCanvasChrome(){
  const store=createPanelStore<CanvasChromeState>({caption:'Выберите экран, чтобы показать его на холсте.',zoomPercent:100,available:false,hint:'',grid:{...defaultGridSettings}});
  return {...store,patch(next:Partial<CanvasChromeState>){
    const current=store.getSnapshot();
    if(Object.entries(next).some(([key,value])=>current[key as keyof CanvasChromeState]!==value))store.publish({...current,...next});
  }};
}
export type CanvasChrome=ReturnType<typeof createCanvasChrome>;
