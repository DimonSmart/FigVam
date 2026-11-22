const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');

async function openDocument(page) {
  await page.goto('/');
  await page.getByLabel('Bearer-токен').fill(bearer);
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByLabel('Имя нового документа').fill('Deletion target');
  await page.getByRole('button', { name: 'Создать документ' }).click();
  await expect(page.getByRole('heading', { name: 'Deletion target' })).toBeVisible();
  await show(page, 'document');
}
async function confirmDeletion(page) {
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Удалить документ', exact: true }).click();
}

test('confirmation names document, cancellation does nothing, acceptance deletes once', async ({ page }) => {
  await openDocument(page);
  let count = 0, body;
  await page.route('**/commands/delete-document', async route => { count++; body = route.request().postDataJSON(); await route.continue(); });
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('Deletion target'); expect(dialog.message()).toContain('Удалить'); await dialog.dismiss(); });
  await page.getByRole('button', { name: 'Удалить документ', exact: true }).click();
  expect(count).toBe(0);
  const revision = Number((await page.locator('#revision').textContent()).match(/\d+/)[0]);
  await confirmDeletion(page);
  await expect(page.getByRole('heading', { name: 'Документы' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Deletion target' })).toHaveCount(0);
  await expect(page.locator('#status')).toContainText('Документ удалён');
  expect(count).toBe(1); expect(body.expectedRevision).toBe(revision);
});

test('Editor and Viewer cannot delete', async ({ page }) => {
  await openDocument(page);
  for (const role of ['Editor', 'Viewer']) {
    await page.route('**/api/v1/documents?*', async route => { const response = await route.fetch(); const body = await response.json(); body.items.forEach(item => item.role = role); await route.fulfill({ response, json: body }); });
    await page.getByRole('link', { name: '← Документы' }).click();
    await page.getByRole('link', { name: 'Deletion target' }).click();
    await expect(page.locator('#delete-document')).toBeHidden();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('conflict refreshes and access errors leave the document', async ({ page }) => {
  await openDocument(page);
  await page.route('**/commands/delete-document', route => route.fulfill({ status: 409, json: { code: 'REVISION_CONFLICT' } }));
  await confirmDeletion(page);
  await expect(page.locator('#error')).toContainText('Документ изменился');
  await expect(page.getByRole('heading', { name: 'Deletion target' })).toBeVisible();
  await page.unroute('**/commands/delete-document');
  await page.route('**/commands/delete-document', route => route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }));
  await confirmDeletion(page);
  await expect(page.getByRole('heading', { name: 'Документы' })).toBeVisible();
  await expect(page.locator('#error')).toContainText('Нет прав');
});

test('lost acknowledgement retries identical command and hides stale content', async ({ page }) => {
  await openDocument(page);
  const bodies = [];
  await page.route('**/commands/delete-document', async route => {
    bodies.push(route.request().postData());
    if (bodies.length === 1) { await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  await confirmDeletion(page);
  await expect(page.locator('#delete-message')).toContainText('неизвестен');
  await expect(page.locator('#editor-view')).toBeHidden();
  await page.getByRole('button', { name: 'Повторить проверку удаления' }).click();
  await expect(page.getByRole('heading', { name: 'Документы' })).toBeVisible();
  expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]);
});

test('concurrent deletion is reported without stale content', async ({ page }) => {
  await openDocument(page);
  await page.route('**/commands/delete-document', route => route.fulfill({ status: 404, json: { code: 'DOCUMENT_NOT_FOUND' } }));
  await confirmDeletion(page);
  await expect(page.getByRole('heading', { name: 'Документы' })).toBeVisible();
  await expect(page.locator('#error')).toContainText('уже удалён');
  await expect(page.locator('#editor-view')).toBeHidden();
});

for (const action of ['navigate', 'logout']) test(`ignores pending response after ${action}`, async ({ page }) => {
  await openDocument(page);
  let release; const gate = new Promise(resolve => release = resolve);
  let count = 0; const bodies = [];
  await page.route('**/commands/delete-document', async route => { count++; bodies.push(route.request().postData()); await gate; await route.fulfill({ status: 403, json: {} }).catch(() => {}); });
  await confirmDeletion(page);
  await expect(page.locator('#delete-document')).toBeDisabled();
  if (action === 'navigate') await page.getByRole('link', { name: '← Документы' }).click();
  else await page.getByRole('button', { name: 'Забыть токен' }).click();
  release();
  if (action === 'navigate') await expect(page.getByRole('heading', { name: 'Документы' })).toBeVisible();
  else await expect(page.getByRole('heading', { name: 'Открыть рабочее пространство' })).toBeVisible();
  if (action === 'navigate') {
    await expect(page.locator('#delete-message')).toContainText('неизвестен');
    await expect(page.getByRole('button', { name: 'Повторить проверку удаления' })).toBeVisible();
    await page.getByRole('link', { name: 'Deletion target' }).click();
    await expect(page.locator('#editor-view')).toBeHidden();
    await page.getByRole('button', { name: 'Повторить проверку удаления' }).click();
    await expect(page.locator('#error')).toContainText('Нет прав');
    expect(count).toBe(2); expect(bodies[0]).toBe(bodies[1]);
  } else await expect(page.locator('#delete-result')).toBeHidden();
  if (action === 'logout') expect(count).toBe(1);
});
