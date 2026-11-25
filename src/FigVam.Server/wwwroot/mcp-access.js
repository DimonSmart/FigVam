export function createMcpAccess({ request, getContext }) {
  const menu = document.getElementById('mcp-access-menu');
  const body = document.getElementById('mcp-access-body');
  let controller = null;
  let current = null;

  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (label, handler) => {
    const node = el('button', label);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  };
  const valid = operation => {
    const context = getContext();
    return menu.open && current === operation && !operation.signal.aborted &&
      context.documentId === operation.documentId && context.token === operation.token &&
      context.navigationEpoch === operation.navigationEpoch;
  };
  function clear() {
    controller?.abort();
    controller = null;
    current = null;
    body.replaceChildren();
  }
  function reset() {
    menu.open = false;
    clear();
  }
  async function load(method = 'GET') {
    clear();
    const context = getContext();
    if (!context.documentId || !menu.open) return;
    controller = new AbortController();
    const operation = { ...context, signal: controller.signal };
    current = operation;
    body.append(el('p', 'Загрузка MCP-доступа…'));
    try {
      const status = await request('/api/v1/documents/' + encodeURIComponent(context.documentId) + '/mcp-access',
        { method }, operation.signal, () => valid(operation));
      if (!valid(operation)) return;
      render(status, operation);
    } catch (error) {
      if (!valid(operation) || error.name === 'AbortError') return;
      body.replaceChildren();
      const alert = el('p', error.code === 'MCP_ENDPOINT_NOT_CONFIGURED' ?
        'Адрес MCP-сервера не настроен.' : error.message);
      alert.setAttribute('role', 'alert');
      body.append(alert, button('Обновить', () => load()));
    }
  }
  function render(status, operation) {
    const panel = el('section', '', 'mcp-access-panel');
    const state = el('p', status.enabled ? 'Доступ разрешён' : 'Доступ не предоставлен');
    state.setAttribute('role', 'status');
    panel.append(state);
    if (!status.enabled) {
      panel.append(el('p', 'Разрешите AI-агенту редактировать текущий документ.'),
        button('Разрешить', () => load('POST')));
    } else {
      const documentName = el('p', document.getElementById('document-title').textContent);
      const endpointLabel = el('label', 'Адрес MCP-сервера');
      const endpoint = el('input'); endpoint.readOnly = true; endpoint.value = status.endpoint;
      endpointLabel.append(endpoint);
      const tokenLabel = el('label', 'Токен доступа');
      const secret = el('input'); secret.readOnly = true; secret.type = 'password';
      secret.autocomplete = 'off'; secret.value = status.token; tokenLabel.append(secret);
      const controls = el('div', '', 'mcp-access-actions');
      const reveal = button('Показать', () => {
        secret.type = secret.type === 'password' ? 'text' : 'password';
        reveal.textContent = secret.type === 'password' ? 'Показать' : 'Скрыть';
      });
      const feedback = el('p'); feedback.setAttribute('role', 'status');
      const copy = async text => {
        try {
          await navigator.clipboard.writeText(text);
          if (valid(operation)) feedback.textContent = 'Скопировано.';
        } catch {
          if (valid(operation)) feedback.textContent = 'Не удалось скопировать.';
        }
      };
      const revoke = button('', () => load('DELETE'));
      revoke.title = 'Отозвать MCP-доступ';
      revoke.setAttribute('aria-label', revoke.title);
      revoke.classList.add('icon-action');
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('width', '18'); icon.setAttribute('height', '18');
      icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7');
      icon.append(path); revoke.append(icon);
      controls.append(reveal, button('Копировать токен', () => copy(status.token)), revoke);
      panel.append(documentName, endpointLabel, tokenLabel, controls,
        button('Копировать конфигурацию MCP', () => copy(JSON.stringify({ mcpServers: { figvam: {
          type: 'http', url: status.endpoint, headers: { Authorization: 'Bearer ' + status.token }
        } } }, null, 2))), feedback,
        el('p', 'Доступ действует до отзыва или перезапуска сервера.'));
    }
    body.replaceChildren(panel);
  }
  menu.addEventListener('toggle', () => {
    if (menu.open) load();
    else clear();
  });
  return { reset };
}
