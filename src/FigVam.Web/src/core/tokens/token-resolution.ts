// The browser mirrors the portable token contract; the server remains authoritative.
import { tokenTypes, tokenCategories } from './token-model';
import type {
  ColorChannels, DesignToken, PropertyDefinition, ResolvableValue, Resolution, Theme,
  TokenCategory, TokenMap, TokenType, TokenValue, TypographyField, TypographyValue,
} from './token-model';

export function normalizedTokenType(type: unknown): TokenType | null {
  if (typeof type === 'number') return tokenTypes[type] ?? null;
  return tokenTypes.find(value => value.toLowerCase() === String(type).toLowerCase()) ?? null;
}
export function normalizedTokenCategory(category: unknown): TokenCategory | null {
  if (category == null) return null;
  if (typeof category === 'number') return tokenCategories[category] ?? null;
  return tokenCategories.find(value => value.toLowerCase() === String(category).toLowerCase()) ?? null;
}
function categoryIsValid(type: TokenType, category: TokenCategory | null): boolean {
  if (type === 'Dimension') return category !== null && ['Spacing', 'FontSize', 'Radius', 'BorderWidth', 'Size', 'LetterSpacing'].includes(category);
  if (type === 'Number') return category !== null && ['LineHeight', 'Opacity'].includes(category);
  return category === null;
}
export function compatibleToken(token: DesignToken | null | undefined, definition: PropertyDefinition | null | undefined): boolean {
  const type = normalizedTokenType(token?.type), category = normalizedTokenCategory(token?.category);
  return (type === normalizedTokenType(definition?.tokenType) && category === normalizedTokenCategory(definition?.tokenCategory)) ||
    (type === normalizedTokenType(definition?.legacyTokenType) && category === null && type != null);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function integer(value: unknown): value is number {
  return finite(value) && Number.isInteger(value);
}
function range(value: unknown, min: number, max: number): value is number {
  return finite(value) && value >= min && value <= max;
}
function channel(value: unknown): value is number {
  return integer(value) && value >= 0 && value <= 255;
}
function isValidValue(value: unknown, type: TokenType, category: TokenCategory | null): value is TokenValue {
  if (!record(value) || !categoryIsValid(type, category)) return false;
  switch (type) {
    case 'Shadow':
      return value.type === 'shadow' && range(value.offsetX, -1024, 1024) && range(value.offsetY, -1024, 1024) &&
        range(value.blurRadius, 0, 256) && range(value.spreadRadius, -256, 256) &&
        record(value.color) && isValidValue({ ...value.color, type: 'color' }, 'Color', null);
    case 'Color':
      return value.type === 'color' && [value.red, value.green, value.blue, value.alpha].every(channel);
    case 'Spacing':
      return value.type === 'spacing' && finite(value.value);
    case 'Geometry':
      return value.type === 'geometry' && finite(value.radius) && value.radius >= 0;
    case 'Dimension':
      return value.type === 'dimension' && range(value.value,
        category === 'FontSize' ? 1 : category === 'LetterSpacing' ? -100 : 0,
        category === 'FontSize' ? 1024 : category === 'LetterSpacing' ? 100 : 1000000);
    case 'Number':
      return value.type === 'number' && (category === 'Opacity' ? range(value.value, 0, 1) : range(value.value, 0.1, 10));
    case 'FontFamily':
      return value.type === 'fontFamily' && typeof value.value === 'string' && value.value.length <= 128 &&
        /^[\p{L}\p{N}][\p{L}\p{M}\p{N} _-]*$/u.test(value.value);
    case 'FontWeight':
      return value.type === 'fontWeight' && integer(value.value) && range(value.value, 1, 1000);
    case 'Typography':
      return value.type === 'typography' && typeof value.fontFamily === 'string' && value.fontFamily.trim() !== '' &&
        finite(value.fontSize) && value.fontSize > 0 && integer(value.fontWeight) && range(value.fontWeight, 1, 1000) &&
        finite(value.lineHeight) && value.lineHeight > 0 && range(value.letterSpacing ?? 0, -100, 100);
  }
}

export function resolveTokenValue(reference: ResolvableValue | null | undefined, tokens: TokenMap,
  theme: Theme = 'Light', expectedType: unknown = null, expectedCategory: unknown = null): Resolution {
  if (reference?.type !== 'token') return { value: reference ?? null, error: null };
  const expected = normalizedTokenType(expectedType), categoryExpected = normalizedTokenCategory(expectedCategory);
  const seen = new Set<string>();
  let id = reference.tokenId;
  let contract: { type: TokenType; category: TokenCategory | null } | null = null;
  while (true) {
    if (!id || seen.has(id)) return { value: null, error: 'Цикл ссылок дизайн-токенов.' };
    seen.add(id);
    const token = tokens.get(id);
    if (!token) return { value: null, error: 'Ссылка на токен отсутствует.' };
    const type = normalizedTokenType(token.type), category = normalizedTokenCategory(token.category);
    if (!type || !categoryIsValid(type, category) ||
        (expected && (type !== expected || category !== categoryExpected)) ||
        (contract && (type !== contract.type || category !== contract.category)))
      return { value: null, error: 'Несовместимый тип или категория токена.', token };
    contract = { type, category };
    const expression = token.values?.[theme];
    if (!expression) return { value: null, error: 'Нет значения токена для темы ' + theme + '.', token };
    if (expression.expression === 'alias') { id = expression.tokenId; continue; }
    if (type === 'Typography' && expression.expression === 'literal' && expression.value?.type === 'typographyFields')
      return { ...resolveInlineTypography(expression.value, tokens, theme), token };
    if (expression.expression !== 'literal' || !isValidValue(expression.value, type, category))
      return { value: null, error: 'Некорректное значение дизайн-токена.', token };
    return { value: expression.value, error: null, token };
  }
}

const typographySpec: readonly (readonly [TypographyField, TokenType, TokenCategory | null])[] = [
  ['fontFamily', 'FontFamily', null], ['fontSize', 'Dimension', 'FontSize'],
  ['fontWeight', 'FontWeight', null], ['lineHeight', 'Number', 'LineHeight'],
  ['letterSpacing', 'Dimension', 'LetterSpacing'],
];

function scalar(value: ResolvableValue | null): unknown {
  if (value?.type === 'geometry') return value.radius;
  return value && 'value' in value ? value.value : undefined;
}

// Inline Typography and document token Typography share the same field resolution rules.
export function resolveInlineTypography(value: TokenValue | null | undefined, tokens: TokenMap, theme: Theme = 'Light'): Resolution<TypographyValue> {
  if (value?.type === 'typography')
    return isValidValue(value, 'Typography', null)
      ? { value, error: null } : { value: null, error: 'Некорректное значение типографики.' };
  if (value?.type !== 'typographyFields') return { value: null, error: 'Не задана типографика.' };
  const values: Partial<Record<TypographyField, unknown>> = {};
  for (const [field, expectedType, expectedCategory] of typographySpec) {
    const part = value[field] ?? (field === 'letterSpacing'
      ? { expression: 'literal' as const, value: { type: 'dimension' as const, value: 0 } } : null);
    let resolved: Resolution;
    if (part?.expression === 'literal') {
      resolved = isValidValue(part.value, expectedType, expectedCategory)
        ? { value: part.value, error: null } : { value: null, error: 'Недопустимое прямое значение.' };
    } else if (part?.expression === 'alias') {
      resolved = resolveTokenValue({ type: 'token', tokenId: part.tokenId }, tokens, theme, expectedType, expectedCategory);
    } else resolved = { value: null, error: 'Не задано поле типографики.' };
    if (resolved.error) return { value: null, error: field + ': ' + resolved.error };
    values[field] = scalar(resolved.value);
  }
  const flattened = { type: 'typography' as const, ...values };
  if (isValidValue(flattened, 'Typography', null) && flattened.type === 'typography' && 'fontFamily' in flattened &&
      typeof flattened.fontFamily === 'string' && finite(flattened.fontSize) && finite(flattened.fontWeight) &&
      finite(flattened.lineHeight) && finite(flattened.letterSpacing)) {
    return { value: { type: 'typography', fontFamily: flattened.fontFamily, fontSize: flattened.fontSize,
      fontWeight: flattened.fontWeight, lineHeight: flattened.lineHeight, letterSpacing: flattened.letterSpacing }, error: null };
  }
  return { value: null, error: 'Некорректные значения полей типографики.' };
}

// A property may also accept a legacy Spacing/Geometry token alongside its v4 contract.
export function resolvePropertyToken(reference: ResolvableValue | null | undefined, tokens: TokenMap, theme: Theme,
  definition: PropertyDefinition): Resolution {
  if (reference?.type !== 'token') return { value: reference ?? null, error: null };
  const token = tokens.get(reference.tokenId);
  if (!token) return { value: null, error: 'Ссылка на токен отсутствует.' };
  if (!compatibleToken(token, definition)) return { value: null, error: 'Токен несовместим со свойством.' };
  const result = resolveTokenValue(reference, tokens, theme, token.type, token.category);
  if (result.error) return result;
  const value = scalar(result.value);
  if (definition.type === 'Number' && (!finite(value) ||
      (definition.minimum != null && value < definition.minimum) ||
      (definition.maximum != null && value > definition.maximum)))
    return { ...result, error: 'Значение токена выходит за пределы свойства.' };
  if (definition.numericFontWeight && (!integer(value) || value < 1 || value > 1000))
    return { ...result, error: 'Недопустимая толщина шрифта.' };
  if (definition.type === 'String' && (typeof value !== 'string' ||
      (definition.maxLength != null && value.length > definition.maxLength)))
    return { ...result, error: 'Недопустимое значение строки.' };
  return result;
}

function hex(channel: number): string { return channel.toString(16).padStart(2, '0'); }
export function tokenValueText(value: TokenValue | null | undefined): string {
  switch (value?.type) {
    case 'spacing': case 'dimension': return String(value.value) + ' px';
    case 'geometry': return String(value.radius) + ' px';
    case 'number': case 'fontWeight': return String(value.value);
    case 'fontFamily': return value.value;
    case 'typography': return [value.fontFamily, value.fontSize + ' px', value.fontWeight,
      value.lineHeight, (value.letterSpacing ?? 0) + ' px tracking'].join(' · ');
    case 'shadow': return [value.offsetX, value.offsetY, value.blurRadius, value.spreadRadius]
      .map(v => v + ' px').join(' · ') + ' · ' + tokenValueText({ ...value.color, type: 'color' });
    case 'color': return '#' + [value.red, value.green, value.blue, value.alpha].map(hex).join('').toUpperCase();
    default: return '—';
  }
}
export function tokenColorHex(value: ColorChannels): string {
  return '#' + [value.red, value.green, value.blue].map(hex).join('');
}
