import type { DesignToken, TokenType, TokenCategory, Theme, TokenValue, TokenExpression, TypographyField, ResolvableValue } from '../../core/tokens/token-model';
import { tokenTypes, tokenCategories } from '../../core/tokens/token-model';
import { normalizedTokenType, normalizedTokenCategory, tokenValueText } from '../../core/tokens/token-resolution';
export interface TypographyPart {name:TypographyField;label:string;type:TokenType;category:TokenCategory|null;initial:string}
export function knownType(value:unknown):TokenType{const type=normalizedTokenType(value);if(!type)throw new TypeError('Неизвестный тип токена');return type;}
export function literalValue(value:ResolvableValue|undefined):TokenValue{
  if(!value)throw new Error('Заполните значение токена.');
  switch(value.type){case 'color':case 'shadow':case 'geometry':case 'spacing':case 'dimension':case 'fontFamily':case 'fontWeight':case 'number':case 'typographyFields':return value;case 'typography':if(!('value' in value))return value;}
  throw new TypeError('Некорректное значение токена.');
}
export const types=tokenTypes;export const themes:Theme[]=['Light','Dark'];
export const categories=tokenCategories;
export const allowedCategories:Partial<Record<string,readonly string[]>> = {
  Dimension: ['Spacing', 'FontSize', 'Radius', 'BorderWidth', 'Size', 'LetterSpacing'],
  Number: ['LineHeight', 'Opacity']
};
export const typeIndex=(type:unknown)=>types.indexOf(knownType(type));
export const categoryIndex=(category:unknown)=>{const c=normalizedTokenCategory(category);return c==null?null:categories.indexOf(c);};

export function literalExpression(type:TokenType,category:TokenCategory|null,raw:string):Extract<TokenExpression,{expression:'literal'}> {
  const valueType = normalizedTokenType(type);
  if (valueType === 'Color') {
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(raw))
      throw new Error('Введите цвет как #RRGGBB или #RRGGBBAA.');
    const hex = raw.slice(1) + (raw.length === 7 ? 'FF' : '');
    const [red=0, green=0, blue=0, alpha=255] = [0, 2, 4, 6].map(i => parseInt(hex.slice(i, i + 2), 16));
    return { expression: 'literal', value: { type: 'color', red, green, blue, alpha } };
  }
  if (valueType === 'FontFamily') {
    if (raw.length > 128 || !/^[\p{L}\p{N}][\p{L}\p{M}\p{N} _-]*$/u.test(raw))
      throw new Error('Введите корректное непустое имя семейства шрифта (до 128 символов).');
    return { expression: 'literal', value: { type: 'fontFamily', value: raw } };
  }
  if (valueType === 'Typography') throw new Error('Используйте поля составной типографики.');
  if (!raw.trim() || !Number.isFinite(Number(raw))) throw new Error('Введите конечное число.');
  const value = Number(raw), c = normalizedTokenCategory(category);
  if (valueType === 'FontWeight' && (!Number.isInteger(value) || value < 1 || value > 1000))
    throw new Error('Толщина шрифта должна быть целым числом от 1 до 1000.');
  if (valueType === 'Dimension' && (value < (c === 'FontSize' ? 1 : c === 'LetterSpacing' ? -100 : 0) ||
      value > (c === 'FontSize' ? 1024 : c === 'LetterSpacing' ? 100 : 1000000)))
    throw new Error('Размер выходит за пределы допустимого диапазона.');
  if (valueType === 'Number' && (value < (c === 'LineHeight' ? 0.1 : 0) ||
      value > (c === 'LineHeight' ? 10 : 1)))
    throw new Error('Число выходит за пределы допустимого диапазона.');
  if (valueType === 'Geometry' && value < 0) throw new Error('Радиус не может быть отрицательным.');
  const names:Partial<Record<TokenType,'spacing'|'geometry'|'dimension'|'number'|'fontWeight'>>={Spacing:'spacing',Geometry:'geometry',Dimension:'dimension',Number:'number',FontWeight:'fontWeight'};
  const name=valueType?names[valueType]:undefined;
  if (!name) throw new Error('Неподдерживаемый тип токена.');
  return { expression: 'literal', value: name === 'geometry'
    ? { type: name, radius: value } : { type: name, value } };
}

export function directText(expression:TokenExpression|null|undefined) {
  if (expression?.expression !== 'literal') return '';
  return tokenValueText(expression.value).replace(/ px$/, '');
}

export const typeOf=(token:Pick<DesignToken,'type'>)=>knownType(token.type);
export const categoryOf = (token:DesignToken) => normalizedTokenCategory(token?.category);
export const typographyFields:TypographyPart[] = [
  { name: 'fontFamily', label: 'Шрифт', type: 'FontFamily', category: null, initial: 'Arial' },
  { name: 'fontSize', label: 'Размер, px', type: 'Dimension', category: 'FontSize', initial: '16' },
  { name: 'fontWeight', label: 'Толщина', type: 'FontWeight', category: null, initial: '400' },
  { name: 'lineHeight', label: 'Интерлиньяж', type: 'Number', category: 'LineHeight', initial: '1.25' },
  { name: 'letterSpacing', label: 'Межбуквенный интервал, px', type: 'Dimension', category: 'LetterSpacing', initial: '0' }
];

export const groupKey = (segments:readonly string[]) => JSON.stringify(segments);
