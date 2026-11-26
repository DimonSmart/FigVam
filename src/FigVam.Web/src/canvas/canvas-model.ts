import type { NodePropertyValue, PropertyDefinition, TokenMap } from '../core/tokens/token-model';

export interface Bounds { x: number; y: number; width: number; height: number }
export interface LayoutBox { bounds: Bounds; clip?: Bounds | null }
export type NodeProperties = Record<string, NodePropertyValue | undefined>;
export type PropertyDefinitions = Record<string, PropertyDefinition | undefined>;
export interface CanvasNode { id: string; parentId: string; kind: string; name?: string; childCount?:number; canContainChildren?:boolean; properties: NodeProperties }
export interface CanvasKind { properties: PropertyDefinitions; semanticRole: string; canContainChildren: boolean; previewEvents: number[] }
export interface CanvasModel {
  screen: string; revision: number; nodes: ReadonlyMap<string, CanvasNode>; orderedNodes: CanvasNode[];
  kinds: ReadonlyMap<string, CanvasKind>; boxes: ReadonlyMap<string, LayoutBox>; tokens: TokenMap;
}
