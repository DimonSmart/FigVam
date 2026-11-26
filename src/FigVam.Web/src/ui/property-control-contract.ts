import type { DesignToken, PropertyDefinition, ResolvableValue, Resolution, Theme, TokenMap } from '../core/tokens/token-model';

export type RawValue = string | number | boolean | null | RawValue[];
export type ControlInput = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement;
export interface Validation { value?: ResolvableValue; input?: ControlInput; error?: string }
export interface PropertyControl {
  content: HTMLElement[];
  inputs: ControlInput[];
  initial: RawValue;
  read(): RawValue;
  write(value: RawValue, preserveInput?: boolean): void;
  validate(): Validation;
  setDisabled?(disabled:boolean):void;
  refresh?():void;
  dispose?():void;
  writeResolved?(result:Resolution):void;
}
export interface PropertyModel {
  tokens:TokenMap;
  assets:ReadonlyMap<string,{id:string;width:number;height:number}>;
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
  writeResolved?:(result:Resolution)=>void;
}
export type ControlDefinition = PropertyDefinition & {type:string};
export function rawArray(value:RawValue):RawValue[]{return Array.isArray(value)?value:[];}
export function rawText(value:RawValue|undefined):string{return value==null?'':String(value);}
