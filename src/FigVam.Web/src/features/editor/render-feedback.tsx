import { useSyncExternalStore } from 'react';
import type { RenderFeedback as Model } from '../../app/preview-chrome';
import { Button } from '../../ui/Button';
export function RenderFeedback({model,mode,retry}:{model:Model;mode:'design'|'preview';retry():void}){
  const state=useSyncExternalStore(model.subscribe,model.getSnapshot);
  return <><p id={mode+'-render-status'} role="status">{state.status}</p>
    <Button id={mode+'-render-retry'} type="button" hidden={!state.canRetry} onClick={retry}>{mode==='design'?'Повторить загрузку экрана':'Повторить загрузку Preview'}</Button>
    <ul id={mode+'-render-diagnostics'} aria-label={mode==='design'?'Диагностика отображения':'Диагностика Preview'}>{state.diagnostics.map(message=><li key={message}>{message}</li>)}</ul></>;
}
