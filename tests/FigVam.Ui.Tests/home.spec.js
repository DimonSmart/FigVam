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

test('desktop dashboard loads layout CSS and keeps navigation and actions separated', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const failedStyles = [];
  page.on('response', response => {
    if (response.url().endsWith('/home.css') && !response.ok())
      failedStyles.push(response.status());
  });
  await login(page);
  const geometry = await page.evaluate(() => {
    const rect = selector => {
      const { x, y, right, bottom, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { x, y, right, bottom, width, height };
    };
    return {
      layout: getComputedStyle(document.querySelector('.home-layout')).display,
      sidebar: rect('.home-sidebar'),
      main: rect('.home-main'),
      navIcon: rect('.home-nav-icon'),
      projects: rect('.home-projects'),
      actions: rect('.home-actions'),
      create: rect('.home-action-card'),
      import: rect('.home-action-secondary'),
      filePicker: getComputedStyle(document.querySelector('.home-file-input')).opacity,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1
    };
  });
  expect(failedStyles).toEqual([]);
  expect(geometry.layout).toBe('grid');
  expect(geometry.sidebar.width).toBeGreaterThan(180);
  expect(geometry.sidebar.width).toBeLessThan(260);
  expect(geometry.navIcon.width).toBeLessThanOrEqual(24);
  expect(geometry.navIcon.height).toBeLessThanOrEqual(24);
  expect(geometry.main.x).toBeGreaterThanOrEqual(geometry.sidebar.right - 1);
  expect(geometry.actions.x).toBeGreaterThanOrEqual(geometry.projects.right);
  expect(geometry.import.y).toBeGreaterThanOrEqual(geometry.create.bottom);
  expect(geometry.filePicker).toBe('0');
  expect(geometry.overflow).toBe(false);

  await page.getByLabel('Имя нового документа').fill('Design review');
  await page.getByRole('button', { name: 'Создать документ' }).click();
  await page.getByRole('link', { name: '← Документы' }).click();
  const card = await page.locator('#document-list li').first().boundingBox();
  expect(card.width).toBeGreaterThan(200);
  expect(card.height).toBeGreaterThan(190);
  await page.screenshot({ path: testInfo.outputPath('home-desktop.png'), fullPage: true });
});

test('localized file picker displays selected filename without native button text', async ({ page }) => {
  await login(page);
  await page.getByLabel('Файл документа (document.json или .figvam)').setInputFiles({
    name: 'my-design.figvam', mimeType: 'application/zip', buffer: Buffer.from('fake')
  });
  await expect(page.locator('#import-file-name')).toHaveText('my-design.figvam');
  await expect(page.locator('.home-file-picker')).toBeVisible();
});

test('incompatible documents remain visible and only owners can delete without opening', async ({ page }) => {
  const old = '00000000-0000-0000-0000-000000000001';
  const viewer = '00000000-0000-0000-0000-000000000002';
  let deleted = false;
  await page.route('**/api/v1/documents?*', route => route.fulfill({ json: { items: [
    ...(!deleted ? [{ documentId: old, name: 'Old design', role: 'Owner', profileVersion: 2,
      currentProfileVersion: 5, compatibilityIssue: 'UNSUPPORTED_PROFILE_VERSION', revision: 3 }] : []),
    { documentId: viewer, name: 'Shared old design', role: 'Viewer', profileVersion: 2,
      currentProfileVersion: 5, compatibilityIssue: 'UNSUPPORTED_PROFILE_VERSION', revision: 0 }
  ], nextCursor: null } }));
  await page.route('**/commands/delete-document', async route => {
    const body = route.request().postDataJSON();
    expect(route.request().url()).toContain(old);
    expect(body.expectedRevision).toBe(3);
    deleted = true;
    await route.fulfill({ json: { code: 'ACCEPTED', documentId: old, commandId: body.commandId, revision: 4 } });
  });
  await login(page);
  await expect(page.getByText('Old design', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Old design', exact: true })).toHaveCount(0);
  await expect(page.getByText('Несовместимый профиль: v2 (текущий v5)')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Удалить документ «Shared old design»' })).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Удалить документ «Old design»' }).click();
  await expect(page.getByText('Old design', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Shared old design', { exact: true })).toBeVisible();
});
