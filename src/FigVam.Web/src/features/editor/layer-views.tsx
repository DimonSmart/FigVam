import type { ReactElement } from 'react';
import { Button } from '../../ui/Button';
import { TextInput } from '../../ui/Inputs';
import { createViewModel } from '../../app/view-model';
import { ChevronDown, ChevronRight, ArrowUpRight } from 'lucide-react';
import { layerDisplayName, type LayerCaptionSource } from '../../core/layer-caption';
export interface LayerItem extends LayerCaptionSource {id:string;parentId:string;childCount:number;canContainChildren?:boolean}
export type MetadataKind='name'|'key';
const layerKindIcons: Record<string,string> = { Frame: '▣', Container: '▣', Text: 'T', Button: '▭', TextInput: '▤', Image: '▧' };

interface LayerTreeProps {
  layerRoots: LayerItem[];
  layerChildren: ReadonlyMap<string, LayerItem[]>;
  layerExpanded: ReadonlySet<string>;
  interactiveNodes: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  focus: string | undefined;
  onSelect(id: string, row: HTMLElement | null, toggle?:boolean): void;
}

function LayerTree({layerRoots,layerChildren,layerExpanded,interactiveNodes,selectedIds,focus,onSelect}: LayerTreeProps) {
    function renderBranch(items: LayerItem[]): ReactElement[] {
      return items.map((item, index) => {
        const {text: name, source, origin} = layerDisplayName(item);
        const expanded = layerExpanded.has(item.id);
        const interactive = interactiveNodes.has(item.id);
        return <div key={item.id} role="treeitem" data-id={item.id} tabIndex={focus === item.id ? 0 : -1}
          aria-posinset={index + 1} aria-setsize={items.length}
          aria-selected={selectedIds.has(item.id)} aria-expanded={item.childCount ? expanded : undefined}
          aria-label={name + ', ' + item.kind + (interactive ? ', есть взаимодействия' : '')}>
          <span className="layer-label" title={name + ' · ' + item.kind + ' · ' + origin} onClick={event => onSelect(item.id, event.currentTarget.closest<HTMLElement>('[role=treeitem]'),event.ctrlKey||event.metaKey||event.shiftKey)}>
            <span className="layer-disclosure" aria-hidden="true">{item.childCount ? (expanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>) : ''}</span>
            <span className="layer-kind-icon" aria-hidden="true" title={item.kind}>{layerKindIcons[item.kind] ?? '◇'}</span>
            <span className="layer-name" data-label-source={source}>{name}</span>
            {interactive && <span className="layer-interaction" title="Есть взаимодействия" aria-hidden="true"><ArrowUpRight size={12}/></span>}
          </span>
          {item.childCount > 0 && expanded && <div role="group">{renderBranch(layerChildren.get(item.id) ?? [])}</div>}
        </div>;
      });
    }
  return <>{renderBranch(layerRoots)}</>;
}
interface MetadataViewProps {
  visible: boolean; readOnly: boolean; name: string; keyValue: string; status: string; error: string; retryHidden: boolean;
  change(kind:MetadataKind,value:string):void; submit(kind:MetadataKind):void; cancel(kind:MetadataKind):void; retry():void;
}
function MetadataView(p:MetadataViewProps) {
  return <div id="node-metadata" hidden={!p.visible}>
    <p id="node-metadata-status" role="status">{p.status}</p>
    <p id="node-metadata-error" role="alert">{p.error}</p>
    {(['name','key'] as const).map(kind=><form key={kind} id={'node-'+kind+'-form'} onSubmit={event=>{event.preventDefault();p.submit(kind);}}>
      <label>{kind==='name'?'Имя слоя ':'Semantic key '}
        <TextInput id={'node-'+kind} maxLength={256} aria-describedby={kind==='key'?'node-key-help':undefined}
          value={kind==='name'?p.name:p.keyValue} readOnly={p.readOnly}
          onChange={event=>p.change(kind,event.currentTarget.value)} onBlur={()=>p.submit(kind)}
          onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(event.key==='Enter'){event.preventDefault();p.submit(kind);}else if(event.key==='Escape')p.cancel(kind);}}/>
      </label>
      {kind==='key'&&<p id="node-key-help">Пустое значение удаляет semantic key.</p>}
    </form>)}
    <Button id="node-metadata-retry" type="button" hidden={p.retryHidden} onClick={p.retry}>Повторить неподтверждённую команду</Button>
  </div>;
}
function LayerDeletion(p:{hidden:boolean;disabled:boolean;retryHidden:boolean;status:string;remove():void;retry():void}) {
  return <><Button id="node-delete" type="button" hidden={p.hidden} disabled={p.disabled} onClick={p.remove}>Удалить слой</Button>
    <p id="node-delete-status" role="alert">{p.status}</p><Button id="node-delete-retry" type="button" hidden={p.retryHidden} onClick={p.retry}>Повторить удаление слоя</Button></>;
}
function LayerOrder(p:{retryHidden:boolean;status:string;retry():void}) {
  return <><p id="node-order-status" role="status" tabIndex={-1}>{p.status}</p>
    <Button id="node-order-retry" type="button" hidden={p.retryHidden} onClick={p.retry}>Повторить перемещение слоя</Button></>;
}
export function createLayersModel() {
  return {...createViewModel(LayerTree), metadata:createViewModel(MetadataView), deletion:createViewModel(LayerDeletion), order:createViewModel(LayerOrder),
    status:createViewModel(({text}:{text:string})=><p id="layers-status" role="status" aria-live="polite">{text}</p>),
    caption:createViewModel(({text}:{text:string})=><p id="inspector-selection">{text}</p>)};
}

