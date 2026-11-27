const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');

async function openDocument(page) {
  await page.goto('/');
  await page.getByLabel('Bearer-токен').fill(bearer);
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByLabel('Имя нового документа').fill('Members target');
  await page.getByRole('button', { name: 'Создать документ' }).click();
  await expect(page.getByRole('heading', { name: 'Members target' })).toBeVisible();
  await show(page, 'share');
}

test('keyboard assignment and confirmed removal use the real API', async ({ page }) => {
  await openDocument(page);
  const member = page.getByLabel('ID участника');
  await member.focus(); await page.keyboard.type('another-user'); await page.keyboard.press('Tab');
  await expect(page.getByLabel('Роль участника')).toBeFocused();
  await page.getByLabel('Роль участника').selectOption('Editor');
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Назначить роль' })).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('#member-status')).toContainText('Editor');
  let requests = 0; page.on('request', req => { if (req.method() === 'DELETE' && req.url().includes('/members/')) requests++; });
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Удалить участника' }).click(); expect(requests).toBe(0);
  page.once('dialog', dialog => { expect(dialog.message()).toContain('another-user'); return dialog.accept(); });
  await page.getByRole('button', { name: 'Удалить участника' }).click();
  await expect(page.locator('#member-status')).toContainText('Участник удалён'); expect(requests).toBe(1);
});

test('last owner, malformed IDs and server denial are explained', async ({ page }) => {
  await openDocument(page);
  await page.getByLabel('ID участника').fill('local-developer');
  await page.getByLabel('Роль участника').selectOption('Viewer');
  await page.getByRole('button', { name: 'Назначить роль' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'последнего Owner' })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Удалить участника' }).click();
  await expect(page.locator('#member-error')).toContainText('последнего Owner');
  await page.getByLabel('ID участника').fill('   ');
  await page.getByRole('button', { name: 'Назначить роль' }).click();
  await expect(page.locator('#member-error')).toContainText('корректный ID');
  await page.getByLabel('ID участника').fill('other');
  await page.route('**/members', route => route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }));
  await page.getByRole('button', { name: 'Назначить роль' }).click();
  await expect(page.locator('#member-error')).toContainText('Нет прав');
});

for (const role of ['Editor', 'Viewer']) test(`${role} does not see controls`, async ({ page }) => {
  await openDocument(page);
  await page.route('**/api/v1/documents?*', async route => { const response = await route.fetch(); const body = await response.json(); body.items.forEach(item => item.role = role); await route.fulfill({ response, json: body }); });
  await page.getByRole('link', { name: '← Документы' }).click();
  await page.getByRole('link', { name: 'Members target' }).click(); await show(page, 'share');
  await expect(page.getByRole('heading', { name: 'Members target' })).toBeVisible();
  await expect(page.locator('#member-management')).toBeHidden();
  await page.unrouteAll({ behavior: 'wait' });
});

test('own demotion and removal update the current context', async ({ page }) => {
  await openDocument(page);
  await page.getByLabel('ID участника').fill('another-owner');
  await page.getByRole('button', { name: 'Назначить роль' }).click();
  await expect(page.locator('#member-status')).toContainText('назначена');
  await page.getByLabel('ID участника').fill('local-developer');
  await page.getByLabel('Роль участника').selectOption('Viewer');
  await page.getByRole('button', { name: 'Назначить роль' }).click();
  await expect(page.locator('#member-management')).toBeHidden();
  await expect(page.locator('#status')).toContainText('Ваши права изменились');
});

test('own removal leaves the document', async ({ page }) => {
  await openDocument(page);
  await page.getByLabel('ID участника').fill('another-owner');
  await page.getByRole('button', { name: 'Назначить роль' }).click();
  await expect(page.locator('#member-status')).toContainText('назначена');
  await page.getByLabel('ID участника').fill('local-developer');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Удалить участника' }).click();
  await expect(page.getByRole('heading', { name: 'Документы', exact: true })).toBeVisible();
  await expect(page.locator('#status')).toContainText('Доступ к документу больше не предоставлен');
});

for (const action of ['navigate', 'logout']) test(`pending requests do not update after ${action}`, async ({ page }) => {
  await openDocument(page);
  let release; const gate = new Promise(resolve => release = resolve); let count = 0;
  await page.route('**/members', async route => { count++; await gate; await route.fulfill({ status: 409, json: { code: 'LAST_OWNER' } }).catch(() => {}); });
  await page.getByLabel('ID участника').fill('someone');
  await page.getByRole('button', { name: 'Назначить роль' }).click();
  await expect(page.getByRole('button', { name: 'Назначить роль' })).toBeDisabled();
  if (action === 'navigate') await page.getByRole('link', { name: '← Документы' }).click();
  else await page.locator('#editor-signout').click();
  release();
  if (action === 'navigate') { await page.getByRole('link', { name: 'Members target' }).click(); await show(page, 'share'); await expect(page.locator('#member-error')).toBeEmpty(); }
  else await expect(page.getByRole('heading', { name: 'Открыть рабочее пространство' })).toBeVisible();
  expect(count).toBe(1);
});
test('unknown outcome leaves stale Owner view and explains how to recover', async ({ page }) => {
  await openDocument(page);
  await page.route('**/members', route => route.abort('failed'));
  await page.getByLabel('ID участника').fill('local-developer');
  await page.getByRole('button', { name: 'Назначить роль' }).click();
  await expect(page.getByRole('heading', { name: 'Документы', exact: true })).toBeVisible();
  await expect(page.locator('#error')).toContainText('Не удалось подтвердить результат');
});

test('live access reconciliation demotes and restores an open document', async ({page}) => {
  test.setTimeout(60000);
  await openDocument(page);
  const documentUrl=page.url();
  let role='Viewer';
  await page.route('**/api/v1/documents?*', async route=>{
    const response=await route.fetch(), body=await response.json();
    body.items.forEach(item=>item.role=role);
    await route.fulfill({response,json:body});
  });
  await expect(page.locator('#page-access')).toHaveText('Только просмотр страниц.',{timeout:25000});
  await expect(page.locator('#member-management')).toBeHidden();
  await expect(page.getByRole('heading',{name:'Members target'})).toBeVisible();
  expect(page.url()).toBe(documentUrl);
  role='Owner';
  await expect(page.locator('#page-access')).toHaveText('',{timeout:25000});
  expect(page.url()).toBe(documentUrl);
});
