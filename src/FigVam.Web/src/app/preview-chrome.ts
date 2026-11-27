import { createPanelStore } from './panel-store';
import type { Theme } from '../core/tokens/token-model';

interface FeedbackState {status:string;diagnostics:readonly string[];canRetry:boolean}
function createRenderFeedback() {
  const store=createPanelStore<FeedbackState>({status:'',diagnostics:[],canRetry:false});
  function patch(next:Partial<FeedbackState>){store.publish({...store.getSnapshot(),...next});}
  return {...store,patch,addDiagnostic(message:string){const current=store.getSnapshot().diagnostics;if(!current.includes(message))patch({diagnostics:[...current,message]});}};
}
export type RenderFeedback=ReturnType<typeof createRenderFeedback>;
interface ChromeState {active:boolean;available:boolean;theme:Theme;canGoBack:boolean}
export function createPreviewChrome(){
  const store=createPanelStore<ChromeState>({active:false,available:false,theme:'Light',canGoBack:false});
  return {...store,design:createRenderFeedback(),preview:createRenderFeedback(),patch(next:Partial<ChromeState>){
    const current=store.getSnapshot();
    if(Object.entries(next).some(([key,value])=>current[key as keyof ChromeState]!==value))store.publish({...current,...next});
  }};
}
export type PreviewChrome=ReturnType<typeof createPreviewChrome>;
