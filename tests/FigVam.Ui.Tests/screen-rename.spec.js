const { test, expect, bearer } = require('./fixtures');
const { randomUUID } = require('node:crypto');

async function setup(request) {
  const documentId = randomUUID(), pageId = randomUUID(), screenId = randomUUID();
  const headers = { Authorization: `Bearer ${bearer}` };
  expect((await request.post('/api/v1/documents', {
    headers, data: { documentId, name: 'Screen rename' }
  })).ok()).toBeTruthy();
  for (const [command, data] of [
    ['add-page', { pageId }],
    ['add-screen', { pageId, screenId, dimensions: { width: 640, height: 480 } }]
  ]) {
    expect((await request.post(`/api/v1/documents/${documentId}/commands/${command}`, {
      headers, data: { commandId: randomUUID(), ...data }
    })).ok()).toBeTruthy();
  }
  return { documentId, screenId, headers };
}

async function open(page, documentId) {
  await page.goto(`/documents/${documentId}`);
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#editor-view')).toBeVisible();
}

test('screen can be renamed inline and its stable ID and name survive reload', async ({ page, request }) => {
  const { documentId, screenId, headers } = await setup(request);
  await open(page, documentId);
  await expect(page.locator('#screens .screen-select')).toContainText('Экран 1 · 640 × 480');
  await page.getByRole('button', { name: 'Переименовать экран «Экран 1»' }).click();
  await expect(page.getByLabel('Имя экрана')).toBeFocused();
  await page.getByLabel('Имя экрана').fill('Отменённый ввод');
  await page.getByLabel('Имя экрана').press('Escape');
  await expect(page.locator('#screens .screen-select')).toContainText('Экран 1');
  await page.getByRole('button', { name: 'Переименовать экран «Экран 1»' }).click();
  await page.getByLabel('Имя экрана').fill('Экран авторизации');
  await page.getByLabel('Имя экрана').press('Tab');
  await expect(page.locator('#screens .screen-select')).toContainText('Экран авторизации · 640 × 480');
  await expect(page.locator('#screens .screen-select')).toHaveAttribute('data-screen-id', screenId);
  const pages = await request.get(`/api/v1/documents/${documentId}/pages?fields=name`, { headers });
  const pageId = (await pages.json()).items[0].id;
  const response = await request.get(`/api/v1/documents/${documentId}/pages/${pageId}/screens?fields=name,dimensions`, { headers });
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).items[0].name).toBe('Экран авторизации');

  await page.reload();
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#screens .screen-select')).toContainText('Экран авторизации');
});

test('successful editor notifications disappear while command errors remain visible', async ({ page, request }) => {
  const { documentId } = await setup(request);
  await open(page, documentId);
  await page.getByRole('button', { name: 'Обновить страницы' }).click();
  await expect(page.locator('#status')).toHaveText('Страницы обновлены.');
  await expect(page.locator('#status')).toBeEmpty({ timeout: 6500 });
  await page.route('**/commands/rename-screen', route => route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }));
  await page.getByRole('button', { name: 'Переименовать экран «Экран 1»' }).click();
  await page.getByLabel('Имя экрана').fill('Access denied');
  await page.getByLabel('Имя экрана').press('Enter');
  await expect(page.locator('#error')).toContainText('Нет доступа');
  await page.waitForTimeout(4500);
  await expect(page.locator('#error')).toContainText('Нет доступа');
});