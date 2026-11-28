import {describe,expect,it} from 'vitest';
import {alignment,grouping,ungrouping,copyAppearance,pasteAppearance} from '../src/features/editor/visual-tools';
import {selectionRoots,inheritedLock} from '../src/canvas/visual-geometry';
import type {CanvasModel,CanvasNode,CanvasKind,LayoutBox,NodeProperties} from '../src/canvas/canvas-model';

const number=(value:number)=>({type:'number' as const,value});
const bool=(value:boolean)=>({type:'boolean' as const,value});
const option=(value:string)=>({type:'enum' as const,value});
const make=(id:string,x:number,y:number,w:number,h:number,parentId='screen',properties:NodeProperties={},kind='Frame'):CanvasNode=>({id,parentId,kind,properties:{x:number(x),y:number(y),width:number(w),height:number(h),...properties}});
function model(nodes:CanvasNode[]):CanvasModel {
  const kinds=new Map<string,CanvasKind>([['Frame',{semanticRole:'Container',canContainChildren:true,previewEvents:[],properties:{
    layout:{type:'enum',defaultValue:option('Free')},rotation:{type:'number',defaultValue:number(0)},opacity:{type:'number',defaultValue:number(1)},
    backgroundColor:{type:'color',tokenType:'Color'},borderStyle:{type:'style'},text:{type:'string'},strokeWidth:{type:'number',maximum:100}
  }}],['Icon',{semanticRole:'Icon',canContainChildren:false,previewEvents:[],properties:{strokeWidth:{type:'number',maximum:8}}}]]);
  const boxes=new Map<string,LayoutBox>([['screen',{bounds:{x:0,y:0,width:400,height:300}}]]);
  const value=(node:CanvasNode,key:string)=>{const p=node.properties[key];return p?.type==='number'?p.value:0;};
  for(const node of nodes)boxes.set(node.id,{bounds:{x:value(node,'x'),y:value(node,'y'),width:value(node,'width'),height:value(node,'height')}});
  return {screen:'screen',revision:5,nodes:new Map(nodes.map(n=>[n.id,n])),orderedNodes:nodes,kinds,boxes,tokens:new Map()};
}
describe('visual edit planning',()=>{
  it('moves only selection roots and detects a locked ancestor',()=>{
    const m=model([make('a',0,0,50,50,'screen',{editorLocked:bool(true)}),make('b',10,10,20,20,'a')]);
    expect(selectionRoots(m,['a','b','a'])).toEqual(['a']);expect(inheritedLock(m,'b')).toBe(true);
  });
  it('uses actual widths for equal gaps without moving extremes',()=>{
    const m=model([make('a',0,0,20,10),make('b',40,0,40,10),make('c',140,0,30,10)]);
    expect(alignment(m,['a','b','c'],'distributeX')).toEqual([{action:'set',nodeId:'b',expectedParentId:'screen',properties:{x:number(60)}}]);
  });
  it('aligns one element with its parent and includes rotated corners',()=>{
    const m=model([make('a',10,20,40,20,'screen',{rotation:number(90)})]);
    expect(alignment(m,['a'],'left')[0]?.properties?.x).toEqual(number(20));
    expect(alignment(m,['a'],'centerY')[0]?.properties?.y).toEqual(number(130));
  });
  it('groups contiguous siblings and keeps their ids and relative positions',()=>{
    const m=model([make('a',10,20,30,40),make('b',50,60,20,10),make('c',100,100,10,10)]);
    const ops=grouping(m,['a','b'],'group');
    expect(ops).toHaveLength(6);expect(ops[0]?.properties).toMatchObject({x:number(10),y:number(20),width:number(60),height:number(50),editorGroup:bool(true)});
    expect(ops[3]).toMatchObject({nodeId:'a',properties:{x:number(0),y:number(0)}});
    expect(ops[5]).toMatchObject({nodeId:'b',properties:{x:number(40),y:number(40)}});
    expect(grouping(m,['a','c'],'group')).toEqual([]);
  });
  it('rejects structural edits in automatic layout',()=>{
    const m=model([make('p',0,0,200,100,'screen',{layout:option('Vertical')}),make('a',10,10,20,20,'p'),make('b',20,20,20,20,'p')]);
    expect(grouping(m,['a','b'],'group')).toEqual([]);expect(alignment(m,['a','b'],'left')).toEqual([]);
  });
  it('ungroups a free frame without changing child identities',()=>{
    const m=model([make('g',30,40,100,100,'screen',{editorGroup:bool(true)}),make('a',5,7,10,10,'g'),make('b',20,25,10,10,'g')]);
    const ops=ungrouping(m,'g');expect(ops).toHaveLength(5);
    expect(ops[1]).toMatchObject({nodeId:'a',properties:{x:number(35),y:number(47)}});
    expect(ops[3]).toMatchObject({nodeId:'b',properties:{x:number(50),y:number(65)}});
    expect(ops[4]).toEqual({action:'delete',nodeId:'g'});
  });
  it('preserves token and style references but never transfers text or geometry',()=>{
    const token={type:'token' as const,tokenId:'color'},style={type:'style' as const,styleId:'border'};
    const m=model([make('a',10,10,10,10,'screen',{backgroundColor:token,borderStyle:style,text:{type:'string',value:'source'},strokeWidth:number(20)}),make('b',20,20,20,20),make('icon',30,30,10,10,'screen',{},'Icon')]);
    const clipboard=copyAppearance(m,'a');expect(clipboard.values).toMatchObject({backgroundColor:token,borderStyle:style});
    expect(clipboard.values.x).toBeUndefined();expect(clipboard.values.text).toBeUndefined();
    const ops=pasteAppearance(m,['b','icon'],clipboard);
    expect(ops.find(op=>op.nodeId==='b'&&op.action==='set')?.properties).toMatchObject({backgroundColor:token,borderStyle:style});
    expect(ops.some(op=>op.nodeId==='icon')).toBe(false);
  });
});
