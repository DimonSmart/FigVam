// A single client-side resolution path for the inspector and the screen renderer.
const tokenTypes = ['Color', 'Spacing', 'Typography', 'Geometry'];
const valueTypes = { Color: 'color', Spacing: 'spacing', Typography: 'typography', Geometry: 'geometry' };

export function normalizedTokenType(type) {
  if (typeof type === 'number') return tokenTypes[type] ?? null;
  return tokenTypes.find(value => value.toLowerCase() === String(type).toLowerCase()) ?? null;
}

function isValidValue(value, type) {
  if (value?.type !== valueTypes[type]) return false;
  if (type === 'Color')
    return [value.red, value.green, value.blue, value.alpha].every(
      channel => Number.isInteger(channel) && channel >= 0 && channel <= 255);
  if (type === 'Spacing') return Number.isFinite(value.value);
  if (type === 'Geometry') return Number.isFinite(value.radius) && value.radius >= 0;
  return type === 'Typography' && typeof value.fontFamily === 'string' &&
    value.fontFamily.trim() !== '' && Number.isFinite(value.fontSize) && value.fontSize > 0 &&
    Number.isInteger(value.fontWeight) && value.fontWeight >= 1 && value.fontWeight <= 1000 &&
    Number.isFinite(value.lineHeight) && value.lineHeight > 0;
}

export function resolveTokenValue(reference, tokens, theme = 'Light', expectedType = null) {
  if (reference?.type !== 'token') return { value: reference ?? null, error: null };
  const expected = expectedType == null ? null : normalizedTokenType(expectedType);
  const seen = new Set();
  let id = reference.tokenId;
  let rootType = null;
  while (true) {
    if (!id || seen.has(id)) return { value: null, error: 'Цикл ссылок дизайн-токенов.' };
    seen.add(id);
    const token = tokens.get(id);
    if (!token) return { value: null, error: 'Ссылка на токен отсутствует.' };
    const actual = normalizedTokenType(token.type);
    if (!actual || (expected && actual !== expected) || (rootType && actual !== rootType))
      return { value: null, error: 'Несовместимый тип дизайн-токена.', token };
    rootType = actual;
    const expression = token.values?.[theme];
    if (!expression) return { value: null, error: 'Нет значения токена для темы ' + theme + '.', token };
    if (expression.expression === 'alias') {
      id = expression.tokenId;
      continue;
    }
    if (expression.expression !== 'literal' || !isValidValue(expression.value, actual))
      return { value: null, error: 'Некорректное значение дизайн-токена.', token };
    return { value: expression.value, error: null, token };
  }
}

export function tokenValueText(value) {
  if (value?.type === 'spacing') return String(value.value) + ' px';
  if (value?.type === 'geometry') return String(value.radius) + ' px';
  if (value?.type === 'color') return '#' + [value.red, value.green, value.blue, value.alpha]
    .map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase();
  return '—';
}

export function tokenColorHex(value) {
  return '#' + [value.red, value.green, value.blue].map(channel => channel.toString(16).padStart(2, '0')).join('');
}
