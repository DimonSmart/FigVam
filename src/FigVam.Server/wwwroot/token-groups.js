export const tokenSegments = name => String(name).split(/[./]/);
export function tokenNameError(name, items, excludeId = null) {
  const parts = tokenSegments(name).map(s => s.toLowerCase());
  if (!name.trim() || name.length > 256 || /[\u0000-\u001f\u007f-\u009f]/.test(name) || parts.some(s => !s.trim())) return 'Имя должно содержать непустые сегменты (до 256 символов).';
  for (const item of items) {
    if (item.id === excludeId) continue;
    const other = tokenSegments(item.name).map(s => s.toLowerCase());
    if (parts.slice(0, Math.min(parts.length, other.length)).every((s,i) => s === other[i]))
      return parts.length === other.length ? 'Конфликт имени токена: ' + item.name : 'Конфликт токена и группы: ' + item.name;
  }
  return '';
}
export function buildTokenGroups(items) {
  const root = { segments: [], count: 0, children: new Map() };
  for (const item of items) {
    let node = root; node.count++;
    for (const segment of tokenSegments(item.name).slice(0,-1)) {
      if (!node.children.has(segment)) node.children.set(segment, { segments: [...node.segments,segment], count: 0, children: new Map() });
      node = node.children.get(segment); node.count++;
    }
  }
  return root;
}
export function shortTokenName(name, group) {
  return group.length ? tokenSegments(name).slice(group.length).join('.') : name;
}
export function visibleTokens(items, group, search, type, typeOf) {
  const q = search.trim().toLowerCase();
  return items.filter(item => (!type || typeOf(item) === type) &&
    (q ? item.name.toLowerCase().includes(q) || tokenSegments(item.name).join('.').toLowerCase().includes(q) :
      group.every((segment,i) => tokenSegments(item.name)[i] === segment) && tokenSegments(item.name).length > group.length))
    .sort((a,b) => a.name.localeCompare(b.name));
}
export function qualifyTokenName(name, group) {
  return group.length && !/[./]/.test(name) ? [...group,name].join('.') : name;
}
