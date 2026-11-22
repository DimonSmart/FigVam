export function createTokens({ element, request, getContext, startRequest, stopLive, startLive, readPages }) {
  let tokenItems = [], selectedToken = null, tokenUsages = [], tokenLoad = 0;
  function resetTokens() {
    tokenLoad++; tokenItems = []; tokenUsages = []; selectedToken = null;
    element('token-create').inert = element('token-edit').inert = false;
    element('tokens-list').replaceChildren(); element('token-usages').replaceChildren();
    element('token-detail').hidden = true; element('token-create').hidden = true;
    element('tokens-error').textContent = ''; element('tokens-status').textContent = '';
    element('token-create').reset(); element('token-rename').reset(); element('token-set').reset();
  }
  async function readAllTokenPages(path, revision, signal, isCurrent) {
    let items = [], total;
    do {
      const result = await request(`${path}?revision=${revision}&offset=${items.length}&limit=100`, {}, signal, isCurrent);
      if (result.revision !== revision || !Array.isArray(result.items) || !Number.isInteger(result.total)) throw new Error('Некорректный ответ о токенах.');
      items.push(...result.items); total = result.total;
      if (!result.items.length && items.length < total) throw new Error('Неполный ответ о токенах.');
    } while (items.length < total);
    return items;
  }
  async function readTokens(base, atRevision, signal, isCurrent) {
    const items = await readAllTokenPages(`${base}/tokens`, atRevision, signal, isCurrent);
    const selection = selectedToken;
    const usages = selection && items.some(item => item.id === selection)
      ? await readAllTokenPages(`${base}/tokens/${encodeURIComponent(selection)}/usages`, atRevision, signal, isCurrent) : [];
    return { items, selection, usages };
  }
  async function readSelectedUsages(base, atRevision, signal, isCurrent) {
    const selection = selectedToken;
    const usages = selection ? await readAllTokenPages(`${base}/tokens/${encodeURIComponent(selection)}/usages`,
      atRevision, signal, isCurrent) : [];
    return { selection, usages };
  }
  function applySelectedUsages({ selection, usages }) {
    if (selection !== selectedToken) { selectToken(selectedToken); return; }
    tokenUsages = usages;
    renderTokens();
  }
  function applyTokens(snapshot) {
    tokenItems = snapshot.items;
    if (selectedToken !== snapshot.selection) { selectToken(selectedToken); return; }
    if (!tokenItems.some(item => item.id === selectedToken)) selectedToken = null;
    tokenUsages = snapshot.usages; renderTokens();
  }
  function describeExpression(expression) {
    if (expression?.expression === 'alias') return `Ссылка на токен ${expression.tokenId}`;
    const value = expression?.value;
    if (value?.type === 'spacing') return String(value.value);
    if (value?.type === 'color') return '#' + [value.red, value.green, value.blue, value.alpha].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    return JSON.stringify(expression);
  }
  function renderTokens() {
    const list = element('tokens-list'); list.replaceChildren();
    for (const item of tokenItems) {
      const li = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.textContent = `${item.name} (${({0: "Цвет", 1: "Отступ", 2: "Типографика", 3: "Геометрия", Color: "Цвет", Spacing: "Отступ"})[item.type] ?? item.type})`;
      button.setAttribute('aria-pressed', String(item.id === selectedToken));
      button.addEventListener('click', () => selectToken(item.id)); li.append(button); list.append(li);
    }
    element('tokens-status').textContent = tokenItems.length ? `Токенов: ${tokenItems.length}` : 'Токенов пока нет.';
    const item = tokenItems.find(t => t.id === selectedToken);
    element('token-detail').hidden = !item;
    if (!item) return;
    element('token-detail-title').textContent = item.name;
    element('token-values').textContent = `Light: ${describeExpression(item.values.Light)}; Dark: ${describeExpression(item.values.Dark)}`;
    element('token-edit').hidden = !['Owner', 'Editor'].includes(getContext().documentRole);
    element('token-set').hidden = !['Color', 'Spacing', 0, 1].includes(item.type);
    element('token-name').value = item.name;
    const usages = element('token-usages'); usages.replaceChildren();
    for (const usage of tokenUsages) {
      const li = document.createElement('li');
      li.textContent = [usage.kind, usage.ownerId, usage.property, usage.theme == null ? null : `тема ${usage.theme}`, usage.parameterId].filter(x => x != null).join(' · '); usages.append(li);
    }
    if (!tokenUsages.length) { const li = document.createElement('li'); li.textContent = 'Прямых использований нет.'; usages.append(li); }
  }
  async function selectToken(id) {
    selectedToken = id; tokenUsages = []; const current = ++tokenLoad, doc = getContext().documentId, atRevision = getContext().revision;
    renderTokens();
    if (!id || !Number.isSafeInteger(atRevision)) return;
    try {
      const items = await readAllTokenPages(`/api/v1/documents/${encodeURIComponent(doc)}/tokens/${encodeURIComponent(id)}/usages`, atRevision);
      if (current !== tokenLoad || doc !== getContext().documentId || atRevision !== getContext().revision) return;
      tokenUsages = items; element('tokens-error').textContent = ''; renderTokens();
    } catch (error) { if (current === tokenLoad && doc === getContext().documentId) element('tokens-error').textContent = error.message; }
  }
  function tokenExpression(type, raw) {
    if (type === 'Color' || type === 0) {
      if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(raw)) throw new Error('Введите цвет в формате #RRGGBB или #RRGGBBAA.');
      const hex = raw.slice(1) + (raw.length === 7 ? 'FF' : '');
      const [red, green, blue, alpha] = [0, 2, 4, 6].map(i => parseInt(hex.slice(i, i + 2), 16));
      return { expression: 'literal', value: { type: 'color', red, green, blue, alpha } };
    }
    if (!raw.trim() || !Number.isFinite(Number(raw))) throw new Error('Введите числовое значение отступа.');
    return { expression: 'literal', value: { type: 'spacing', value: Number(raw) } };
  }
  async function tokenCommand(command, data, selection) {
    if (!['Owner', 'Editor'].includes(getContext().documentRole)) return;
    stopLive(); const { signal, current } = startRequest();
    element('token-create').inert = element('token-edit').inert = true;
    element('tokens-error').textContent = ''; element('tokens-status').textContent = 'Сохранение…';
    try {
      await request(`/api/v1/documents/${encodeURIComponent(getContext().documentId)}/commands/${command}`, { method: 'POST', body: JSON.stringify({ commandId: crypto.randomUUID(), ...data }) }, signal);
      if (signal.aborted || current !== getContext().generation) return;
      if (selection) selectedToken = selection;
      await readPages(signal);
      if (current === getContext().generation) element('tokens-status').textContent = 'Изменение сохранено.';
    } catch (error) {
      if (error.name !== 'AbortError' && current === getContext().generation) element('tokens-error').textContent = error instanceof TypeError || error.status >= 500 ? 'Результат неизвестен. Обновите документ перед повтором.' : error.message;
    } finally { if (current === getContext().generation) { element('token-create').inert = element('token-edit').inert = false; startLive(); } }
  }
  element('token-create').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const type = element('new-token-type').value, id = crypto.randomUUID();
      const values = { Light: tokenExpression(type, element('new-token-light').value.trim()), Dark: tokenExpression(type, element('new-token-dark').value.trim()) };
      tokenCommand('add-token', { tokenId: id, name: element('new-token-name').value, type: type === 'Color' ? 0 : 1, values }, id);
    } catch (error) { element('tokens-error').textContent = error.message; }
  });
  element('token-rename').addEventListener('submit', event => { event.preventDefault(); tokenCommand('rename-token', { tokenId: selectedToken, name: element('token-name').value }); });
  element('token-set').addEventListener('submit', event => {
    event.preventDefault();
    try { const item = tokenItems.find(t => t.id === selectedToken); tokenCommand('set-token-value', { tokenId: selectedToken, theme: element('token-theme').value === 'Light' ? 0 : 1, value: tokenExpression(item.type, element('token-value').value.trim()) }); }
    catch (error) { element('tokens-error').textContent = error.message; }
  });

  return { reset: resetTokens, read: readTokens, apply: applyTokens, readSelectedUsages, applySelectedUsages,
    get items() { return tokenItems; } };
}
