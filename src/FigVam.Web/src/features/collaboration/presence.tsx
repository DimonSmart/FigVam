import { TextInput } from '../../ui/Inputs';
import { StatusMessage } from '../../ui/Feedback';
import { createViewModel } from '../../app/view-model';
import type { AuthPolicy } from '../../api/auth-client';
import { ApiError } from '../../api/api-client';
import { requiredRecord, text, array, aborted } from '../../api/decode';
interface Point { x: number; y: number }
interface Participant { name: string; color: string; screenId: string | null; selectedIds: string[]; cursor: Point | null }
interface Context { token: string | null; documentId: string | null; navigationEpoch: number; selectedLayer: {id:string} | null; selectedScreen: string | null }
interface Options { auth: AuthPolicy; isEditorVisible(): boolean;  models:ReturnType<typeof createPresenceModels>; element(id:string):HTMLElement; getContext():Context; toViewportPoint(point:Point):Point }
function participant(value:unknown):Participant {
  const p=requiredRecord(value), color=text(p.color);
  if(!/^#[0-9a-fA-F]{6}$/.test(color))throw new TypeError('Invalid presence color');
  let cursor:Point|null=null;
  if(p.cursor!=null){const c=requiredRecord(p.cursor);if(typeof c.x!=='number'||typeof c.y!=='number'||!Number.isFinite(c.x)||!Number.isFinite(c.y))throw new TypeError('Invalid presence cursor');cursor={x:c.x,y:c.y};}
  return {name:text(p.name),color,screenId:p.screenId==null?null:text(p.screenId),selectedIds:array(p.selectedIds,text),cursor};
}
type Marker={p:Participant;i:number;x:number;y:number};
function PresenceList({participants}:{participants:Participant[]}){
  return <>{participants.map((p,i)=><li key={i}>{p.name+' · цвет '+p.color+' · экран: '+(p.screenId||'не выбран')+' · выбранные ID: '+(p.selectedIds.length?p.selectedIds.join(', '):'нет')+' · '+(p.cursor?'курсор: '+p.cursor.x+', '+p.cursor.y:'курсор недоступен')}</li>)}</>;
}
function PresenceMarkers({visible}:{visible:Marker[]}){
  return <>{visible.map(({p,i,x,y})=><span key={i} className="presence-marker" style={{left:x,top:y,borderColor:p.color}}>{'◆ '+p.name}</span>)}</>;
}
function PresenceSettings({name,color,status,changeName,changeColor}:{name:string;color:string;status:string;changeName(value:string):void;changeColor(value:string):void}){
  return <><label htmlFor="presence-name">Ваше имя для участников</label><TextInput id="presence-name" maxLength={128} value={name} autoComplete="off" onChange={event=>changeName(event.currentTarget.value)}/><label htmlFor="presence-color">Ваш цвет</label><input id="presence-color" type="color" value={color} onChange={event=>changeColor(event.currentTarget.value)}/><StatusMessage id="presence-status">{status}</StatusMessage></>;
}
export function createPresenceModels(){return {list:createViewModel(PresenceList),markers:createViewModel(PresenceMarkers),settings:createViewModel(PresenceSettings)};}
export function createPresence({auth,models,element,getContext,toViewportPoint,isEditorVisible}:Options){
  let renderedParticipants:Participant[]|undefined;
  let controller:AbortController|null=null,timer:ReturnType<typeof setTimeout>|undefined;
  let participants:Participant[]=[],cursor:Point|null=null,cursorScreen:string|null=null,lastRead=0;
  let name='Участник',color='#2455a4',status='';
  function renderSettings(){
    models.settings.publish({name,color,status,changeName:value=>{name=value;renderSettings();},changeColor:value=>{color=value;renderSettings();}});
  }
  function setStatus(value:string){status=value;renderSettings();}
  renderSettings();
  function render(){
    const screen=getContext().selectedScreen, area=element('viewport');
    const visible=participants.flatMap((p,i)=>{
      if(!screen||p.screenId!==screen||!p.cursor)return [];
      const {x,y}=toViewportPoint(p.cursor);
      return x>=0&&y>=0&&x<area.clientWidth&&y<area.clientHeight?[{p,i,x,y}]:[];
    });
    if(renderedParticipants!==participants){renderedParticipants=participants;models.list.publish({participants});}
    models.markers.publish({visible});
  }
  function stop(){controller?.abort();controller=null;clearTimeout(timer);timer=undefined;participants=[];cursor=null;cursorScreen=null;lastRead=0;render();setStatus('');}
  function start(){
    const {token,documentId,navigationEpoch}=getContext();
    if(controller||!token||!documentId||!isEditorVisible())return;
    const requestToken=token;
    const operation=new AbortController();controller=operation;
    const active=()=>{const ctx=getContext();return controller===operation&&!operation.signal.aborted&&ctx.documentId===documentId&&ctx.token===token&&ctx.navigationEpoch===navigationEpoch&&isEditorVisible();};
    const path='/api/v1/documents/'+encodeURIComponent(documentId)+'/presence';
    async function exchange(method:'GET'|'PUT',body?:unknown):Promise<unknown>{
      const response=await fetch(path,{method,signal:AbortSignal.any([operation.signal,AbortSignal.timeout(5000)]),cache:'no-store',credentials:auth.credentialsMode(),redirect:'error',headers:{...auth.authHeaders(requestToken,method),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      if(!active())throw new DOMException('Cancelled','AbortError');
      if(!response.ok)throw new ApiError(response.status,{});
      return response.json();
    }
    async function cycle(){
      if(!active())return;
      try{
        const displayName=name.trim().slice(0,128)||'Участник';
        const {selectedLayer,selectedScreen}=getContext();
        await exchange('PUT',{name:displayName,color,cursor:cursorScreen===selectedScreen?cursor:null,selectedIds:selectedLayer?[selectedLayer.id]:[],screenId:selectedScreen});
        const result=requiredRecord(await exchange('GET'));if(!active())return;
        if(result.code!=='PRESENCE')throw new TypeError('Invalid presence');
        participants=array(result.participants,participant);lastRead=Date.now();render();
        setStatus(participants.length?'Присутствующие участники обновлены.':'Сейчас участников нет.');
      }catch(error){
        if(!active()||aborted(error))return;
        if(error instanceof ApiError&&[401,403,404].includes(error.status)){participants=[];render();setStatus('Присутствие недоступно: доступ к документу потерян.');return;}
        if(Date.now()-lastRead>=60000){participants=[];render();}
        setStatus('Не удалось обновить присутствие. Повторная попытка автоматически.');
      }
      if(active())timer=setTimeout(()=>void cycle(),10000);
    }
    setStatus('Загрузка участников…');void cycle();
  }
  return {start,stop,render,setCursor(point:Point|null,screen:string|null){cursor=point;cursorScreen=screen;}};
}
