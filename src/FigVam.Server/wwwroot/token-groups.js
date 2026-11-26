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
export function matchesTokenSearch(item, search) {
  const q = search.trim().toLowerCase();
  return !q || item.name.toLowerCase().includes(q) || tokenSegments(item.name).join('.').toLowerCase().includes(q);
}
export function filteredTokens(items, search, selectedTypes, typeOf) {
  return items.filter(item => selectedTypes.has(typeOf(item)) && matchesTokenSearch(item, search));
}
export function tokensInGroup(items, group) {
  return items.filter(item => {
    const segments = tokenSegments(item.name);
    return segments.length > group.length && group.every((segment,i) => segments[i] === segment);
  }).sort((a,b) => a.name.localeCompare(b.name));
}
export function qualifyTokenName(name, group) {
  return group.length && !/[./]/.test(name) ? [...group,name].join('.') : name;
}

export function tokenNameDiagnostics(items) {
  const diagnostics = new Map(), byPath = new Map();
  const key = segments => JSON.stringify(segments);
  for (const item of items) {
    const invalid = tokenNameError(item.name, []);
    if (invalid) diagnostics.set(item.id, invalid);
    const segments = tokenSegments(item.name).map(s => s.toLowerCase());
    const k = key(segments);
    if (!byPath.has(k)) byPath.set(k, []);
    byPath.get(k).push(item);
  }
  for (const item of items) {
    const segments = tokenSegments(item.name).map(s => s.toLowerCase());
    const peers = byPath.get(key(segments));
    if (peers.length > 1 && !diagnostics.has(item.id))
      diagnostics.set(item.id, 'Конфликт имени токена: ' + peers.find(peer => peer.id !== item.id).name);
    for (let length = 1; length < segments.length; length++) {
      for (const parent of byPath.get(key(segments.slice(0,length))) ?? []) {
        if (!diagnostics.has(item.id)) diagnostics.set(item.id, 'Конфликт токена и группы: ' + parent.name);
        if (!diagnostics.has(parent.id)) diagnostics.set(parent.id, 'Конфликт токена и группы: ' + item.name);
      }
    }
  }
  return diagnostics;
}
