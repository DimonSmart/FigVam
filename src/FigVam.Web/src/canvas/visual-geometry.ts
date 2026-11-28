export type GuideAxis = 'x' | 'y';
export interface Guide { id: string; axis: GuideAxis; position: number }
export interface GridSettings { visible: boolean; step: number; snap: boolean; snapObjects: boolean; guides: readonly Guide[] }
export const defaultGridSettings: GridSettings = { visible: false, step: 20, snap: false, snapObjects: false, guides: [] };
export function clampGuide(position:number, limit:number) { return Math.max(0,Math.min(limit,Math.round(position*1000)/1000)); }
export function decodeGuides(value:unknown): Guide[] {
  if(!Array.isArray(value))return [];
  return value.flatMap<Guide>((item:unknown)=>{
    if(typeof item!=='object'||item===null||!('id' in item)||typeof item.id!=='string'||!('axis' in item)||(item.axis!=='x'&&item.axis!=='y')||!('position' in item)||typeof item.position!=='number'||!Number.isFinite(item.position)||item.position<0)return [];
    return [{id:item.id,axis:item.axis,position:item.position}];
  }).filter((guide,index,all)=>all.findIndex(item=>item.id===guide.id)===index).slice(0,128);
}
export function validGridStep(step: number): boolean {
  return Number.isInteger(step) && step >= 2 && step <= 500;
}
export interface Snap { delta: number; guide: number }
export function closestSnap(anchors: readonly number[], targets: readonly number[], gridStep: number | null, tolerance: number): Snap | null {
  let best: Snap | null = null;
  for (const anchor of anchors) {
    const candidates = gridStep === null ? targets : [...targets, Math.round(anchor / gridStep) * gridStep];
    for (const guide of candidates) {
      const delta = guide - anchor;
      if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, guide };
    }
  }
  return best;
}
interface Range { min: number; max: number }
export function proportionalSize(width: number, height: number, dx: number, dy: number, horizontal: Range, vertical: Range): [number, number] | null {
  if (!(width > 0 && height > 0)) return null;
  const min = Math.max(horizontal.min / width, vertical.min / height);
  const max = Math.min(horizontal.max / width, vertical.max / height);
  if (min > max) return null;
  const change = Math.abs(dx / width) >= Math.abs(dy / height) ? dx / width : dy / height;
  const factor = Math.max(min, Math.min(max, 1 + change));
  return [width * factor, height * factor];
}
