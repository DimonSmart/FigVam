import { useSyncExternalStore, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from './Button';
import { FieldValue } from './property-value-editor';
import { isGeometryField, propertyLabel, type ValueField } from './property-value';
import { createViewModel } from '../app/view-model';

const sides=[['top','paddingTop','Сверху','Отступ сверху'],['right','paddingRight','Справа','Отступ справа'],['bottom','paddingBottom','Снизу','Отступ снизу'],['left','paddingLeft','Слева','Отступ слева']] as const;
export const paddingProperties=sides.map(([,name])=>name);
export interface FieldPresentation {
  name:string;field:ValueField;variantOverride?:boolean;styleOverride?:boolean;
  resetVariant?():void;resetStyle?():void;onLeave?():void;onKey?(event:KeyboardEvent<HTMLDivElement>):void;
  shadow?:{active:boolean;toggle?:()=>void};
}
function PropertyRow({entry,displayLabel}:{entry:FieldPresentation;displayLabel?:string}){
  const {field,name}=entry,state=useSyncExternalStore(field.store.subscribe,field.store.getSnapshot);
  const feedbackId=field.id+'-validation';
  const row=<div className={'node-property'+(field.spec.kind==='reference'?' node-property--token':'')+(isGeometryField(name,field.spec)?' node-property--geometry':'')}
      data-variant-override={entry.variantOverride===undefined?undefined:String(entry.variantOverride)}
      data-style-override={entry.styleOverride===undefined?undefined:String(entry.styleOverride)}
      hidden={entry.shadow?!entry.shadow.active:undefined}
      onBlur={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))entry.onLeave?.();}}
      onKeyDown={entry.onKey}>
    <FieldValue field={field} displayLabel={displayLabel} describedBy={feedbackId}/>
    <p className="node-property-error" id={feedbackId} aria-live="polite">{state.validation.error??''}</p>
    {entry.resetStyle&&<Button className="style-override-reset" aria-label={'Сбросить к стилю: '+propertyLabel(name)} disabled={state.actionsDisabled} onClick={entry.resetStyle}>Сбросить к стилю</Button>}
    {entry.resetVariant&&<Button className="variant-override-reset" disabled={state.actionsDisabled} onClick={entry.resetVariant}>Reset Override</Button>}
  </div>;
  return entry.shadow?<section className="shadow-effects"><strong>Effects</strong>{row}<Button className="shadow-action" hidden={!entry.shadow.toggle} disabled={state.actionsDisabled} onClick={entry.shadow.toggle}>{entry.shadow.active?'Remove drop shadow':'Add drop shadow'}</Button></section>:row;
}
export function PaddingEditor({fields}:{fields:ReadonlyMap<string,FieldPresentation>}){
  const root=useRef<HTMLElement>(null);
  function focusSide(side:string){
    const slot=root.current?.querySelector<HTMLElement>('.padding-editor-field[data-side="'+side+'"]');
    const linked=slot?.querySelector('.token-value-layout.is-linked');
    const input=slot?.querySelector<HTMLInputElement>('input[type=number]:not(:disabled)');
    const target=!linked&&input&&!input.closest('[hidden]')?input:slot?.querySelector<HTMLElement>('.token-value-link:not(:disabled)');
    target?.focus({preventScroll:true});
  }
  return <section ref={root} className="padding-editor" aria-label="Внутренние отступы">
    <strong className="padding-editor-heading">Отступы</strong>
    <div className="padding-editor-grid">
      {sides.map(([side,name,short])=>{const entry=fields.get(name);return <div key={side} className="padding-editor-field" data-side={side}>{entry&&<PropertyRow entry={entry} displayLabel={short}/>}</div>;})}
      <div className="padding-editor-diagram"><span className="padding-editor-content" aria-hidden="true"/>
        {sides.map(([side,,,label])=><Button key={side} className="padding-editor-side" data-side={side} title={label} aria-label={'Перейти к полю: '+label} onClick={()=>focusSide(side)}/>)}
      </div>
    </div>
  </section>;
}
function GapRow({entry}:{entry:FieldPresentation}){
  return <div className="padding-gap-row"><span className="padding-gap-icon" aria-hidden="true"><i/><i/></span><PropertyRow entry={entry}/></div>;
}
export function PropertyFields({entries,inspector}:{entries:FieldPresentation[];inspector:boolean}){
  if(!inspector)return <>{entries.map(entry=><PropertyRow key={entry.name} entry={entry}/>)}</>;
  const fields=new Map(entries.map(entry=>[entry.name,entry])),grouped=new Set<string>(),layout:ReactNode[]=[];
  for(const names of [['x','y'],['width','height']] as const){
    const geometry=names.map(name=>fields.get(name)).filter((entry):entry is FieldPresentation=>!!entry&&isGeometryField(entry.name,entry.field.spec));
    if(geometry.length){geometry.forEach(entry=>grouped.add(entry.name));layout.push(<div key={names[0]} className="node-geometry-row" data-geometry-group={names[0]}>{geometry.map(entry=><PropertyRow key={entry.name} entry={entry}/>)}</div>);}
  }
  const hasPadding=paddingProperties.every(name=>fields.has(name));
  const firstPadding=hasPadding?entries.find(entry=>paddingProperties.some(name=>name===entry.name))?.name:null;
  if(hasPadding){paddingProperties.forEach(name=>grouped.add(name));if(fields.has('gap'))grouped.add('gap');}
  for(const entry of entries){
    if(entry.name===firstPadding){layout.push(<PaddingEditor key="padding" fields={fields}/>);const gap=fields.get('gap');if(gap)layout.push(<GapRow key="gap" entry={gap}/>);}
    if(!grouped.has(entry.name))layout.push(<PropertyRow key={entry.name} entry={entry}/>);
  }
  return <>{layout}</>;
}
export function createPropertyFieldModels(){return {required:createViewModel(PropertyFields),optional:createViewModel(PropertyFields),inspector:createViewModel(PropertyFields)};}
