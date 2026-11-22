const { test, expect, bearer } = require('./fixtures');

async function login(page) {
  await page.goto('/');
  await page.getByLabel('Bearer-токен').fill(bearer);
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.locator('#documents-view')).toBeVisible();
}

test('document dashboard preserves the primary create and import actions', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Документы', exact: true })).toBeVisible();
  await expect(page.locator('#home-documents')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#home-empty')).toBeVisible();
  await expect(page.locator('#home-users')).toBeHidden();
  await expect(page.getByLabel('Файл документа (document.json или .figvam)')).toBeVisible();

  await page.getByLabel('Имя нового документа').fill('My first design');
  await page.getByRole('button', { name: 'Создать документ' }).click();
  await expect(page.getByRole('heading', { name: 'My first design' })).toBeVisible();

  await page.getByRole('link', { name: '← Документы' }).click();
  await expect(page.locator('#home-empty')).toBeHidden();
  await expect(page.locator('#document-list .document-art')).toHaveCount(1);
  await expect(page.locator('#home-count')).toHaveText('1 на странице');
  await expect(page.getByRole('link', { name: 'My first design' })).toBeVisible();
});

test('small screens keep the document actions within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.getByRole('button', { name: 'Создать документ' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть файл как новый документ' })).toBeVisible();
  const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflowing).toBe(false);
});

test('administration is a separate navigation section for permitted users', async ({ page }) => {
  await page.route('**/api/auth/config', route => route.fulfill({ json: { mode: 'google' } }));
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    authenticated: true, csrfToken: 'test-csrf', actorId: 'google:admin', admin: true
  } }));
  await page.route('**/api/v1/documents?*', route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route('**/api/users', route => route.fulfill({ json: { users: [] } }));
  await page.goto('/');
  await expect(page.locator('#home-users')).toBeVisible();
  await expect(page.locator('#user-admin')).toBeHidden();
  await page.getByRole('button', { name: 'Пользователи' }).click();
  await expect(page.locator('#user-admin')).toBeVisible();
  await expect(page.locator('#home-documents-content')).toBeHidden();
  await expect(page.getByLabel('Email приглашённого пользователя')).toBeVisible();
  await page.getByRole('button', { name: 'Документы', exact: true }).click();
  await expect(page.locator('#home-documents-content')).toBeVisible();
  await expect(page.locator('#home-admin-content')).toBeHidden();
});
