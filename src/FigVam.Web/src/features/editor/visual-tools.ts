import type { CanvasModel, CanvasNode, Bounds, NodeProperties, PropertyDefinitions } from '../../canvas/canvas-model';
import { inheritedLock, selectionRoots } from '../../canvas/visual-geometry';
import type { NodeEdit } from './node-command';
export type AlignAction='left'|'right'|'top'|'bottom'|'centerX'|'centerY'|'distributeX'|'distributeY';
export type VisualAction=AlignAction|'group'|'ungroup'|'copy'|'paste';
const num=(value:number)=>({type:'number' as const,value});
const bool=(value:boolean)=>({type:'boolean' as const,value});
const scalar=(model:CanvasModel,node:CanvasNode,name:string)=>{const v=node.properties[name]??model.kinds.get(node.kind)?.properties[name]?.defaultValue;return v&&'value' in v?v.value:undefined;};
function free(model:CanvasModel,id:string){const parent=model.nodes.get(id);return !parent||scalar(model,parent,'layout')==='Free';}
function bounds(model:CanvasModel,node:CanvasNode):Bounds|null{
  const b=model.boxes.get(node.id)?.bounds;if(!b)return null;
  const r=Number(scalar(model,node,'rotation')??0)*Math.PI/180;
  const xs=[0,b.width*Math.cos(r),-b.height*Math.sin(r),b.width*Math.cos(r)-b.height*Math.sin(r)];
  const ys=[0,b.width*Math.sin(r),b.height*Math.cos(r),b.width*Math.sin(r)+b.height*Math.cos(r)];
  return {x:b.x+Math.min(...xs),y:b.y+Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
}
function selection(model:CanvasModel,ids:readonly string[]):CanvasNode[]{
  const roots=new Set(selectionRoots(model,ids));
  return model.orderedNodes.filter(node=>roots.has(node.id)).map(node=>model.nodes.get(node.id)??node);
}
function eligible(model:CanvasModel,nodes:CanvasNode[]){
  const first=nodes[0];
  return !!first&&free(model,first.parentId)&&nodes.every(n=>n.parentId===first.parentId&&!inheritedLock(model,n.id)&&!!model.boxes.get(n.id));
}
export function alignment(model:CanvasModel,ids:readonly string[],action:AlignAction):NodeEdit[]{
  const nodes=selection(model,ids);
  if(!eligible(model,nodes))return [];
  const horizontal=['left','right','centerX','distributeX'].includes(action);
  const axis=horizontal?'x':'y',size=horizontal?'width':'height';
  const items=nodes.flatMap(node=>{const b=bounds(model,node),value=scalar(model,node,axis);return b&&typeof value==='number'?[{node,b,value}]:[];});
  if(items.length!==nodes.length||!items.length)return [];
  const first=items[0];if(!first)return [];
  const edits:NodeEdit[]=[];
  const push=(item:typeof first,delta:number)=>{if(Math.abs(delta)>1e-7)edits.push({action:'set',nodeId:item.node.id,expectedParentId:item.node.parentId,properties:{[axis]:num(item.value+delta)}});};
  if(action.startsWith('distribute')){
    if(items.length<3)return [];
    items.sort((a,b)=>a.b[axis]-b.b[axis]);
    const start=items[0],end=items.at(-1);if(!start||!end)return [];
    const gap=(end.b[axis]+end.b[size]-start.b[axis]-items.reduce((sum,item)=>sum+item.b[size],0))/(items.length-1);
    let cursor=start.b[axis]+start.b[size]+gap;
    for(const item of items.slice(1,-1)){push(item,cursor-item.b[axis]);cursor+=item.b[size]+gap;}
    return edits;
  }
  const parent=model.boxes.get(first.node.parentId)?.bounds;
  if(items.length===1&&!parent)return [];
  const low=items.length===1&&parent?parent[axis]:Math.min(...items.map(i=>i.b[axis]));
  const high=items.length===1&&parent?parent[axis]+parent[size]:Math.max(...items.map(i=>i.b[axis]+i.b[size]));
  const fraction=action==='left'||action==='top'?0:action==='right'||action==='bottom'?1:0.5;
  for(const item of items)push(item,low+(high-low)*fraction-item.b[axis]-item.b[size]*fraction);
  return edits;
}
const appearance=new Set(['backgroundColor','linearGradient','borderWidth','borderColor','borderPattern','borderStyle','cornerRadius','radiusTopLeft','radiusTopRight','radiusBottomRight','radiusBottomLeft','opacity','shadow','textStyle','typography','fontFamily','fontSize','fontWeight','fontStyle','fontFallback','lineHeight','letterSpacing','textColor','textAlignment','strokeColor','strokeWidth','focusBorderColor','focusBorderWidth','placeholderColor','startArrow','endArrow','imageClip','fit']);
const textStyleFields=new Set(['textColor','fontFamily','fontSize','fontWeight','fontStyle','fontFallback','lineHeight','letterSpacing']);
const borderStyleFields=new Set(['borderColor','borderWidth','cornerRadius','borderPattern','radiusTopLeft','radiusTopRight','radiusBottomRight','radiusBottomLeft']);
export interface AppearanceClipboard {values:NodeProperties;absent:string[];definitions:PropertyDefinitions}
export function copyAppearance(model:CanvasModel,id:string):AppearanceClipboard {
  const node=model.nodes.get(id),defs=node&&model.kinds.get(node.kind)?.properties;
  const values:NodeProperties={},absent:string[]=[];
  if(node&&defs)for(const name of appearance){
    const def=defs[name];if(!def)continue;
    const styled=textStyleFields.has(name)&&(node.properties.textStyle?.type==='style'||(name!=='textColor'&&node.properties.typography?.type==='token'))||borderStyleFields.has(name)&&node.properties.borderStyle?.type==='style';
    const value=node.properties[name]??(styled?undefined:def.defaultValue);
    if(value)values[name]=value;else absent.push(name);
  }
  return {values,absent,definitions:defs??{}};
}
export function pasteAppearance(model:CanvasModel,ids:readonly string[],source:AppearanceClipboard):NodeEdit[]{
  return ids.flatMap(id=>{const node=model.nodes.get(id),defs=node&&model.kinds.get(node.kind)?.properties;
    if(!node||!defs||inheritedLock(model,id))return [];
    const compatible=(name:string)=>{const a=source.definitions[name],b=defs[name];return !!a&&!!b&&a.type===b.type&&a.tokenType===b.tokenType&&a.tokenCategory===b.tokenCategory&&a.styleType===b.styleType;};
    const properties=Object.fromEntries(Object.entries(source.values).filter(([name,value])=>compatible(name)&&value!==undefined&&JSON.stringify(value)!==JSON.stringify(node.properties[name])));
    const removeProperties=source.absent.filter(name=>compatible(name)&&node.properties[name]!==undefined&&!defs[name]?.required);
    const ops:NodeEdit[]=[];
    if(removeProperties.length)ops.push({action:'remove',nodeId:id,removeProperties});
    if(Object.keys(properties).length)ops.push({action:'set',nodeId:id,properties});
    return ops;
  });
}
export function grouping(model:CanvasModel,ids:readonly string[],groupId:string):NodeEdit[]{
  const nodes=selection(model,ids);const first=nodes[0];
  if(!first||nodes.length<2||!eligible(model,nodes))return [];
  const siblings=model.orderedNodes.filter(n=>n.parentId===first.parentId),index=siblings.findIndex(n=>n.id===first.id);
  if(index<0||nodes.some((n,i)=>siblings[index+i]?.id!==n.id))return [];
  const entries=nodes.flatMap(node=>{const x=scalar(model,node,'x'),y=scalar(model,node,'y'),b=model.boxes.get(node.id)?.bounds;return typeof x==='number'&&typeof y==='number'&&b?[{node,x,y,b}]:[];});
  if(entries.length!==nodes.length)return [];
  const x=Math.min(...entries.map(e=>e.x)),y=Math.min(...entries.map(e=>e.y));
  const w=Math.max(...entries.map(e=>e.x+e.b.width))-x,h=Math.max(...entries.map(e=>e.y+e.b.height))-y;
  const ops:NodeEdit[]=[{action:'add',nodeId:groupId,parentId:first.parentId,kind:'Frame',name:'Group',properties:{editorGroup:bool(true),x:num(x),y:num(y),width:num(w),height:num(h)}},
    {action:'move',nodeId:groupId,expectedParentId:first.parentId,parentId:first.parentId,position:index}];
  entries.forEach((e,i)=>{ops.push({action:'move',nodeId:e.node.id,expectedParentId:first.parentId,parentId:groupId,position:i},{action:'set',nodeId:e.node.id,expectedParentId:groupId,properties:{x:num(e.x-x),y:num(e.y-y)}});});
  return ops;
}
export function ungrouping(model:CanvasModel,id:string):NodeEdit[]{
  const group=model.nodes.get(id);
  if(!group||group.kind!=='Frame'||scalar(model,group,'editorGroup')!==true||!eligible(model,[group])||!free(model,id)||scalar(model,group,'rotation')!==0)return [];
  if(Object.keys(group.properties).some(name=>!['editorGroup','x','y','width','height','layout','rotation'].includes(name)))return [];
  const x=scalar(model,group,'x'),y=scalar(model,group,'y');
  if(typeof x!=='number'||typeof y!=='number')return [];
  const siblings=model.orderedNodes.filter(n=>n.parentId===group.parentId),index=siblings.findIndex(n=>n.id===id);
  const children=model.orderedNodes.filter(n=>n.parentId===id),ops:NodeEdit[]=[];
  if(index<0)return [];
  for(const [i,raw] of children.entries()){
    const child=model.nodes.get(raw.id)??raw,cx=scalar(model,child,'x'),cy=scalar(model,child,'y');
    if(typeof cx!=='number'||typeof cy!=='number'||inheritedLock(model,child.id))return [];
    ops.push({action:'move',nodeId:child.id,expectedParentId:id,parentId:group.parentId,position:index+i},{action:'set',nodeId:child.id,expectedParentId:group.parentId,properties:{x:num(x+cx),y:num(y+cy)}});
  }
  return [...ops,{action:'delete',nodeId:id}];
}
