import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { authHeaders, credentialsMode } from '../../api/auth-client';
import { ApiError } from '../../api/api-client';
import { requiredRecord, text, array, aborted } from '../../api/decode';
interface Point { x: number; y: number }
interface Participant { name: string; color: string; screenId: string | null; selectedIds: string[]; cursor: Point | null }
interface Context { token: string | null; documentId: string | null; navigationEpoch: number; selectedLayer: {id:string} | null; selectedScreen: string | null }
interface Options { element(id:string):HTMLElement; getContext():Context; toViewportPoint(point:Point):Point }
function participant(value:unknown):Participant {
  const p=requiredRecord(value), color=text(p.color);
  if(!/^#[0-9a-fA-F]{6}$/.test(color))throw new TypeError('Invalid presence color');
  let cursor:Point|null=null;
  if(p.cursor!=null){const c=requiredRecord(p.cursor);if(typeof c.x!=='number'||typeof c.y!=='number'||!Number.isFinite(c.x)||!Number.isFinite(c.y))throw new TypeError('Invalid presence cursor');cursor={x:c.x,y:c.y};}
  return {name:text(p.name),color,screenId:p.screenId==null?null:text(p.screenId),selectedIds:array(p.selectedIds,text),cursor};
}
export function createPresence({element,getContext,toViewportPoint}:Options){
  const list=createRoot(element('presence-list')), markers=createRoot(element('presence-markers'));
  let controller:AbortController|null=null,timer:ReturnType<typeof setTimeout>|undefined;
  let participants:Participant[]=[],cursor:Point|null=null,cursorScreen:string|null=null,lastRead=0;
  function input(id:string){const node=element(id);if(!(node instanceof HTMLInputElement))throw new TypeError('Missing input: '+id);return node.value;}
  function render(){
    const screen=getContext().selectedScreen, area=element('viewport');
    const visible=participants.flatMap((p,i)=>{
      if(!screen||p.screenId!==screen||!p.cursor)return [];
      const {x,y}=toViewportPoint(p.cursor);
      return x>=0&&y>=0&&x<area.clientWidth&&y<area.clientHeight?[{p,i,x,y}]:[];
    });
    flushSync(()=>{
      list.render(<>{participants.map((p,i)=><li key={i}>{p.name+' · цвет '+p.color+' · экран: '+(p.screenId||'не выбран')+' · выбранные ID: '+(p.selectedIds.length?p.selectedIds.join(', '):'нет')+' · '+(p.cursor?'курсор: '+p.cursor.x+', '+p.cursor.y:'курсор недоступен')}</li>)}</>);
      markers.render(<>{visible.map(({p,i,x,y})=><span key={i} className="presence-marker" style={{left:x,top:y,borderColor:p.color}}>{'◆ '+p.name}</span>)}</>);
    });
  }
  function stop(){controller?.abort();controller=null;clearTimeout(timer);timer=undefined;participants=[];cursor=null;cursorScreen=null;lastRead=0;render();element('presence-status').textContent='';}
  function start(){
    const {token,documentId,navigationEpoch}=getContext();
    if(controller||!token||!documentId||element('editor-view').hidden)return;
    const requestToken=token;
    const operation=new AbortController();controller=operation;
    const active=()=>{const ctx=getContext();return controller===operation&&!operation.signal.aborted&&ctx.documentId===documentId&&ctx.token===token&&ctx.navigationEpoch===navigationEpoch&&!element('editor-view').hidden;};
    const path='/api/v1/documents/'+encodeURIComponent(documentId)+'/presence';
    async function exchange(method:'GET'|'PUT',body?:unknown):Promise<unknown>{
      const response=await fetch(path,{method,signal:AbortSignal.any([operation.signal,AbortSignal.timeout(5000)]),cache:'no-store',credentials:credentialsMode(),redirect:'error',headers:{...authHeaders(requestToken,method),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      if(!active())throw new DOMException('Cancelled','AbortError');
      if(!response.ok)throw new ApiError(response.status,{});
      return response.json();
    }
    async function cycle(){
      if(!active())return;
      try{
        const name=input('presence-name').trim().slice(0,128)||'Участник';
        const {selectedLayer,selectedScreen}=getContext();
        await exchange('PUT',{name,color:input('presence-color'),cursor:cursorScreen===selectedScreen?cursor:null,selectedIds:selectedLayer?[selectedLayer.id]:[],screenId:selectedScreen});
        const result=requiredRecord(await exchange('GET'));if(!active())return;
        if(result.code!=='PRESENCE')throw new TypeError('Invalid presence');
        participants=array(result.participants,participant);lastRead=Date.now();render();
        element('presence-status').textContent=participants.length?'Присутствующие участники обновлены.':'Сейчас участников нет.';
      }catch(error){
        if(!active()||aborted(error))return;
        if(error instanceof ApiError&&[401,403,404].includes(error.status)){participants=[];render();element('presence-status').textContent='Присутствие недоступно: доступ к документу потерян.';return;}
        if(Date.now()-lastRead>=60000){participants=[];render();}
        element('presence-status').textContent='Не удалось обновить присутствие. Повторная попытка автоматически.';
      }
      if(active())timer=setTimeout(()=>void cycle(),10000);
    }
    element('presence-status').textContent='Загрузка участников…';void cycle();
  }
  return {start,stop,render,setCursor(point:Point|null,screen:string|null){cursor=point;cursorScreen=screen;}};
}
