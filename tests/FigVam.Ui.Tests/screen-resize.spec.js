const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');
const { randomUUID } = require('node:crypto');
async function open(page, id) {
  await page.goto(`/documents/${id}`);
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#editor-view')).toBeVisible();
}
async function setup(request) {
  const id = randomUUID(), pageId = randomUUID(), screenId = randomUUID();
  const headers = { Authorization: `Bearer ${bearer}` };
  expect((await request.post('/api/v1/documents', { headers, data: { documentId: id, name: 'Resize' } })).ok()).toBeTruthy();
  for (const [name, data] of [['add-page', { pageId }], ['add-screen', { pageId, screenId, dimensions: { width: 640, height: 480 } }]])
    expect((await request.post(`/api/v1/documents/${id}/commands/${name}`, { headers, data: { commandId: randomUUID(), ...data } })).ok()).toBeTruthy();
  return { id, pageId, screenId };
}
async function select(page) { await page.locator('#screens button').first().click(); await expect(page.locator('#screen-size-saved')).toContainText('640 × 480'); }
test('version errors remain independent of resize errors', async ({ page, request }) => {
  const { id } = await setup(request); await open(page, id); await select(page);
  await show(page, 'document'); await page.getByLabel('Имя версии (необязательно)').fill('Исходная');
  await show(page, 'document'); await page.getByRole('button', { name: 'Создать версию' }).click();
  const restore = page.getByRole('button', { name: /Восстановить версию Исходная/ });
  await expect(restore).toBeVisible();
  await page.locator('.document-menu > summary').click();
  await page.getByLabel('Ширина выбранного экрана').fill('-1');
  await page.getByRole('button', { name: 'Изменить размер' }).click();
  await expect(page.locator('#screen-size-error')).toContainText('неотрицательные');
  await page.route('**/commands/save', route => route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }), { times: 1 });
  await show(page, 'document'); await page.getByRole('button', { name: 'Создать версию' }).click();
  await expect(page.locator('#version-error')).toContainText('Нет доступа');
  await page.route('**/commands/restore', route => route.fulfill({ status: 409, json: { code: 'REVISION_CONFLICT' } }), { times: 1 });
  page.once('dialog', dialog => dialog.accept()); await restore.click();
  await expect(page.locator('#restore-error')).toContainText('конфликтует');
  await expect(page.locator('#screen-size-error')).toContainText('неотрицательные');
});
test('edits dimensions and receives a second client resize', async ({ page, context, request }) => {
  const { id } = await setup(request), second = await context.newPage();
  await open(page, id); await open(second, id); await select(page); await select(second);
  await page.getByLabel('Ширина выбранного экрана').fill('800');
  await page.getByLabel('Высота выбранного экрана').fill('600');
  await page.getByRole('button', { name: 'Изменить размер' }).click();
  await expect(page.locator('#screen-size-saved')).toContainText('800 × 600');
  await expect(second.locator('#screen-size-saved')).toContainText('800 × 600');
  await second.getByLabel('Ширина выбранного экрана').fill('900');
  await second.getByRole('button', { name: 'Изменить размер' }).click();
  await expect(page.locator('#screen-size-saved')).toContainText('900 × 600');
});
test('validates and retries the same uncertain command', async ({ page, request }) => {
  const { id } = await setup(request); await open(page, id); await select(page);
  await page.getByLabel('Ширина выбранного экрана').fill('-1');
  await page.getByRole('button', { name: 'Изменить размер' }).click();
  await expect(page.locator('#screen-size-error')).toContainText('неотрицательные');
  const bodies = [];
  await page.route('**/commands/resize-screen', async route => {
    bodies.push(route.request().postData());
    if (bodies.length === 1) { await route.abort(); return; }
    await route.continue();
  });
  await page.getByLabel('Ширина выбранного экрана').fill('700');
  await page.getByRole('button', { name: 'Изменить размер' }).click();
  await expect(page.locator('#screen-size-saved')).toContainText('640 × 480');
  await page.getByRole('button', { name: 'Повторить команду' }).click();
  await expect(page.locator('#screen-size-saved')).toContainText('700 × 480');
  expect(bodies[0]).toBe(bodies[1]);
});
test('refusal leaves confirmed dimensions unchanged and Viewer sees read-only values', async ({ page, context, request }) => {
  const { id } = await setup(request); await open(page, id); await select(page);
  await page.route('**/commands/resize-screen', route => route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }));
  await page.getByLabel('Ширина выбранного экрана').fill('999');
  await page.getByRole('button', { name: 'Изменить размер' }).click();
  await expect(page.locator('#screen-size-error')).toContainText('Нет доступа');
  await expect(page.locator('#screen-size-saved')).toContainText('640 × 480');
  const viewer = await context.newPage();
  await viewer.route('**/api/v1/documents?*', async route => { const response = await route.fetch(), body = await response.json(); for (const item of body.items) item.role = 'Viewer'; await route.fulfill({ response, json: body }); });
  await open(viewer, id); await select(viewer);
  await expect(viewer.locator('#screen-resize')).toBeHidden();
});
test('keeps a refusal visible when an overlapping state refresh redraws the screen', async ({ page, request }) => {
  const { id } = await setup(request); await open(page, id); await select(page);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const held = new Promise(resolve => { entered = resolve; });
  await page.route('**/pages/*/screens?*', async route => {
    const response = await route.fetch(); entered(); await gate; await route.fulfill({ response });
  });
  try {
    const added = await request.post(`/api/v1/documents/${id}/commands/add-page`, {
      headers: { Authorization: `Bearer ${bearer}` },
      data: { commandId: randomUUID(), pageId: randomUUID() }
    });
    expect(added.ok()).toBeTruthy();
    await held;
    await page.route('**/commands/resize-screen', route => route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }));
    await page.getByLabel('Ширина выбранного экрана').fill('999');
    await page.getByRole('button', { name: 'Изменить размер' }).click();
    await expect(page.locator('#screen-size-error')).toContainText('Нет доступа');
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(page.locator('#pages > li > .page-select')).toHaveCount(2);
    await expect(page.locator('#screen-size-error')).toContainText('Нет доступа');
    await expect(page.locator('#screen-size-saved')).toContainText('640 × 480');
    await page.getByLabel('Ширина выбранного экрана').fill('700');
    await expect(page.locator('#screen-size-error')).toBeEmpty();
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
test('retains a local draft while a remote resize updates the confirmed size', async ({ page, context, request }) => {
  const { id } = await setup(request), second = await context.newPage();
  await open(page, id); await open(second, id); await select(page); await select(second);
  await page.getByLabel('Ширина выбранного экрана').fill('750');
  await second.getByLabel('Высота выбранного экрана').fill('500');
  await second.getByRole('button', { name: 'Изменить размер' }).click();
  await expect(page.locator('#screen-size-saved')).toContainText('640 × 500');
  await expect(page.getByLabel('Ширина выбранного экрана')).toHaveValue('750');
});
test('ignores a delayed resize response after logout', async ({ page, request }) => {
  const { id } = await setup(request); await open(page, id); await select(page);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const held = new Promise(resolve => { entered = resolve; });
  await page.route('**/commands/resize-screen', async route => { const response = await route.fetch(); entered(); await gate; await route.fulfill({ response }).catch(() => {}); });
  await page.getByLabel('Ширина выбранного экрана').fill('710');
  await page.getByRole('button', { name: 'Изменить размер' }).click(); await held;
  await page.locator('#editor-signout').click();
  release(); await page.unroute('**/commands/resize-screen');
  await expect(page.locator('#editor-view')).toBeHidden();
  await expect(page.locator('#authentication')).toBeVisible();
  await open(page, id); await page.locator('#screens button').first().click();
  await expect(page.locator('#screen-size-saved')).toContainText('710 × 480');
  await expect(page.locator('#resize-retry')).toBeHidden();
});
test('delayed resize response does not replace the newly selected screen', async ({ page, request }) => {
  const { id, pageId } = await setup(request), otherScreen = randomUUID();
  const response = await request.post(`/api/v1/documents/${id}/commands/add-screen`, {
    headers: { Authorization: `Bearer ${bearer}` },
    data: { commandId: randomUUID(), pageId, screenId: otherScreen, dimensions: { width: 320, height: 240 } }
  });
  expect(response.ok()).toBeTruthy();
  await open(page, id); await select(page);
  let release, entered, finished;
  const gate = new Promise(resolve => { release = resolve; });
  const held = new Promise(resolve => { entered = resolve; });
  const completed = new Promise(resolve => { finished = resolve; });
  await page.route('**/commands/resize-screen', async route => {
    const result = await route.fetch(); entered(); await gate;
    await route.fulfill({ response: result }).catch(() => {}); finished();
  });
  await page.getByLabel('Ширина выбранного экрана').fill('710');
  await page.getByRole('button', { name: 'Изменить размер' }).click(); await held;
  await page.locator('#screens button[data-screen-id="' + otherScreen + '"]').click();
  await expect(page.locator('#screen-size-saved')).toContainText('320 × 240');
  const delivered = page.waitForResponse(response => response.url().endsWith('/commands/resize-screen'));
  release(); await completed; await (await delivered).finished();
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  await expect(page.locator('#screens button[data-screen-id="' + otherScreen + '"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#screen-size-saved')).toContainText('320 × 240');
  await expect(page.getByLabel('Ширина выбранного экрана')).toHaveValue('320');
  await expect(page.locator('#resize-retry')).toBeHidden();
});
test('delayed resize response does not alter another document', async ({ page, request }) => {
  const first = await setup(request), second = await setup(request);
  await open(page, first.id); await select(page);
  let release, entered, finished;
  const gate = new Promise(resolve => { release = resolve; });
  const held = new Promise(resolve => { entered = resolve; });
  const completed = new Promise(resolve => { finished = resolve; });
  await page.route('**/commands/resize-screen', async route => {
    const result = await route.fetch(); entered(); await gate;
    await route.fulfill({ response: result }).catch(() => {}); finished();
  });
  await page.getByLabel('Ширина выбранного экрана').fill('710');
  await page.getByRole('button', { name: 'Изменить размер' }).click(); await held;
  await page.getByRole('link', { name: '← Документы' }).click();
  await page.locator(`#document-list a[href="/documents/${second.id}"]`).click();
  await expect(page.locator('#editor-view')).toBeVisible(); await select(page);
  const delivered = page.waitForResponse(response => response.url().endsWith('/commands/resize-screen'));
  release(); await completed; await (await delivered).finished();
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  await expect(page).toHaveURL(new RegExp(second.id));
  await expect(page.locator('#screen-size-saved')).toContainText('640 × 480');
  await expect(page.getByLabel('Ширина выбранного экрана')).toHaveValue('640');
  await expect(page.locator('#resize-retry')).toBeHidden();
});
