// The browser mirrors the portable token contract; the server remains authoritative.
const types = ['Color', 'Spacing', 'Typography', 'Geometry', 'Dimension', 'Number', 'FontFamily', 'FontWeight'];
const categories = ['Spacing', 'FontSize', 'Radius', 'BorderWidth', 'Size', 'LineHeight', 'Opacity', 'LetterSpacing'];
const valueTypes = {
  Color: 'color', Spacing: 'spacing', Typography: 'typography', Geometry: 'geometry',
  Dimension: 'dimension', Number: 'number', FontFamily: 'fontFamily', FontWeight: 'fontWeight'
};

export function normalizedTokenType(type) {
  if (typeof type === 'number') return types[type] ?? null;
  return types.find(value => value.toLowerCase() === String(type).toLowerCase()) ?? null;
}

export function normalizedTokenCategory(category) {
  if (category == null) return null;
  if (typeof category === 'number') return categories[category] ?? null;
  return categories.find(value => value.toLowerCase() === String(category).toLowerCase()) ?? null;
}

function categoryIsValid(type, category) {
  if (type === 'Dimension') return ['Spacing', 'FontSize', 'Radius', 'BorderWidth', 'Size', 'LetterSpacing'].includes(category);
  if (type === 'Number') return ['LineHeight', 'Opacity'].includes(category);
  return category === null;
}

export function compatibleToken(token, definition) {
  const type = normalizedTokenType(token?.type);
  const category = normalizedTokenCategory(token?.category);
  return (type === normalizedTokenType(definition?.tokenType) &&
      category === normalizedTokenCategory(definition?.tokenCategory)) ||
    (type === normalizedTokenType(definition?.legacyTokenType) && category === null && type != null);
}

function isValidValue(value, type, category) {
  if (value?.type !== valueTypes[type] || !categoryIsValid(type, category)) return false;
  if (type === 'Color') return [value.red, value.green, value.blue, value.alpha].every(
    channel => Number.isInteger(channel) && channel >= 0 && channel <= 255);
  if (type === 'Spacing') return Number.isFinite(value.value);
  if (type === 'Geometry') return Number.isFinite(value.radius) && value.radius >= 0;
  if (type === 'Dimension')
    return Number.isFinite(value.value) && value.value >= (category === 'FontSize' ? 1 : category === 'LetterSpacing' ? -100 : 0) &&
      value.value <= (category === 'FontSize' ? 1024 : category === 'LetterSpacing' ? 100 : 1000000);
  if (type === 'Number') return Number.isFinite(value.value) &&
    (category === 'Opacity' ? value.value >= 0 && value.value <= 1 : value.value >= 0.1 && value.value <= 10);
  if (type === 'FontFamily') return typeof value.value === 'string' && value.value.length <= 128 &&
    /^[\p{L}\p{N}][\p{L}\p{M}\p{N} _-]*$/u.test(value.value);
  if (type === 'FontWeight') return Number.isInteger(value.value) && value.value >= 1 && value.value <= 1000;
  return type === 'Typography' && typeof value.fontFamily === 'string' &&
    value.fontFamily.trim() !== '' && Number.isFinite(value.fontSize) && value.fontSize > 0 &&
    Number.isInteger(value.fontWeight) && value.fontWeight >= 1 && value.fontWeight <= 1000 &&
    Number.isFinite(value.lineHeight) && value.lineHeight > 0 &&
    Number.isFinite(value.letterSpacing ?? 0) && Math.abs(value.letterSpacing ?? 0) <= 100;
}

export function resolveTokenValue(reference, tokens, theme = 'Light', expectedType = null, expectedCategory = null) {
  if (reference?.type !== 'token') return { value: reference ?? null, error: null };
  const expected = normalizedTokenType(expectedType);
  const categoryExpected = normalizedTokenCategory(expectedCategory);
  const seen = new Set();
  let id = reference.tokenId, contract = null;
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
    if (type === 'Typography' && expression.expression === 'literal' && expression.value?.type === 'typographyFields') {
      const spec = [
        ['fontFamily', 'FontFamily', null], ['fontSize', 'Dimension', 'FontSize'],
        ['fontWeight', 'FontWeight', null], ['lineHeight', 'Number', 'LineHeight'],
        ['letterSpacing', 'Dimension', 'LetterSpacing']
      ];
      const values = {};
      for (const [field, expectedType, expectedCategory] of spec) {
        const part = expression.value[field] ?? (field === 'letterSpacing'
          ? { expression: 'literal', value: { type: 'dimension', value: 0 } } : null);
        let resolved;
        if (part?.expression === 'literal') {
          resolved = isValidValue(part.value, expectedType, expectedCategory)
            ? { value: part.value } : { error: 'Недопустимое прямое значение.' };
        } else if (part?.expression === 'alias') {
          resolved = resolveTokenValue({ type: 'token', tokenId: part.tokenId }, tokens, theme,
            expectedType, expectedCategory);
        } else resolved = { error: 'Не задано поле типографики.' };
        if (resolved.error) return { value: null, error: field + ': ' + resolved.error, token };
        values[field] = resolved.value.value;
      }
      const flattened = { type: 'typography', ...values };
      return isValidValue(flattened, 'Typography', null)
        ? { value: flattened, error: null, token }
        : { value: null, error: 'Некорректные значения полей типографики.', token };
    }
    if (expression.expression !== 'literal' || !isValidValue(expression.value, type, category))
      return { value: null, error: 'Некорректное значение дизайн-токена.', token };
    return { value: expression.value, error: null, token };
  }
}

// A property may also accept a legacy Spacing/Geometry token alongside its v4 contract.
export function resolvePropertyToken(reference, tokens, theme, definition) {
  if (reference?.type !== 'token') return { value: reference ?? null, error: null };
  const token = tokens.get(reference.tokenId);
  if (!token) return { value: null, error: 'Ссылка на токен отсутствует.' };
  if (!compatibleToken(token, definition))
    return { value: null, error: 'Токен несовместим со свойством.' };
  const result = resolveTokenValue(reference, tokens, theme, token.type, token.category);
  if (result.error) return result;
  const value = result.value;
  const scalar = value?.type === 'geometry' ? value.radius : value?.value;
  if (definition.type === 'Number' && (!Number.isFinite(scalar) ||
      (definition.minimum != null && scalar < definition.minimum) ||
      (definition.maximum != null && scalar > definition.maximum)))
    return { ...result, error: 'Значение токена выходит за пределы свойства.' };
  if (definition.numericFontWeight && (!Number.isInteger(scalar) || scalar < 1 || scalar > 1000))
    return { ...result, error: 'Недопустимая толщина шрифта.' };
  if (definition.type === 'String' && (typeof scalar !== 'string' ||
      (definition.maxLength != null && scalar.length > definition.maxLength)))
    return { ...result, error: 'Недопустимое значение строки.' };
  return result;
}

export function tokenValueText(value) {
  if (['spacing', 'geometry', 'dimension'].includes(value?.type))
    return String(value?.type === 'geometry' ? value.radius : value.value) + ' px';
  if (['number', 'fontWeight'].includes(value?.type)) return String(value.value);
  if (value?.type === 'fontFamily') return value.value;
  if (value?.type === 'typography') return [value.fontFamily, value.fontSize + ' px',
    value.fontWeight, value.lineHeight, (value.letterSpacing ?? 0) + ' px tracking'].join(' · ');
  if (value?.type === 'color') return '#' + [value.red, value.green, value.blue, value.alpha]
    .map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase();
  return '—';
}

export function tokenColorHex(value) {
  return '#' + [value.red, value.green, value.blue].map(channel => channel.toString(16).padStart(2, '0')).join('');
}
