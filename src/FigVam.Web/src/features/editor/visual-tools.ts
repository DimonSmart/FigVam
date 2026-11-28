import type { NodePropertyValue } from '../../core/tokens/token-model';
import type { CanvasModel, CanvasNode, Bounds, NodeProperties, PropertyDefinitions } from '../../canvas/canvas-model';
import { inheritedLock, selectionRoots, proportionalSize } from '../../canvas/visual-geometry';
import type { NodeEdit } from './node-command';
export type AlignAction='left'|'right'|'top'|'bottom'|'centerX'|'centerY'|'distributeX'|'distributeY';
export type VisualAction=AlignAction|'group'|'ungroup'|'copy'|'paste';
const num=(value:number)=>({type:'number' as const,value});
const bool=(value:boolean)=>({type:'boolean' as const,value});
const scalar=(model:CanvasModel,node:CanvasNode,name:string)=>{const v=node.properties[name]??model.kinds.get(node.kind)?.properties[name]?.defaultValue;return v&&'value' in v?v.value:undefined;};
function free(model:CanvasModel,id:string){const parent=model.nodes.get(id);return !parent||scalar(model,parent,'layout')==='Free';}
function rotation(model:CanvasModel,node:CanvasNode){return Number(scalar(model,node,'rotation')??0)*Math.PI/180;}
function rotate(x:number,y:number,angle:number):[number,number]{
  return [x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)];
}
function bounds(model:CanvasModel,node:CanvasNode,screenSpace=false):Bounds|null{
  const b=model.boxes.get(node.id)?.bounds;if(!b)return null;
  let corners:[[number,number],[number,number],[number,number],[number,number]]=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]];
  const visited=new Set<string>();
  for(let current:CanvasNode|undefined=node;current&&!visited.has(current.id);current=screenSpace?model.nodes.get(current.parentId):undefined){
    visited.add(current.id);
    const pivot=model.boxes.get(current.id)?.bounds;if(!pivot)return null;
    const angle=rotation(model,current);
    corners=corners.map(([x,y])=>{const [dx,dy]=rotate(x-pivot.x,y-pivot.y,angle);return [pivot.x+dx,pivot.y+dy];}) as typeof corners;
  }
  const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]);
  return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
}
function parentRotation(model:CanvasModel,node:CanvasNode){
  let angle=0;const visited=new Set<string>();
  for(let parent=model.nodes.get(node.parentId);parent&&!visited.has(parent.id);parent=model.nodes.get(parent.parentId)){
    visited.add(parent.id);angle+=rotation(model,parent);
  }
  return angle;
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
  if(!nodes.length||nodes.some(n=>!free(model,n.parentId)||inheritedLock(model,n.id)||!model.boxes.get(n.id)))return [];
  const screenSpace=nodes.length>1;
  const horizontal=['left','right','centerX','distributeX'].includes(action);
  const axis=horizontal?'x':'y',size=horizontal?'width':'height';
  const items=nodes.flatMap(node=>{const b=bounds(model,node,screenSpace),x=scalar(model,node,'x'),y=scalar(model,node,'y');return b&&typeof x==='number'&&typeof y==='number'?[{node,b,x,y}]:[];});
  if(items.length!==nodes.length||!items.length)return [];
  const first=items[0];if(!first)return [];
  const edits:NodeEdit[]=[];
  let invalid=false;
  const push=(item:typeof first,delta:number)=>{
    if(Math.abs(delta)<=1e-7)return;
    const [dx,dy]=rotate(horizontal?delta:0,horizontal?0:delta,screenSpace?-parentRotation(model,item.node):0);
    const properties:NodeProperties={},defs=model.kinds.get(item.node.kind)?.properties;
    for(const [name,change] of [['x',dx],['y',dy]] as const){
      if(Math.abs(change)<=1e-7)continue;
      const value=Math.round((item[name]+change)*1e6)/1e6;
      if(value<(defs?.[name]?.minimum??-Infinity)||value>(defs?.[name]?.maximum??Infinity)){invalid=true;return;}
      properties[name]=num(value);
    }
    if(Object.keys(properties).length)edits.push({action:'set',nodeId:item.node.id,expectedParentId:item.node.parentId,properties});
  };
  if(action.startsWith('distribute')){
    if(items.length<3)return [];
    items.sort((a,b)=>a.b[axis]-b.b[axis]);
    const start=items[0],end=items.at(-1);if(!start||!end)return [];
    const gap=(end.b[axis]+end.b[size]-start.b[axis]-items.reduce((sum,item)=>sum+item.b[size],0))/(items.length-1);
    let cursor=start.b[axis]+start.b[size]+gap;
    for(const item of items.slice(1,-1)){push(item,cursor-item.b[axis]);cursor+=item.b[size]+gap;}
    return invalid?[]:edits;
  }
  const parent=model.boxes.get(first.node.parentId)?.bounds;
  if(items.length===1&&!parent)return [];
  const low=items.length===1&&parent?parent[axis]:Math.min(...items.map(i=>i.b[axis]));
  const high=items.length===1&&parent?parent[axis]+parent[size]:Math.max(...items.map(i=>i.b[axis]+i.b[size]));
  const fraction=action==='left'||action==='top'?0:action==='right'||action==='bottom'?1:0.5;
  for(const item of items)push(item,low+(high-low)*fraction-item.b[axis]-item.b[size]*fraction);
  return invalid?[]:edits;
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
    const properties=Object.fromEntries(Object.entries(source.values).filter(([name,value])=>{
      const def=defs[name];if(!compatible(name)||!value||!def)return false;
      if(value.type==='number'&&(value.value<(def.minimum??-Infinity)||value.value>(def.maximum??Infinity)))return false;
      if(value.type==='enum'&&def.enumValues&&!def.enumValues.includes(value.value))return false;
      if(value.type==='string'&&def.maxLength!=null&&value.value.length>def.maxLength)return false;
      return JSON.stringify(value)!==JSON.stringify(node.properties[name]);
    }));
    const removeProperties=source.absent.filter(name=>compatible(name)&&node.properties[name]!==undefined&&!defs[name]?.required);
    const ops:NodeEdit[]=[];
    if(removeProperties.length)ops.push({action:'remove',nodeId:id,removeProperties});
    if(Object.keys(properties).length)ops.push({action:'set',nodeId:id,properties});
    return ops;
  });
}
// A variant can override a value or inherit it; it cannot erase a base property.
export function pasteVariantAppearance(model:CanvasModel,ids:readonly string[],source:AppearanceClipboard,overridden:ReadonlyMap<string,ReadonlySet<string>>,screenId:string,variantId:string):NodeEdit[]{
  const baseNodes=new Map(model.orderedNodes.map(node=>[node.id,node]));
  const result:NodeEdit[]=[];
  for(const op of pasteAppearance(model,ids,source)){
    if(op.action==='remove'){
      const base=baseNodes.get(op.nodeId);
      const removeProperties=(op.removeProperties??[]).filter(name=>base?.properties[name]===undefined&&overridden.get(op.nodeId)?.has(name));
      if(removeProperties.length)result.push({...op,removeProperties,screenId,variantId});
    }else if(op.action==='set'){
      // Do not introduce a style reference that would be masked by unremovable base overrides.
      const base=baseNodes.get(op.nodeId),properties={...op.properties};
      const blocked=(names:Set<string>)=>[...names].some(name=>source.absent.includes(name)&&base?.properties[name]!==undefined);
      if(blocked(textStyleFields)){delete properties.textStyle;delete properties.typography;}
      if(blocked(borderStyleFields))delete properties.borderStyle;
      if(Object.keys(properties).length)result.push({...op,properties,screenId,variantId});
    }
  }
  return result;
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

type PropertyModel = Pick<CanvasModel,'nodes'|'kinds'>;
function effective(model:PropertyModel,node:CanvasNode,name:string){
  return node.properties[name]??model.kinds.get(node.kind)?.properties[name]?.defaultValue;
}
export function commonPropertyEligible(model:PropertyModel,node:CanvasNode,name:string):boolean {
  if(['editorGroup','editorLocked'].includes(name))return false;
  if(name==='x'||name==='y'){
    const parent=model.nodes.get(node.parentId);
    if(parent){const layout=effective(model,parent,'layout');if(layout?.type!=='enum'||layout.value!=='Free')return false;}
  }
  if(['x','y','width','height'].includes(name)&&effective(model,node,name)?.type==='token')return false;
  if(name==='width'||name==='height'){
    const lock=effective(model,node,'aspectRatioLocked');
    if(lock?.type==='boolean'&&lock.value){
      const w=effective(model,node,'width'),h=effective(model,node,'height');
      if(w?.type!=='number'||h?.type!=='number'||w.value<=0||h.value<=0)return false;
    }
  }
  return true;
}
export function commonPropertyEdit(model:PropertyModel,ids:readonly string[],name:string,value:NodePropertyValue):NodeEdit[]{
  const ops:NodeEdit[]=[];
  for(const nodeId of ids){
    const node=model.nodes.get(nodeId),defs=node&&model.kinds.get(node.kind)?.properties;
    if(!node||!defs?.[name]||inheritedLock(model,nodeId)||!commonPropertyEligible(model,node,name))return [];
    const properties:NodeProperties={[name]:value};
    const lock=effective(model,node,'aspectRatioLocked');
    if((name==='width'||name==='height')&&lock?.type==='boolean'&&lock.value){
      const w=effective(model,node,'width'),h=effective(model,node,'height');
      if(w?.type!=='number'||h?.type!=='number'||value.type!=='number')return [];
      const range=(key:string)=>({min:defs[key]?.minimum??0,max:defs[key]?.maximum??Infinity});
      const size=proportionalSize(w.value,h.value,name==='width'?value.value-w.value:0,name==='height'?value.value-h.value:0,range('width'),range('height'));
      if(!size||Math.abs(size[name==='width'?0:1]-value.value)>1e-6)return [];
      properties[name==='width'?'height':'width']=num(size[name==='width'?1:0]);
    }
    ops.push({action:'set',nodeId,properties,...(['x','y'].includes(name)?{expectedParentId:node.parentId}:{})});
  }
  return ops;
}
