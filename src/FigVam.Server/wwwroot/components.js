export function createComponents({ element, request, pageSize, getContext }) {
  let componentGeneration = 0, componentSelection = null, componentOffset = 0, usageOffset = 0;
  let componentTotal = 0, usageTotal = 0, componentSearch = '';
  // Catalog reads are pinned to the editor revision and never issue commands.
  function reset() {
    componentGeneration++; componentSelection = null; componentOffset = usageOffset = 0;
    componentTotal = usageTotal = 0; componentSearch = '';
    element('components-search').reset(); element('components-list').replaceChildren();
    element('component-detail').hidden = true; element('components-status').textContent = '';
    element('components-error').textContent = ''; element('components-retry').hidden = true;
    componentPagination();
  }
  function componentPagination() {
    element('components-previous').disabled = componentOffset === 0;
    element('components-next').disabled = componentOffset + pageSize >= componentTotal;
    element('components-number').textContent = componentTotal ? `${componentOffset + 1}–${Math.min(componentOffset + pageSize, componentTotal)} из ${componentTotal}` : '';
    element('usages-previous').disabled = usageOffset === 0;
    element('usages-next').disabled = usageOffset + pageSize >= usageTotal;
    element('usages-number').textContent = usageTotal ? `${usageOffset + 1}–${Math.min(usageOffset + pageSize, usageTotal)} из ${usageTotal}` : '';
  }
  function componentList(id, items, describe, empty) {
    const list = element(id); list.replaceChildren();
    for (const item of items) { const li = document.createElement('li'); li.textContent = describe(item); list.append(li); }
    if (!items.length) { const li = document.createElement('li'); li.textContent = empty; list.append(li); }
  }
  async function load() {
    const { documentId: doc, revision: atRevision, catalogRevision } = getContext();
    if (!doc || !Number.isSafeInteger(atRevision)) return;
    const current = ++componentGeneration;
    const valid = () => { const context = getContext(); return current === componentGeneration && doc === context.documentId && catalogRevision === context.catalogRevision; };
    const base = `/api/v1/documents/${encodeURIComponent(doc)}/components`;
    element('components-status').textContent = 'Загрузка компонентов…'; element('components-error').textContent = '';
    element('components-retry').hidden = true; element('components-list').replaceChildren(); element('component-detail').hidden = true;
    componentTotal = usageTotal = 0; componentPagination();
    try {
      const query = new URLSearchParams({ revision: String(atRevision), offset: String(componentOffset), limit: String(pageSize), search: componentSearch });
      let result = await request(`${base}?${query}`);
      if (!valid()) return;
      if (componentOffset && !result.items.length) { componentOffset = Math.max(0, componentOffset - pageSize); return load(); }
      componentTotal = result.total; componentPagination();
      const list = element('components-list');
      for (const item of result.items) {
        const li = document.createElement('li'), button = document.createElement('button'); button.type = 'button'; button.textContent = item.name;
        button.setAttribute('aria-pressed', String(item.id === componentSelection));
        button.addEventListener('click', () => { componentSelection = item.id; usageOffset = 0; load(); }); li.append(button); list.append(li);
      }
      element('components-status').textContent = result.total ? `Компонентов: ${result.total} · ревизия ${atRevision}` : 'Компоненты не найдены.';
      if (componentSelection) await loadComponentDetail(current, doc, atRevision, catalogRevision);
    } catch (error) {
      if (!valid() || error.name === 'AbortError') return;
      element('components-status').textContent = ''; element('components-error').textContent = error.message; element('components-retry').hidden = false;
    }
  }
  async function loadComponentDetail(current, doc, atRevision, catalogRevision) {
    const id = componentSelection, valid = () => { const context = getContext(); return current === componentGeneration && doc === context.documentId && catalogRevision === context.catalogRevision && id === componentSelection; };
    const base = `/api/v1/documents/${encodeURIComponent(doc)}/components/${encodeURIComponent(id)}`;
    element('component-detail').hidden = false; element('component-title').textContent = 'Загрузка…';
    element('component-description').textContent = ''; for (const name of ['component-parameters', 'component-slots', 'component-variants', 'component-usages']) element(name).replaceChildren();
    element('component-usages-status').textContent = 'Загрузка компонента и использований…'; element('component-usages-error').textContent = ''; element('component-usages-retry').hidden = true;
    try {
      const query = new URLSearchParams({ revision: String(atRevision), offset: String(usageOffset), limit: String(pageSize) });
      const [detail, usages] = await Promise.all([request(`${base}?revision=${atRevision}`), request(`${base}/usages?${query}`)]);
      if (!valid()) return;
      if (usageOffset && !usages.items.length) { usageOffset = Math.max(0, usageOffset - pageSize); return loadComponentDetail(current, doc, atRevision, catalogRevision); }
      const item = detail.component; element('component-title').textContent = item.name;
      element('component-description').textContent = item.description || 'Описание отсутствует.';
      const types = ['Text', 'Asset', 'Bool', 'Number', 'TokenReference', 'Enum'], kinds = ['Default', 'Hover', 'Disabled', 'Selected', 'Custom'];
      componentList('component-parameters', item.parameters, p => `${p.name} · ${types[p.type] ?? p.type} · ${JSON.stringify(p.defaultValue)}${p.enumValues ? ` · ${p.enumValues.join(', ')}` : ''}`, 'Параметров нет.');
      componentList('component-slots', item.slots, s => `${s.name} · контейнер ${s.containerNodeId}`, 'Слотов нет.');
      componentList('component-variants', item.variants, v => `${v.name} · ${kinds[v.kind] ?? v.kind}${v.baseVariantId ? ` · базовый вариант ${v.baseVariantId}` : ''}`, 'Вариантов нет.');
      usageTotal = usages.total; componentPagination();
      componentList('component-usages', usages.items, u => `Узел ${u.nodeId}${u.variantId ? ` · вариант ${u.variantId}` : ''}`, 'Использований нет.');
      element('component-usages-status').textContent = `Использований: ${usageTotal} · ревизия ${atRevision}`;
    } catch (error) {
      if (!valid() || error.name === 'AbortError') return;
      element('component-title').textContent = 'Компонент недоступен'; element('component-usages-status').textContent = '';
      element('component-usages-error').textContent = error.message; element('component-usages-retry').hidden = false;
    }
  }
  element('components-search').addEventListener('submit', event => { event.preventDefault(); componentSearch = element('components-query').value.trim(); componentOffset = 0; componentSelection = null; usageOffset = 0; load(); });
  element('components-previous').addEventListener('click', () => { componentOffset = Math.max(0, componentOffset - pageSize); load(); });
  element('components-next').addEventListener('click', () => { componentOffset += pageSize; load(); });
  element('components-retry').addEventListener('click', load);
  element('component-usages-retry').addEventListener('click', load);
  element('usages-previous').addEventListener('click', () => { usageOffset = Math.max(0, usageOffset - pageSize); load(); });
  element('usages-next').addEventListener('click', () => { usageOffset += pageSize; load(); });

  return { reset, load };
}
