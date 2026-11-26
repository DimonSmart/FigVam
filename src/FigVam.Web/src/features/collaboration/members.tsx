import { InlineError, StatusMessage } from '../../ui/Feedback';
import { TextInput } from '../../ui/Inputs';
import { createPanelRoot } from '../../app/react-panels';
import { flushSync } from 'react-dom';
import { useRef } from 'react';
import { Button } from '../../ui/Button';
import { ApiError, type ApiClient } from '../../api/api-client';
import { requiredRecord, aborted, errorMessage } from '../../api/decode';
type Role='Owner'|'Editor'|'Viewer';
interface Workspace {documentId:string|null;documentRole:string|null;navigationEpoch:number;token:string|null}
interface Options {
  element(id:string):HTMLElement;request:ApiClient;findRole(id:string,signal:AbortSignal):Promise<string|null>;
  openDocument(id:string):Promise<unknown>;loadList():Promise<unknown>;message(status?:string,error?:string):void;
  stopLive():void;startLive():void;workspace:Workspace;
}
interface State {busy:boolean;status:string;error:string;resetKey:number}
function MemberForm({state,change}:{state:State;change(remove:boolean,id:string,role:string):void}){
  const id=useRef<HTMLInputElement>(null),role=useRef<HTMLSelectElement>(null);
  function submit(remove:boolean){
    if(!id.current||!role.current)return;
    change(remove,id.current.value,role.current.value);
  }
  return <>
    <h2 id="members-title">Управление участниками</h2><p>Укажите разрешённого пользователя по email (либо его ID).</p>
    <form id="member-form" key={state.resetKey} onSubmit={e=>{e.preventDefault();submit(false);}}>
      <label htmlFor="member-id">ID участника</label><TextInput ref={id} id="member-id" list="member-options" required maxLength={256} autoComplete="off" disabled={state.busy}/><datalist id="member-options"/>
      <label htmlFor="member-role">Роль участника</label><select ref={role} id="member-role" disabled={state.busy} defaultValue="Owner">{(['Owner','Editor','Viewer'] as const).map(r=><option key={r}>{r}</option>)}</select>
      <Button type="submit" disabled={state.busy}>Назначить роль</Button><Button id="member-remove" disabled={state.busy} onClick={()=>submit(true)}>Удалить участника</Button>
    </form><StatusMessage id="member-status">{state.status}</StatusMessage><InlineError id="member-error">{state.error}</InlineError>
  </>;
}
export function createMembers({element,request,findRole,openDocument,loadList,message,stopLive,startLive,workspace}:Options){
  const host=element('member-management'),root=createPanelRoot(host);
  let controller:AbortController|null=null,state:State={busy:false,status:'',error:'',resetKey:0};
  function render(patch:Partial<State>={}){state={...state,...patch};flushSync(()=>root.render(<MemberForm state={state} change={(remove,id,role)=>void changeMember(remove,id,role)}/>));}
  function reset(){controller?.abort();controller=null;host.hidden=true;render({busy:false,status:'',error:'',resetKey:state.resetKey+1});}
  async function changeMember(remove:boolean,memberId:string,role:string){
    if(controller||workspace.documentRole!=='Owner'||!workspace.token||!workspace.documentId||element('editor-view').hidden)return;
    render({status:'',error:''});
    if(!memberId.trim()||memberId.length>256||(remove&&memberId.includes('/'))){render({error:'Укажите корректный ID участника (от 1 до 256 символов; для удаления без /).'});element('member-id').focus();return;}
    if(!remove&&!['Owner','Editor','Viewer'].includes(role)){render({error:'Выберите допустимую роль.'});return;}
    if(remove&&!confirm('Удалить участника «'+memberId+'» из документа?'))return;
    const op=new AbortController(),id=workspace.documentId,epoch=workspace.navigationEpoch,requestToken=workspace.token;
    controller=op;stopLive();
    const active=()=>controller===op&&!op.signal.aborted&&epoch===workspace.navigationEpoch&&workspace.token===requestToken&&id===workspace.documentId&&!element('editor-view').hidden;
    render({busy:true,status:'Сохранение…'});let accepted=false;
    try{
      const path='/api/v1/documents/'+encodeURIComponent(id)+'/members'+(remove?'/'+encodeURIComponent(memberId):'');
      const result=requiredRecord(await request(path,remove?{method:'DELETE'}:{method:'PUT',body:JSON.stringify({memberId,role})},op.signal));
      if(!active())return;
      if(result.code!=='ACCEPTED'||typeof result.documentId!=='string'||result.documentId.toLowerCase()!==id.toLowerCase())throw new TypeError('Некорректное подтверждение');
      accepted=true;const currentRole=await findRole(id,op.signal);if(!active())return;
      const success=remove?'Участник удалён.':'Роль участника назначена: '+role+'.';
      if(currentRole!=='Owner'){
        if(currentRole){const reopening=openDocument(id),nextEpoch=workspace.navigationEpoch;await reopening;if(nextEpoch===workspace.navigationEpoch&&workspace.token&&workspace.documentId===id&&!element('editor-view').hidden)message(success+' Ваши права изменились.');}
        else{const loading=loadList(),nextEpoch=workspace.navigationEpoch;await loading;if(nextEpoch===workspace.navigationEpoch&&workspace.token)message(success+' Доступ к документу больше не предоставлен.');}
        return;
      }
      render({status:success});
    }catch(error){
      if(!active()||aborted(error))return;
      if(accepted||error instanceof TypeError){
        const loading=loadList(),nextEpoch=workspace.navigationEpoch;await loading;
        if(nextEpoch===workspace.navigationEpoch&&workspace.token)message('',accepted?'Изменение сохранено, но не удалось проверить ваши права. Откройте документ снова.':'Не удалось подтвердить результат. Проверьте доступ и повторите запрос при необходимости.');
        return;
      }
      const code=error instanceof ApiError?error.code:undefined,status=error instanceof ApiError?error.status:undefined;
      render({status:'',error:code==='LAST_OWNER'?'Нельзя удалить последнего Owner или изменить его роль.':status===400||code==='INVALID_MEMBER'?'Некорректный ID участника или роль. Проверьте введённые данные.':status===403?'Нет прав управлять участниками документа.':errorMessage(error)});
    }finally{if(active()){controller=null;render({busy:false});startLive();}}
  }
  render();return{reset,prepare(role:string|null){host.hidden=role!=='Owner';}};
}
