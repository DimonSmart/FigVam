const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');

async function openDocument(page) {
  await page.goto('/');
  await page.getByLabel('Bearer-токен').fill(bearer);
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByLabel('Имя нового документа').fill('Original');
  await page.getByRole('button', { name: 'Создать документ' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Original');
  await show(page, 'document');
}

test('renames through the command after acceptance and prevents duplicate submissions', async ({ page }) => {
  await openDocument(page);
  const name = page.getByLabel('Имя документа', { exact: true });
  await expect(name).toHaveValue('Original');
  let release, count = 0;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/commands/rename-document', async route => { count++; await gate; await route.continue(); });
  await name.fill('Renamed');
  await expect(page.getByRole('button', { name: 'Переименовать документ' })).toHaveCount(0);
  await name.press('Enter');
  await expect(name).toBeDisabled();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Original');
  await expect(page).toHaveTitle('Original — FigVam');
  release();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Renamed');
  await expect(page).toHaveTitle('Renamed — FigVam');
  await expect(page.locator('#document-rename-status')).toHaveText('Имя документа изменено.');
  expect(count).toBe(1);
});

test('hides rename for Viewer and permits Editor', async ({ page }) => {
  await openDocument(page);
  for (const role of ['Viewer', 'Editor']) {
    await page.route('**/api/v1/documents?*', async route => {
      const response = await route.fetch(); const body = await response.json();
      body.items = body.items.map(item => ({ ...item, role }));
      await route.fulfill({ response, json: body });
    });
    await page.getByRole('link', { name: '← Документы' }).click();
    await page.getByRole('link', { name: 'Original', exact: true }).click();
    await show(page, 'document'); await expect(page.locator('#document-rename')).toBeVisible({ visible: role === 'Editor' });
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('reports validation and authorization rejection without changing the title', async ({ page }) => {
  await openDocument(page);
  const name = page.getByLabel('Имя документа', { exact: true });
  for (const status of [400, 403]) {
    await page.route('**/commands/rename-document', route => route.fulfill({ status, json: {} }));
    await name.fill('Rejected' + status);
    await page.getByLabel('Имя документа', { exact: true }).press('Enter');
    await expect(page.locator('#document-rename-error')).toContainText(status === 400 ? 'Проверьте' : 'Нет доступа');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Original');
    await expect(page).toHaveTitle('Original — FigVam');
    await page.unroute('**/commands/rename-document');
  }
});

test('ignores an in-flight response after logout', async ({ page }) => {
  await openDocument(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/commands/rename-document', async route => { await gate; await route.fulfill({ status: 200, json: {} }).catch(() => {}); });
  await page.getByLabel('Имя документа', { exact: true }).fill('Late');
  await page.getByLabel('Имя документа', { exact: true }).press('Enter');
  await page.locator('#editor-signout').click();
  release();
  await expect(page).toHaveTitle('FigVam — документы');
  await expect(page.getByRole('heading', { name: 'Открыть рабочее пространство' })).toBeVisible();
});
