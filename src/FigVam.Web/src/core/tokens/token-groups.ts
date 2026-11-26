export interface NamedToken { id: string; name: string }
export interface TokenGroup {
  segments: string[];
  count: number;
  children: Map<string, TokenGroup>;
}
export const tokenSegments = (name: string) => String(name).split(/[./]/);
export function tokenNameError(name: string, items: readonly NamedToken[], excludeId: string | null = null) {
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
export function buildTokenGroups(items: readonly NamedToken[]): TokenGroup {
  const root: TokenGroup = { segments: [], count: 0, children: new Map() };
  for (const item of items) {
    let node = root; node.count++;
    for (const segment of tokenSegments(item.name).slice(0,-1)) {
      let child = node.children.get(segment);
      if (!child) {
        child = { segments: [...node.segments, segment], count: 0, children: new Map() };
        node.children.set(segment, child);
      }
      node = child; node.count++;
    }
  }
  return root;
}
export function shortTokenName(name: string, group: readonly string[]) {
  return group.length ? tokenSegments(name).slice(group.length).join('.') : name;
}
export function matchesTokenSearch(item: NamedToken, search: string) {
  const q = search.trim().toLowerCase();
  return !q || item.name.toLowerCase().includes(q) || tokenSegments(item.name).join('.').toLowerCase().includes(q);
}
export function filteredTokens<T extends NamedToken, TType>(items: readonly T[], search: string, selectedTypes: ReadonlySet<TType>, typeOf: (item: T) => TType): T[] {
  return items.filter(item => selectedTypes.has(typeOf(item)) && matchesTokenSearch(item, search));
}
export function tokensInGroup<T extends NamedToken>(items: readonly T[], group: readonly string[]): T[] {
  return items.filter(item => {
    const segments = tokenSegments(item.name);
    return segments.length > group.length && group.every((segment,i) => segments[i] === segment);
  }).sort((a,b) => a.name.localeCompare(b.name));
}
export function qualifyTokenName(name: string, group: readonly string[]) {
  return group.length && !/[./]/.test(name) ? [...group,name].join('.') : name;
}

export function tokenNameDiagnostics(items: readonly NamedToken[]): Map<string, string> {
  const diagnostics = new Map<string, string>(), byPath = new Map<string, NamedToken[]>();
  const key = (segments: readonly string[]) => JSON.stringify(segments);
  for (const item of items) {
    const invalid = tokenNameError(item.name, []);
    if (invalid) diagnostics.set(item.id, invalid);
    const segments = tokenSegments(item.name).map(s => s.toLowerCase());
    const k = key(segments);
    const peers = byPath.get(k);
    if (peers) peers.push(item); else byPath.set(k, [item]);
  }
  for (const item of items) {
    const segments = tokenSegments(item.name).map(s => s.toLowerCase());
    const peer = byPath.get(key(segments))?.find(peer => peer.id !== item.id);
    if (peer && !diagnostics.has(item.id))
      diagnostics.set(item.id, 'Конфликт имени токена: ' + peer.name);
    for (let length = 1; length < segments.length; length++) {
      for (const parent of byPath.get(key(segments.slice(0,length))) ?? []) {
        if (!diagnostics.has(item.id)) diagnostics.set(item.id, 'Конфликт токена и группы: ' + parent.name);
        if (!diagnostics.has(parent.id)) diagnostics.set(parent.id, 'Конфликт токена и группы: ' + item.name);
      }
    }
  }
  return diagnostics;
}
