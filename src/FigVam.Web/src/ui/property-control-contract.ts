import type { DesignToken, PropertyDefinition, ResolvableValue, Resolution, Theme, TokenMap } from '../core/tokens/token-model';

export type RawValue = string | number | boolean | null | RawValue[];
export interface PropertyModel {
  tokens:TokenMap;
  assets:ReadonlyMap<string,{id:string;width:number;height:number;contentType?:string}>;
  styles?:ReadonlyMap<string,{id:string;name:string;type:string|number}>;
  theme?:Theme;
}
export interface TokenControlOptions {
  theme?:Theme;
  customDirect?:boolean;
  validateChoices?:boolean;
  getCompatible?:()=>DesignToken[];
  getToken?:(id:string)=>DesignToken|undefined;
  resolve?:(id:string)=>Resolution;
}
export type ControlDefinition = PropertyDefinition & {type:string};
export function rawArray(value:RawValue):RawValue[]{return Array.isArray(value)?value:[];}
export function rawText(value:RawValue|undefined):string{return value==null?'':String(value);}
