const { test, expect, bearer } = require('./fixtures');
const { randomUUID } = require('node:crypto');

// A synthetic test-only local transport credential, never an OpenAI API key.
const key = 'fvmt_' + 'A'.repeat(64);
test.use({ tunnelKey: key });

test('ChatGPT tunnel can be granted, revoked and switched without copying tokens', async ({ page, request, server }) => {
  await page.setViewportSize({ width: 1700, height: 1100 });
  const a = randomUUID(), b = randomUUID();
  for (const [documentId, name] of [[a, 'Tunnel A'], [b, 'Tunnel B']]) {
    const response = await request.post(server.url + '/api/v1/documents', {
      headers: { Authorization: 'Bearer ' + bearer }, data: { documentId, name }
    });
    expect(response.ok()).toBeTruthy();
  }
  let id = 0, version;
  async function rpc(method, params, notification = false) {
    const response = await request.post(server.url + '/mcp', {
      headers: { 'X-FigVam-Tunnel-Key': key, Accept: 'application/json, text/event-stream',
        ...(version ? { 'MCP-Protocol-Version': version } : {}) },
      data: { jsonrpc: '2.0', ...(notification ? {} : { id: ++id }), method, params }
    });
    expect(response.ok(), 'MCP ' + method).toBeTruthy();
    if (notification) return;
    const body = await response.text();
    const message = body.startsWith('{') ? JSON.parse(body) :
      body.split(/\r?\n/).filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(message => message.id === id);
    expect(message?.error).toBeUndefined();
    return message.result;
  }
  version = (await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {},
    clientInfo: { name: 'FigVam tunnel test', version: '1' } })).protocolVersion;
  await rpc('notifications/initialized', {}, true);
  expect((await rpc('tools/list', {})).tools).toHaveLength(30);
  const call = (name, args = {}) => rpc('tools/call', { name, arguments: args });
  expect((await call('get_document')).structuredContent.code).toBe('MCP_TUNNEL_ACCESS_REQUIRED');

  await page.goto(server.url);
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('link', { name: 'Tunnel A', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/documents/' + a + '$'));
  const menu = page.locator('#mcp-access-menu summary');
  const panel = page.getByRole('region', { name: 'ChatGPT Tunnel' });
  await menu.click();
  await panel.getByRole('button', { name: 'Разрешить доступ через ChatGPT', exact: true }).click();
  await expect(panel.getByText('Доступ через ChatGPT разрешён', { exact: true })).toBeVisible();
  expect((await call('get_document')).structuredContent.documentId).toBe(a);
  expect((await call('create_page')).isError).not.toBe(true);
  await expect(page.getByLabel('Токен доступа', { exact: true })).toHaveCount(0);
  await menu.click();

  await page.getByRole('link', { name: '← Документы' }).click();
  await page.getByRole('link', { name: 'Tunnel B', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/documents/' + b + '
  await expect(panel.getByText('Другой документ уже разрешён', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Разрешить доступ через ChatGPT' })).toHaveCount(0);
  await page.getByRole('link', { name: '← Документы' }).click();
  await page.getByRole('link', { name: 'Tunnel A', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/documents/' + a + '
  await panel.getByRole('button', { name: 'Отозвать доступ через ChatGPT', exact: true }).click();
  await expect(panel.getByText('Доступ через ChatGPT не предоставлен', { exact: true })).toBeVisible();
  expect((await call('create_page')).structuredContent.code).toBe('MCP_TUNNEL_ACCESS_REQUIRED');

  await page.goto(server.url + '/documents/' + b);
  await menu.click();
  await panel.getByRole('button', { name: 'Разрешить доступ через ChatGPT', exact: true }).click();
  await expect(panel.getByText('Доступ через ChatGPT разрешён', { exact: true })).toBeVisible();
  expect((await call('get_document')).structuredContent.documentId).toBe(b);
  expect((await call('create_page')).isError).not.toBe(true);
  await menu.click();
  await expect(panel).toHaveCount(0);
});
));
  await menu.click();
  await expect(panel.getByText('Другой документ уже разрешён', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Разрешить доступ через ChatGPT' })).toHaveCount(0);
  await page.goto(server.url + '/documents/' + a);
  await menu.click();
  await panel.getByRole('button', { name: 'Отозвать доступ через ChatGPT', exact: true }).click();
  await expect(panel.getByText('Доступ через ChatGPT не предоставлен', { exact: true })).toBeVisible();
  expect((await call('create_page')).structuredContent.code).toBe('MCP_TUNNEL_ACCESS_REQUIRED');

  await page.getByRole('link', { name: '← Документы' }).click();
  await page.getByRole('link', { name: 'Tunnel B', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/documents/' + b + '
  await panel.getByRole('button', { name: 'Разрешить доступ через ChatGPT', exact: true }).click();
  await expect(panel.getByText('Доступ через ChatGPT разрешён', { exact: true })).toBeVisible();
  expect((await call('get_document')).structuredContent.documentId).toBe(b);
  expect((await call('create_page')).isError).not.toBe(true);
  await menu.click();
  await expect(panel).toHaveCount(0);
});
));
  await menu.click();
  await panel.getByRole('button', { name: 'Разрешить доступ через ChatGPT', exact: true }).click();
  await expect(panel.getByText('Доступ через ChatGPT разрешён', { exact: true })).toBeVisible();
  expect((await call('get_document')).structuredContent.documentId).toBe(b);
  expect((await call('create_page')).isError).not.toBe(true);
  await menu.click();
  await expect(panel).toHaveCount(0);
});
));
  await menu.click();
  await panel.getByRole('button', { name: 'Отозвать доступ через ChatGPT', exact: true }).click();
  await expect(panel.getByText('Доступ через ChatGPT не предоставлен', { exact: true })).toBeVisible();
  expect((await call('create_page')).structuredContent.code).toBe('MCP_TUNNEL_ACCESS_REQUIRED');

  await page.goto(server.url + '/documents/' + b);
  await menu.click();
  await panel.getByRole('button', { name: 'Разрешить доступ через ChatGPT', exact: true }).click();
  await expect(panel.getByText('Доступ через ChatGPT разрешён', { exact: true })).toBeVisible();
  expect((await call('get_document')).structuredContent.documentId).toBe(b);
  expect((await call('create_page')).isError).not.toBe(true);
  await menu.click();
  await expect(panel).toHaveCount(0);
});
));
  await menu.click();
  await expect(panel.getByText('Другой документ уже разрешён', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Разрешить доступ через ChatGPT' })).toHaveCount(0);
  await page.goto(server.url + '/documents/' + a);
  await menu.click();
  await panel.getByRole('button', { name: 'Отозвать доступ через ChatGPT', exact: true }).click();
  await expect(panel.getByText('Доступ через ChatGPT не предоставлен', { exact: true })).toBeVisible();
  expect((await call('create_page')).structuredContent.code).toBe('MCP_TUNNEL_ACCESS_REQUIRED');

  await page.getByRole('link', { name: '← Документы' }).click();
  await page.getByRole('link', { name: 'Tunnel B', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/documents/' + b + '
  await panel.getByRole('button', { name: 'Разрешить доступ через ChatGPT', exact: true }).click();
  await expect(panel.getByText('Доступ через ChatGPT разрешён', { exact: true })).toBeVisible();
  expect((await call('get_document')).structuredContent.documentId).toBe(b);
  expect((await call('create_page')).isError).not.toBe(true);
  await menu.click();
  await expect(panel).toHaveCount(0);
});
));
  await menu.click();
  await panel.getByRole('button', { name: 'Разрешить доступ через ChatGPT', exact: true }).click();
  await expect(panel.getByText('Доступ через ChatGPT разрешён', { exact: true })).toBeVisible();
  expect((await call('get_document')).structuredContent.documentId).toBe(b);
  expect((await call('create_page')).isError).not.toBe(true);
  await menu.click();
  await expect(panel).toHaveCount(0);
});
