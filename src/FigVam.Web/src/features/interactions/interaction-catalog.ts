import { layerDisplayName } from '../../core/layer-caption';
import type { LayerCaptionSource } from '../../core/layer-caption';
import type { ApiClient } from '../../api/api-client';
import { requiredRecord, text } from '../../api/decode';

interface Named { id: string; name?: string | null }
interface NodeItem extends Named, LayerCaptionSource { parentId: string; kind: string; childCount?: number }
type Labeled<T> = T & { label: string };
interface Catalog {
  screens: Labeled<Named & { pageName: string }>[];
  datasets: Labeled<Named>[];
  nodes: (Labeled<NodeItem> & { screenId: string })[];
  variants: (Labeled<Named> & { screenId: string })[];
}
function named(value: unknown): Named {
  const item=requiredRecord(value);
  return { ...item, id:text(item.id), name: item.name == null ? null : text(item.name) };
}
function nodeItem(value: unknown): NodeItem {
  const item=requiredRecord(value);
  const props = item.properties == null ? null : requiredRecord(item.properties);
  const properties = props && Object.fromEntries(Object.entries(props).map(([key,val]) => {
    const prop=requiredRecord(val);
    return [key,{...prop,type:typeof prop.type==='string'?prop.type:undefined,value:prop.value}];
  }));
  return {...named(item),kind:text(item.kind),parentId:text(item.parentId),properties,
    childCount:typeof item.childCount==='number'?item.childCount:undefined};
}


export function disambiguate<T extends object>(items: readonly T[], label: (item:T)=>string): Labeled<T>[] {
  const labels = items.map(label), counts = new Map<string, number>(), ordinals = new Map<string, number>();
  for (const name of labels) counts.set(name, (counts.get(name) ?? 0) + 1);
  return items.map((item, index) => {
    const name = labels[index] ?? label(item), ordinal = (ordinals.get(name) ?? 0) + 1;
    ordinals.set(name, ordinal);
    return { ...item, label: (counts.get(name) ?? 0) > 1 ? name + ' (' + ordinal + ')' : name };
  });
}

export async function readInteractionCatalog(request: ApiClient, doc: string, revision: number, signal: AbortSignal): Promise<Catalog> {
  const base = '/api/v1/documents/' + encodeURIComponent(doc);
  async function all<T>(path: string, params: Record<string,string>, decode: (value:unknown)=>T): Promise<T[]> {
    const items: T[] = [];
    let total: number | undefined;
    do {
      const q = new URLSearchParams({ revision: String(revision), offset: String(items.length), limit: '100', ...params });
      const page = requiredRecord(await request(base + '/' + path + '?' + q, {}, signal));
      if (page.revision !== revision || !Array.isArray(page.items) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) ||
          (total !== undefined && total !== page.total) || page.total < items.length + page.items.length || (!page.items.length && items.length < page.total))
        throw new Error('Не удалось получить полный справочник взаимодействий.');
      items.push(...page.items.map(decode));
      total = page.total;
    } while (items.length < total);
    return items;
  }
  const pages = await all('pages', { fields: 'name' }, named);
  const screenGroups = await Promise.all(pages.map(async page =>
    (await all('pages/' + encodeURIComponent(page.id) + '/screens', { fields: 'name' }, named))
      .map((screen, index) => ({ ...screen, name: screen.name?.trim() || 'Экран ' + (index + 1), pageName: page.name?.trim() || 'Страница' }))));
  const screens = disambiguate(screenGroups.flat(), s => s.pageName + ' / ' + (s.name?.trim() || 'Экран'));
  const [datasets, ...details] = await Promise.all([
    all('datasets', {}, named),
    ...screens.map(async screen => {
      const [nodes, variants] = await Promise.all([
        all('nodes', { screenId: screen.id, fields: 'kind,properties,name,parentId,childCount' }, nodeItem),
        all('screens/' + encodeURIComponent(screen.id) + '/variants', {}, named)
      ]);
      const byId = new Map(nodes.map(n => [n.id, n]));
      function path(node: NodeItem) {
        const parts: string[] = [], seen = new Set<string>();
        for (let n: NodeItem | undefined = node; n && !seen.has(n.id); n = byId.get(n.parentId)) {
          seen.add(n.id);
          const name = layerDisplayName(n);
          parts.unshift(name.source === 'missing' ? n.kind : name.text);
        }
        return screen.label + ' / ' + parts.join(' / ');
      }
      return {
        screenId: screen.id,
        nodes: disambiguate(nodes, n => path(n) + ' · ' + n.kind),
        variants: disambiguate(variants, v => screen.label + ' / ' + (v.name?.trim() || 'Вариант'))
      };
    })
  ]);
  return {
    screens,
    datasets: disambiguate(datasets, d => d.name?.trim() || 'Датасет'),
    nodes: details.flatMap(d => d.nodes.map(n => ({ ...n, screenId: d.screenId }))),
    variants: details.flatMap(d => d.variants.map(v => ({ ...v, screenId: d.screenId })))
  };
}

export function interactionObjectName(catalog: Catalog | null | undefined, kind: keyof Catalog, id: string) {
  const items = catalog?.[kind] ?? [];
  return items.find(item => item.id === id)?.label ??
    ({ screens: 'Экран недоступен', nodes: 'Элемент недоступен', variants: 'Вариант недоступен', datasets: 'Датасет недоступен' })[kind];
}
