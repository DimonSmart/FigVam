import { Fragment } from 'react';
import { Button } from './Button';

interface Usage {
  kind: string; ownerId: string; label?: string | null; property?: string | null;
  theme?: string | number | null; indirect?: boolean; chain?: readonly string[];
}
export function ResourceUsages({ usages, ready = true, name, selectLayer }: {
  usages: readonly Usage[]; ready?: boolean; name(id:string):string; selectLayer(id:string):void;
}) {
  if (!usages.length) return ready ? <li>Использований нет.</li> : null;
  return <>{[false,true].map(indirect=>{
    const entries=usages.filter(usage=>Boolean(usage.indirect)===indirect);
    return entries.length ? <Fragment key={String(indirect)}>
      <li className="resource-usage-group">{indirect?'Косвенные':'Прямые'} · {entries.length}</li>
      {entries.map((usage,index)=><li key={usage.kind+':'+usage.ownerId+':'+index} title={(usage.chain??[]).map(name).join(' → ')}>
        {[usage.label??usage.kind,usage.property,usage.theme==null?null:'тема '+usage.theme].filter(value=>value!=null).join(' · ')}
        {usage.kind==='nodeProperty' && <> <Button onClick={()=>selectLayer(usage.ownerId)}>К слою</Button></>}
      </li>)}
    </Fragment> : null;
  })}</>;
}
