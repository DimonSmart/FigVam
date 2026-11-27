import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ReactNode } from 'react';
import type { ControlDefinition, PropertyModel } from '../src/ui/property-control-contract';
import type { NodePropertyValue } from '../src/core/tokens/token-model';
import { createNodeValueSpec, createValueField, type ValueField } from '../src/ui/property-value';
import { PaddingEditor, PropertyFields, paddingProperties } from '../src/ui/property-layout';

export { paddingProperties };
export const commit=flushSync;
export function createTestField(name:string,definition:ControlDefinition,model:PropertyModel,value:NodePropertyValue|undefined,prefix:string){
  return createValueField(createNodeValueSpec(name,definition,model,value,prefix),prefix+'-'+name,{validateInitial:value?.type==='token'});
}
function mount(view:ReactNode){
  const host=document.createElement('div');document.body.append(host);
  const root=createRoot(host);flushSync(()=>root.render(view));
  return {host,dispose(){root.unmount();host.remove();}};
}
export function mountFields(fields:ValueField[]){
  return mount(<PropertyFields entries={fields.map(field=>({name:field.id,field}))} inspector={false}/>);
}
export function mountPadding(fields:ReadonlyMap<string,ValueField>){
  return mount(<PaddingEditor fields={new Map([...fields].map(([name,field])=>[name,{name,field}]))}/>);
}
