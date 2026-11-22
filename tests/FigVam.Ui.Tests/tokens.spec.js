const { test, expect, bearer } = require('./fixtures');
const { randomUUID } = require('node:crypto');
async function open(page) {
  await page.goto('/'); await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByLabel('Имя нового документа').fill('Tokens'); await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Токены дизайна' })).toBeVisible();
}
test('creates, renames, updates and follows direct usages', async ({ page, request }) => {
  await open(page); await page.getByLabel('Имя токена', { exact: true }).fill('Space');
  await page.getByLabel('Тип токена').selectOption('Spacing');
  await page.getByLabel('Light', { exact: true }).fill('8'); await page.getByLabel('Dark', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Создать токен' }).click(); await expect(page.locator('#token-values')).toHaveText('Light: 8; Dark: 12');
  await page.getByLabel('Новое имя токена').fill('Gap'); await page.getByRole('button', { name: 'Переименовать токен' }).click();
  await expect(page.locator('#token-detail-title')).toHaveText('Gap');
  await page.getByRole('region', { name: 'Токены дизайна' }).getByLabel('Тема', { exact: true }).selectOption('Dark'); await page.getByLabel('Новое значение').fill('24');
  await page.getByRole('button', { name: 'Сохранить значение' }).click(); await expect(page.locator('#token-values')).toHaveText('Light: 8; Dark: 24');
  const doc = page.url().split('/').pop(), headers = { Authorization: `Bearer ${bearer}` };
  const tokens = await (await request.get(`/api/v1/documents/${doc}/tokens`, { headers })).json();
  const alias = { expression: 'alias', tokenId: tokens.items[0].id };
  expect((await request.post(`/api/v1/documents/${doc}/commands/add-token`, { headers, data: { commandId: randomUUID(), tokenId: randomUUID(), name: 'Alias', type: 1, values: { Light: alias, Dark: alias } } })).ok()).toBeTruthy();
  await expect(page.locator('#tokens-list')).toContainText('Alias'); await expect(page.locator('#token-usages')).toContainText('tokenAlias');
});
test('validates input and displays authorization errors', async ({ page }) => {
  await open(page); await page.getByLabel('Имя токена', { exact: true }).fill('Color');
  await page.getByLabel('Light', { exact: true }).fill('bad'); await page.getByLabel('Dark', { exact: true }).fill('#000000');
  await page.getByRole('button', { name: 'Создать токен' }).click(); await expect(page.locator('#tokens-error')).toContainText('#RRGGBB');
  await page.getByLabel('Light', { exact: true }).fill('#ffffff');
  await page.route('**/commands/add-token', route => route.fulfill({ status: 403, contentType: 'application/json', body: '{"code":"FORBIDDEN"}' }));
  await page.getByRole('button', { name: 'Создать токен' }).click(); await expect(page.locator('#tokens-error')).toContainText('Нет доступа');
});
test('viewer inspects tokens without mutation controls', async ({ page }) => {
  await page.route('**/api/v1/documents?*', async route => { const response = await route.fetch(), body = await response.json(); for (const item of body.items) item.role = 'Viewer'; await route.fulfill({ response, json: body }); });
  const id = randomUUID(), headers = { Authorization: `Bearer ${bearer}` };
  expect((await page.request.post('/api/v1/documents', { headers, data: { documentId: id, name: 'Read only' } })).ok()).toBeTruthy();
  const literal = { expression: 'literal', value: { type: 'spacing', value: 8 } };
  expect((await page.request.post(`/api/v1/documents/${id}/commands/add-token`, { headers, data: { commandId: randomUUID(), tokenId: randomUUID(), name: 'Space', type: 1, values: { Light: literal, Dark: literal } } })).ok()).toBeTruthy();
  await page.goto(`/documents/${id}`); await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer); await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('button', { name: 'Space (Отступ)' }).click(); await expect(page.locator('#token-values')).toContainText('Light: 8');
  await expect(page.locator('#token-usages')).toContainText('Прямых использований нет');
  await expect(page.getByRole('button', { name: 'Создать токен' })).toBeHidden(); await expect(page.getByRole('button', { name: 'Переименовать токен' })).toBeHidden();
});

test('creates and updates color values including alpha', async ({ page }) => {
  await open(page); await page.getByLabel('Имя токена', { exact: true }).fill('Ink');
  await page.getByLabel('Light', { exact: true }).fill('#123456'); await page.getByLabel('Dark', { exact: true }).fill('#ABCDEF80');
  await page.getByRole('button', { name: 'Создать токен' }).click();
  await expect(page.locator('#token-values')).toHaveText('Light: #123456FF; Dark: #ABCDEF80');
  await page.getByLabel('Новое значение').fill('#01020304'); await page.getByRole('button', { name: 'Сохранить значение' }).click();
  await expect(page.locator('#token-values')).toHaveText('Light: #01020304; Dark: #ABCDEF80');
});
