import { createPanelStore } from './panel-store';
import type { FeedbackState, PreviewChromeState as ChromeState } from '../canvas/chrome-contracts';
function createRenderFeedback() {
  const store=createPanelStore<FeedbackState>({status:'',diagnostics:[],canRetry:false});
  function patch(next:Partial<FeedbackState>){const current=store.getSnapshot();if(Object.entries(next).some(([key,value])=>current[key as keyof FeedbackState]!==value))store.publish({...current,...next});}
  return {...store,patch,addDiagnostic(message:string){const current=store.getSnapshot().diagnostics;if(!current.includes(message))patch({diagnostics:[...current,message]});}};
}
export type RenderFeedback=ReturnType<typeof createRenderFeedback>;
export function createPreviewChrome(){
  const store=createPanelStore<ChromeState>({active:false,available:false,theme:'Light',canGoBack:false});
  return {...store,design:createRenderFeedback(),preview:createRenderFeedback(),patch(next:Partial<ChromeState>){
    const current=store.getSnapshot();
    if(Object.entries(next).some(([key,value])=>current[key as keyof ChromeState]!==value))store.publish({...current,...next});
  }};
}
export type PreviewChrome=ReturnType<typeof createPreviewChrome>;
