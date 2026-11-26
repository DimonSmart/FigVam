import { requiredRecord, text, array } from '../api/decode';
import { normalizedTokenType, normalizedTokenCategory } from '../core/tokens/token-resolution';
import type { ColorChannels, DesignToken, NodePropertyValue, PropertyDefinition, ShadowValue, Theme, TokenExpression, TokenValue } from '../core/tokens/token-model';
import type { Bounds, CanvasNode, CanvasKind, LayoutBox, NodeProperties } from './canvas-model';
import type { RenderModel } from './screen-renderer';

export function number(value:unknown):number {
  if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError('Invalid numeric field in render model');
  return value;
}
function bool(value:unknown):boolean {
  if(typeof value!=='boolean')throw new TypeError('Invalid boolean field in render model');
  return value;
}
export function readTheme(value:unknown):Theme {
  if(value!=='Light'&&value!=='Dark')throw new TypeError('Invalid document theme');
  return value;
}
function color(value:unknown):ColorChannels {
  const c=requiredRecord(value);return {red:number(c.red),green:number(c.green),blue:number(c.blue),alpha:number(c.alpha)};
}
function shadow(value:Record<string,unknown>):ShadowValue {
  return {type:'shadow',offsetX:number(value.offsetX),offsetY:number(value.offsetY),blurRadius:number(value.blurRadius),spreadRadius:number(value.spreadRadius),color:color(value.color)};
}
function expression(value:unknown):TokenExpression {
  const v=requiredRecord(value);
  if(v.expression==='alias')return {expression:'alias',tokenId:text(v.tokenId)};
  if(v.expression==='literal')return {expression:'literal',value:tokenValue(v.value)};
  throw new TypeError('Invalid token expression');
}
function tokenValue(value:unknown):TokenValue {
  const v=requiredRecord(value);
  switch(v.type){
    case 'color':return {type:'color',...color(v)};
    case 'shadow':return shadow(v);
    case 'spacing':case 'dimension':case 'number':case 'fontWeight':return {type:v.type,value:number(v.value)};
    case 'fontFamily':return {type:'fontFamily',value:text(v.value)};
    case 'geometry':return {type:'geometry',radius:number(v.radius)};
    case 'typography':return {type:'typography',fontFamily:text(v.fontFamily),fontSize:number(v.fontSize),fontWeight:number(v.fontWeight),lineHeight:number(v.lineHeight),letterSpacing:v.letterSpacing==null?undefined:number(v.letterSpacing)};
    case 'typographyFields':return {type:'typographyFields',fontFamily:expression(v.fontFamily),fontSize:expression(v.fontSize),fontWeight:expression(v.fontWeight),lineHeight:expression(v.lineHeight),letterSpacing:v.letterSpacing==null?undefined:expression(v.letterSpacing)};
    default:throw new TypeError('Invalid token value');
  }
}
export function nodeProperty(value:unknown):NodePropertyValue {
  const v=requiredRecord(value);
  switch(v.type){
    case 'color':return {type:'color',...color(v)};
    case 'shadow':return shadow(v);
    case 'string':case 'enum':return {type:v.type,value:text(v.value)};
    case 'number':return {type:'number',value:number(v.value)};
    case 'boolean':return {type:'boolean',value:bool(v.value)};
    case 'token':return {type:'token',tokenId:text(v.tokenId)};
    case 'asset':return {type:'asset',assetId:text(v.assetId)};
    case 'style':return {type:'style',styleId:text(v.styleId)};
    case 'typography':return {type:'typography',value:tokenValue(v.value)};
    default:throw new TypeError('Invalid node property');
  }
}
export function properties(value:unknown):NodeProperties {
  return Object.fromEntries(Object.entries(requiredRecord(value)).map(([name,v])=>[name,nodeProperty(v)]));
}
function token(value:unknown):DesignToken {
  const v=requiredRecord(value),type=normalizedTokenType(v.type),category=normalizedTokenCategory(v.category),values=requiredRecord(v.values);
  if(type===null)throw new TypeError('Invalid token type');
  return {id:text(v.id),name:text(v.name),type,category,values:{Light:values.Light==null?undefined:expression(values.Light),Dark:values.Dark==null?undefined:expression(values.Dark)}};
}
function definition(value:unknown):PropertyDefinition {
  const v=requiredRecord(value);
  return {type:text(v.type),tokenType:normalizedTokenType(v.tokenType),tokenCategory:normalizedTokenCategory(v.tokenCategory),
    legacyTokenType:normalizedTokenType(v.legacyTokenType),minimum:v.minimum==null?null:number(v.minimum),
    maximum:v.maximum==null?null:number(v.maximum),maxLength:v.maxLength==null?null:number(v.maxLength),
    numericFontWeight:v.numericFontWeight===true,defaultValue:v.defaultValue==null?null:nodeProperty(v.defaultValue)};
}
function kind(value:unknown):CanvasKind & {kind:string} {
  const v=requiredRecord(value);
  return {kind:text(v.kind),semanticRole:text(v.semanticRole),canContainChildren:bool(v.canContainChildren),
    previewEvents:array(v.previewEvents,number),
    properties:Object.fromEntries(Object.entries(requiredRecord(v.properties)).map(([name,d])=>[name,definition(d)]))};
}
function bounds(value:unknown):Bounds {
  const v=requiredRecord(value);return{x:number(v.x),y:number(v.y),width:number(v.width),height:number(v.height)};
}
function box(value:unknown):LayoutBox & {objectId:string} {
  const v=requiredRecord(value);return{objectId:text(v.objectId),bounds:bounds(v.bounds),clip:v.clip==null?null:bounds(v.clip)};
}
function node(value:unknown):CanvasNode {
  const v=requiredRecord(value);
  return{id:text(v.id),name:v.name==null?undefined:text(v.name),kind:text(v.kind),parentId:text(v.parentId),properties:v.properties==null?{}:properties(v.properties)};
}
export function readRenderModel(value:unknown):RenderModel {
  const v=requiredRecord(value);
  const overrides=new Map(array(v.overrides??[],item=>{const r=requiredRecord(item);return [text(r.nodeId),properties(r.properties)] as const;}));
  return {screen:text(v.screen),theme:readTheme(v.theme),overrides,
    nodes:new Map(array(v.nodes,node).map(n=>[n.id,{...n,properties:{...n.properties,...overrides.get(n.id)}}])),
    boxes:new Map(array(v.boxes,box).map(b=>[b.objectId,b])),kinds:new Map(array(v.kinds,kind).map(k=>[k.kind,k])),
    assets:new Map(array(v.assets,item=>{const a=requiredRecord(item);return [text(a.id),a] as const;})),
    tokens:new Map(array(v.tokens,token).map(t=>[t.id,t]))};
}
