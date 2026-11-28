import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from './Button';
import { NumberInput, TextInput } from './Inputs';
import type { RawValue } from './property-control-contract';
import { rawArray, rawText } from './property-control-contract';
import type { ValueSpec, ValueField, EditKind, ReferenceSpec, ScalarSpec, ColorSpec } from './property-value';
import { shadowDimensions, weightPresets } from './property-value';
import { tokenValueText } from '../core/tokens/token-resolution';

interface EditorProps {spec:ValueSpec;raw:RawValue;disabled:boolean;ids:readonly string[];invalid?:number;describedBy?:string;displayLabel?:string;bare?:boolean;onEdit(raw:RawValue,kind:EditKind):void}
function propsFor(p:EditorProps,index=0){
  return {id:p.ids[index],disabled:p.disabled,'aria-invalid':p.invalid===index?true:undefined,'aria-describedby':p.describedBy};
}
function childProps(p:EditorProps,spec:ValueSpec,raw:RawValue,start:number,onEdit:EditorProps['onEdit']):EditorProps{
  return {...p,spec,raw,ids:p.ids.slice(start,start+spec.count),invalid:p.invalid===undefined?undefined:p.invalid-start,onEdit,displayLabel:undefined,bare:false};
}
function Labeled({label,children}:{label:string;children:ReactNode}){return <label>{label}{children}</label>;}
function replace(raw:RawValue,index:number,next:RawValue){const values=[...rawArray(raw)];values[index]=next;return values;}
function nativeColorEvent(e:{nativeEvent:Event}){return e.nativeEvent.type==='change'?'discrete':'color-preview';}
function ScalarEditor(p:EditorProps&{spec:ScalarSpec}){
  const {spec,raw,onEdit}=p,value=rawText(raw),common=propsFor(p);
  const label=p.displayLabel??spec.label,ariaLabel=spec.label;
  let control:ReactNode;
  if(spec.type==='catalog')control=<><input {...common} list={common.id+'-catalog'} aria-label={ariaLabel}
    value={value} autoComplete="off" onChange={e=>onEdit(e.currentTarget.value,'input')} onBlur={e=>onEdit(e.currentTarget.value,'commit')}/>
    <datalist id={common.id+'-catalog'}>{spec.choices?.map(([id,name])=><option key={id} value={id}>{name}</option>)}</datalist></>;
  else if(spec.type==='select')control=<select {...common} aria-label={ariaLabel} required={spec.required} value={value} onChange={e=>onEdit(e.currentTarget.value,'discrete')}>
    {spec.placeholder&&<option value="">{spec.placeholder}</option>}
    {spec.choices?.map(([id,name])=><option key={id} value={id}>{name}</option>)}
    {value&&!spec.choices?.some(([id])=>id===value)&&<option value={value} disabled>{'Недоступен · '+value}</option>}
  </select>;
  else if(spec.type==='checkbox')control=<input {...common} type="checkbox" aria-label={ariaLabel} checked={raw===true} onChange={e=>onEdit(e.currentTarget.checked,'discrete')}/>;
  else if(spec.type==='number')control=<NumberInput {...common} aria-label={ariaLabel} required step="any" min={spec.minimum} max={spec.maximum} value={value}
    onChange={e=>onEdit(e.currentTarget.value,'input')} onBlur={e=>{const input=e.currentTarget;onEdit(spec.round&&Number.isFinite(input.valueAsNumber)&&input.validity.valid?String(Number(input.valueAsNumber.toFixed(2))):input.value,'commit');}}/>;
  else if(spec.type==='textarea')control=<textarea {...common} aria-label={ariaLabel} maxLength={spec.maxLength} value={value} onChange={e=>onEdit(e.currentTarget.value,'input')} onBlur={e=>onEdit(e.currentTarget.value,'commit')}/>;
  else control=<TextInput {...common} aria-label={ariaLabel} maxLength={spec.maxLength} value={value} onChange={e=>onEdit(e.currentTarget.value,'input')} onBlur={e=>onEdit(e.currentTarget.value,'commit')}/>;
  return p.bare?control:<Labeled label={label}>{control}</Labeled>;
}
function ColorEditor(p:EditorProps&{spec:ColorSpec}){
  const {spec,raw,onEdit}=p,[h,a]=rawArray(raw),hex=rawText(h),alpha=rawText(a);
  const [open,setOpen]=useState(false),alphaRef=useRef<HTMLInputElement>(null);
  const pickerValue=/^#[0-9a-f]{6}$/i.test(hex)?hex:'#000000';
  const picker=<input {...propsFor(p)} type="color" className={spec.compact?'token-color-picker':undefined} aria-label={spec.label+(spec.compact?' — палитра':'')} value={pickerValue}
    onInput={e=>onEdit([e.currentTarget.value,alpha],'color-preview')}
    onChange={e=>onEdit([e.currentTarget.value,alpha],nativeColorEvent(e))} onBlur={()=>onEdit(raw,'commit')}/>;
  const opacity=<Labeled label="Альфа (0–255)"><NumberInput {...propsFor(p,spec.compact?2:1)} ref={alphaRef} aria-label={spec.label+' — альфа'} min={0} max={255} step={1} required value={alpha}
    onChange={e=>onEdit([hex,e.currentTarget.value],'input')} onBlur={e=>onEdit([hex,e.currentTarget.value],'commit')}/></Labeled>;
  useLayoutEffect(()=>{if(open)alphaRef.current?.focus();},[open]);
  if(!spec.compact)return <><Labeled label="Цвет">{picker}</Labeled>{opacity}</>;
  return <div className="token-color-editor">{picker}<TextInput {...propsFor(p,1)} maxLength={7} spellCheck={false} className="token-color-hex" aria-label={spec.label} value={hex}
    onChange={e=>onEdit([e.currentTarget.value,alpha],'input')} onBlur={e=>onEdit([e.currentTarget.value,alpha],'commit')}/>
    <Button {...propsFor(p,3)} className="token-color-alpha-button" title="Изменить Alpha" aria-label="Изменить Alpha" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>A</Button>
    <div className="token-color-alpha-panel" hidden={!open}>{opacity}</div>
  </div>;
}
function ReferenceEditor(p:EditorProps&{spec:ReferenceSpec}){
  const {spec,raw,onEdit}=p,[source,literal,id]=rawArray(raw),tokenId=rawText(id),linked=source==='token';
  const [open,setOpen]=useState(false),[search,setSearch]=useState('');
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),popover=useRef<HTMLDivElement>(null),searchRef=useRef<HTMLInputElement>(null);
  const resolved=linked?spec.resolve(tokenId):null,item=linked?spec.getToken(tokenId):undefined;
  const name=linked?(item?.name??'Удалённый токен · '+tokenId.slice(0,8)):'';
  const resultText=resolved?(resolved.error??tokenValueText(resolved.value))+' · '+spec.theme:'';
  const color=resolved&&!resolved.error&&resolved.value?.type==='color'?resolved.value:null;
  function close(focus=false){setOpen(false);if(focus)trigger.current?.focus();}
  useLayoutEffect(()=>{
    if(!open||!trigger.current||!popover.current)return;
    const rect=trigger.current.getBoundingClientRect(),width=Math.min(270,window.innerWidth-16);
    popover.current.style.left=Math.max(8,Math.min(rect.right-width,window.innerWidth-width-8))+'px';
    popover.current.style.top=(rect.bottom+8+260<window.innerHeight?rect.bottom+5:Math.max(8,rect.top-265))+'px';
    popover.current.style.width=width+'px';searchRef.current?.focus();
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!(event.target instanceof Node)||!root.current?.contains(event.target))close();};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}};
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);};
  },[open]);
  const compatible=open?spec.getCompatible():[],matches=compatible.filter(t=>t.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div ref={root} className={'token-value-layout'+(spec.direct.kind==='shadow'?' token-value-layout--shadow':'')+(linked?' is-linked':'')+(resolved?.error?' is-invalid':'')}>
    <span className="token-value-label" title={(p.displayLabel??spec.displayLabel)!==spec.label?spec.label:undefined}>{p.displayLabel??spec.displayLabel}</span>
    <div className="token-value-editor">
      <div className="token-value-direct" hidden={linked}><ValueEditor {...childProps(p,spec.direct,literal??null,0,(value,kind)=>onEdit([source??spec.mode,value,tokenId],kind))} bare={spec.mode==='number'&&!spec.customDirect}/></div>
      <div className="token-value-reference" hidden={!linked} title={resolved?(resolved.error??(name+' · '+tokenValueText(resolved.value)+' · '+spec.theme)):undefined}>
        <span className="token-value-swatch" aria-hidden="true" hidden={!color} style={color?{backgroundColor:'rgba('+[color.red,color.green,color.blue,color.alpha/255].join(', ')+')'}:undefined}/>
        <span className="token-value-name">{name}</span><span className={'token-value-resolved'+(resolved?.error?' is-invalid':'')}>{resultText}</span>
      </div>
      <Button {...propsFor(p,spec.direct.count)} ref={trigger} disabled={false} className="token-value-link" aria-haspopup="dialog" aria-expanded={open} aria-pressed={linked}
        aria-label={p.disabled?'Просмотреть дизайн-токен':linked?'Изменить привязку токена':'Привязать токен'} onClick={()=>{if(open)close(true);else{setSearch('');setOpen(true);}}}><Link2 size={14} aria-hidden="true"/></Button>
    </div>
    <div ref={popover} className="token-value-popover" hidden={!open} role="dialog" aria-label={spec.label+' — дизайн-токены'}>
      <TextInput ref={searchRef} type="search" className="token-value-search" placeholder="Поиск токена" aria-label="Поиск токена" value={search} onChange={event=>setSearch(event.currentTarget.value)}/>
      <div className="token-value-choices">
        {!matches.length&&<p className="token-value-empty">{compatible.length?'По запросу токены не найдены.':'Нет совместимых токенов.'}</p>}
        {matches.map(token=>{const result=spec.resolve(token.id),invalid=Boolean(spec.validateChoices&&result.error);return <Button key={token.id} className="token-value-option" data-invalid={String(invalid)} disabled={p.disabled||invalid} aria-pressed={linked&&token.id===tokenId}
          onClick={()=>{close(true);onEdit(['token',literal??null,token.id],'discrete');}}><span className="token-value-option-name">{token.name}</span><small className="token-value-option-preview">{result.error??tokenValueText(result.value)}</small></Button>;})}
      </div>
      <Button className="token-value-unlink" hidden={!linked||p.disabled} onClick={()=>{if(!linked||p.disabled)return;const result=spec.resolve(tokenId);close(true);onEdit([spec.mode,spec.direct.resolvedRaw?.(result)??'', ''],'discrete');}}>Отвязать токен</Button>
    </div>
  </div>;
}
export function ValueEditor(p:EditorProps){
  const {spec,raw,onEdit}=p,values=rawArray(raw);
  switch(spec.kind){
    case 'scalar':return <ScalarEditor {...p} spec={spec}/>;
    case 'color':return <ColorEditor {...p} spec={spec}/>;
    case 'reference':return <ReferenceEditor {...p} spec={spec}/>;
    case 'weight':{
      const mode=rawText(values[0]),value=rawText(values[1]);
      return <><Labeled label={spec.label}><select {...propsFor(p)} aria-label={spec.label+' — пресет'} value={mode} onChange={e=>{const mode=e.currentTarget.value;onEdit([mode,mode==='Custom'?value:String(weightPresets[mode]??400)],'discrete');}}>
        {['Normal','Medium','Semibold','Bold','Custom'].map(v=><option key={v} value={v}>{v==='Custom'?'Числовое значение':v}</option>)}</select></Labeled>
        <NumberInput {...propsFor(p,1)} aria-label={spec.label+' — числовое значение'} hidden={mode!=='Custom'} min={1} max={1000} step={1} required value={value} onChange={e=>onEdit([mode,e.currentTarget.value],'input')} onBlur={e=>onEdit([mode,e.currentTarget.value],'commit')}/></>;
    }
    case 'shadow':return <><div className="shadow-geometry">{shadowDimensions.map(([,label,min,max],index)=><Labeled key={label} label={label}><NumberInput {...propsFor(p,index)} aria-label={'Drop shadow '+label} min={min} max={max} required step="any" value={rawText(values[index])} onChange={e=>onEdit(replace(raw,index,e.currentTarget.value),'input')} onBlur={e=>onEdit(replace(raw,index,e.currentTarget.value),'commit')}/></Labeled>)}</div>
      <ValueEditor {...childProps(p,spec.color,spec.nestedColor?values[4]??null:values.slice(4),4,(next,kind)=>onEdit([...values.slice(0,4),...(spec.nestedColor?[next]:rawArray(next))],kind))}/></>;
    case 'token-scalar':{
      const value=rawText(raw);
      return <div className="token-scalar-direct">
        {spec.color&&<input {...propsFor(p,1)} type="color" aria-label={'Выбрать цвет '+spec.label} value={/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)?value.slice(0,7):'#000000'}
          onChange={e=>onEdit(e.currentTarget.value+(/^#[0-9a-f]{8}$/i.test(value)?value.slice(7):'FF'),nativeColorEvent(e))}/>}
        {spec.weight&&<select {...propsFor(p,1)} aria-label={'Пресет толщины '+spec.label} value={['400','500','600','700'].includes(value)?value:''} onChange={e=>{if(e.currentTarget.value)onEdit(e.currentTarget.value,'discrete');}}>
          {[['','Custom'],['400','Normal'],['500','Medium'],['600','Semibold'],['700','Bold']].map(([v,name])=><option key={v} value={v}>{name}</option>)}</select>}
        <TextInput {...propsFor(p)} id={spec.inputId} autoComplete="off" aria-label={spec.inputId.startsWith('token-')?spec.label+' — значение токена':spec.label} placeholder={spec.color?'#RRGGBBAA':undefined}
          value={value} onChange={e=>onEdit(e.currentTarget.value,'input')} onBlur={e=>onEdit(e.currentTarget.value,'commit')} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.blur();}}}/>
      </div>;
    }
    case 'composite':{
      let offset=0;return <div className="token-composite-direct" id={spec.id}>{spec.children.map((child,index)=>{const start=offset;offset+=child.count;return <ValueEditor key={index} {...childProps(p,child,values[index]??null,start,(next,kind)=>onEdit(replace(raw,index,next),kind))}/>;})}</div>;
    }
  }
}
export function FieldValue({field,displayLabel,describedBy}:{field:ValueField;displayLabel?:string;describedBy?:string}){
  const state=useSyncExternalStore(field.store.subscribe,field.store.getSnapshot);
  return <ValueEditor spec={field.spec} raw={state.raw} disabled={state.disabled} ids={Array.from({length:field.spec.count},(_,i)=>field.inputId(i))}
    invalid={state.validation.error?state.validation.index:undefined} displayLabel={displayLabel} describedBy={describedBy} onEdit={field.edit}/>;
}
