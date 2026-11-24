import { layerDisplayName } from './layers.js';

export function disambiguate(items, label) {
  const labels = items.map(label), counts = new Map(), ordinals = new Map();
  for (const name of labels) counts.set(name, (counts.get(name) ?? 0) + 1);
  return items.map((item, index) => {
    const name = labels[index], ordinal = (ordinals.get(name) ?? 0) + 1;
    ordinals.set(name, ordinal);
    return { ...item, label: counts.get(name) > 1 ? name + ' (' + ordinal + ')' : name };
  });
}

export async function readInteractionCatalog(request, doc, revision, signal) {
  const base = '/api/v1/documents/' + encodeURIComponent(doc);
  async function all(path, params = {}) {
    const items = [];
    let total;
    do {
      const q = new URLSearchParams({ revision: String(revision), offset: String(items.length), limit: '100', ...params });
      const page = await request(base + '/' + path + '?' + q, {}, signal);
      if (page.revision !== revision || !Array.isArray(page.items) || !Number.isSafeInteger(page.total) ||
          page.total < items.length + page.items.length || (!page.items.length && items.length < page.total))
        throw new Error('Не удалось получить полный справочник взаимодействий.');
      items.push(...page.items);
      total = page.total;
    } while (items.length < total);
    return items;
  }
  const pages = await all('pages', { fields: 'name' });
  const screenGroups = await Promise.all(pages.map(async page =>
    (await all('pages/' + encodeURIComponent(page.id) + '/screens', { fields: 'name' }))
      .map(screen => ({ ...screen, pageName: page.name?.trim() || 'Страница' }))));
  const screens = disambiguate(screenGroups.flat(), s => s.pageName + ' / ' + (s.name?.trim() || 'Экран'));
  const [datasets, ...details] = await Promise.all([
    all('datasets'),
    ...screens.map(async screen => {
      const [nodes, variants] = await Promise.all([
        all('nodes', { screenId: screen.id, fields: 'kind,properties,name,parentId,childCount' }),
        all('screens/' + encodeURIComponent(screen.id) + '/variants')
      ]);
      const byId = new Map(nodes.map(n => [n.id, n]));
      function path(node) {
        const parts = [], seen = new Set();
        for (let n = node; n && !seen.has(n.id); n = byId.get(n.parentId)) {
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

export function interactionObjectName(catalog, kind, id) {
  const items = catalog?.[kind] ?? [];
  return items.find(item => item.id === id)?.label ??
    ({ screens: 'Экран недоступен', nodes: 'Элемент недоступен', variants: 'Вариант недоступен', datasets: 'Датасет недоступен' })[kind];
}
