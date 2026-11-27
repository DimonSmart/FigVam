// JSON discriminators mirror the server contracts in DesignTokens.cs and NodeProperties.cs.
export const tokenTypes = ['Color', 'Spacing', 'Typography', 'Geometry', 'Dimension', 'Number', 'FontFamily', 'FontWeight', 'Shadow'] as const;
export const tokenCategories = ['Spacing', 'FontSize', 'Radius', 'BorderWidth', 'Size', 'LineHeight', 'Opacity', 'LetterSpacing'] as const;
export type TokenType = typeof tokenTypes[number];
export type TokenCategory = typeof tokenCategories[number];
export type Theme = 'Light' | 'Dark';
export type ColorChannels = { red: number; green: number; blue: number; alpha: number };
export type ColorValue = { type: 'color' } & ColorChannels;
export interface TypographyValue {
  type: 'typography';
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing?: number;
}
export type TypographyField = 'fontFamily' | 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing';
export type TypographyFieldsValue = { type: 'typographyFields' } & Partial<Record<TypographyField, TokenExpression>>;
export interface ShadowValue {
  type: 'shadow';
  offsetX: number;
  offsetY: number;
  blurRadius: number;
  spreadRadius: number;
  color: ColorChannels;
}
export type ShadowFieldsValue = Omit<ShadowValue, "type" | "color"> & {type:"shadowFields";color:TokenExpression};
export type TokenValue = ColorValue | TypographyValue | TypographyFieldsValue | ShadowValue | ShadowFieldsValue
  | { type: 'spacing' | 'dimension' | 'number' | 'fontWeight'; value: number }
  | { type: 'geometry'; radius: number }
  | { type: 'fontFamily'; value: string };
export type TokenExpression = { expression: 'literal'; value: TokenValue }
  | { expression: 'alias'; tokenId: string };
export interface DesignToken {
  id: string;
  name: string;
  type: TokenType | number;
  category?: TokenCategory | number | null;
  values?: Partial<Record<Theme, TokenExpression>>;
}
export type TokenReference = { type: 'token'; tokenId: string };
export type NodePropertyValue = TokenReference | ColorValue | ShadowValue
  | { type: 'string' | 'enum'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'asset'; assetId: string }
  | { type: 'style'; styleId: string }
  | { type: 'typography'; value: TokenValue };
export type ResolvableValue = TokenValue | NodePropertyValue;
export type TokenMap = ReadonlyMap<string, DesignToken>;
export interface PropertyDefinition {
  type?: string;
  enumValues?: string[];
  required?: boolean;
  pattern?: string | null;
  styleType?: number | string | null;
  tokenType?: TokenType | number | null;
  tokenCategory?: TokenCategory | number | null;
  legacyTokenType?: TokenType | number | null;
  minimum?: number | null;
  maximum?: number | null;
  maxLength?: number | null;
  numericFontWeight?: boolean;
  defaultValue?: NodePropertyValue | null;
}
export interface Resolution<T = ResolvableValue> {
  value: T | null;
  error: string | null;
  token?: DesignToken;
}
