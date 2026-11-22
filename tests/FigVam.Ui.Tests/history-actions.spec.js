const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');
const { randomUUID } = require('node:crypto');
async function setup(request, name = 'История') {
  const id = randomUUID(), pageId = randomUUID(), headers = { Authorization: `Bearer ${bearer}` };
  expect((await request.post('/api/v1/documents', { headers, data: { documentId: id, name } })).ok()).toBeTruthy();
  expect((await request.post(`/api/v1/documents/${id}/commands/add-page`, { headers, data: { commandId: randomUUID(), pageId } })).ok()).toBeTruthy();
  return id;
}
async function open(page, id) {
  await page.goto(`/documents/${id}`);
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#editor-view')).toBeVisible();
}
test('undo and redo update the authoritative document', async ({ page, request }) => {
  const id = await setup(request); await open(page, id);
  await expect(page.locator('#pages > li > .page-select')).toHaveCount(1);
  await page.getByRole('button', { name: 'Отменить действие' }).click();
  await expect(page.locator('#pages > li > .page-select')).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить действие', exact: true }).click();
  await expect(page.locator('#pages > li > .page-select')).toHaveCount(1);
});
test('explains both incompatible refusal codes without changing the document', async ({ page, request }) => {
  const id = await setup(request); await open(page, id);
  for (const [action, code, button, text] of [['undo', 'UNDO_NOT_APPLICABLE', 'Отменить действие', 'Отмена неприменима'], ['redo', 'REDO_NOT_APPLICABLE', 'Повторить действие', 'Повтор неприменим']]) {
    await page.route(`**/commands/${action}`, route => route.fulfill({ status: 409, json: { code } }), { times: 1 });
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect(page.locator('#history-action-error')).toContainText(text);
    await expect(page.locator('#pages > li > .page-select')).toHaveCount(1);
  }
});
test('Viewer sees read-only actions', async ({ page, request }) => {
  const id = await setup(request);
  await page.route('**/api/v1/documents?*', async route => { const response = await route.fetch(), body = await response.json(); for (const item of body.items) item.role = 'Viewer'; await route.fulfill({ response, json: body }); });
  await open(page, id);
  await expect(page.locator('#undo')).toBeDisabled(); await expect(page.locator('#redo')).toBeDisabled();
  await expect(page.locator('#history-access')).toContainText('Только просмотр');
});
test('retries a lost acknowledgement with the same command ID', async ({ page, request }) => {
  const id = await setup(request); await open(page, id); const bodies = [];
  await page.route('**/commands/undo', async route => {
    bodies.push(route.request().postData());
    if (bodies.length === 1) { await route.fetch(); await route.abort(); } else await route.continue();
  });
  await page.locator('#undo').click();
  await expect(page.locator('#history-action-retry')).toBeVisible();
  await page.locator('#history-action-retry').click();
  await expect(page.locator('#history-action-retry')).toBeHidden();
  await expect(page.locator('#pages > li > .page-select')).toHaveCount(0);
  expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]);
});
test('shortcuts avoid text fields and work on the editor', async ({ page, request }) => {
  const id = await setup(request); await open(page, id); let calls = 0;
  await page.route('**/commands/undo', async route => { calls++; await route.continue(); });
  await show(page, 'document'); await page.locator('#version-name').focus(); await page.keyboard.press('Control+z'); expect(calls).toBe(0);
  await page.locator('#content').focus(); await page.keyboard.press('Control+z'); await expect(page.locator('#pages > li > .page-select')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('#pages > li > .page-select')).toHaveCount(1);
});
test('delayed response cannot overwrite another document', async ({ page, request }) => {
  const id = await setup(request), other = await setup(request, 'Второй'); await open(page, id);
  let release, entered; const gate = new Promise(r => release = r), held = new Promise(r => entered = r);
  await page.route('**/commands/undo', async route => { const response = await route.fetch(); entered(); await gate; await route.fulfill({ response }).catch(() => {}); });
  await page.locator('#undo').click(); await held;
  await page.getByRole('link', { name: '← Документы' }).click();
  await page.getByRole('link', { name: 'Второй' }).click(); await expect(page.locator('#document-title')).toHaveText('Второй');
  release(); await expect(page.locator('#pages > li > .page-select')).toHaveCount(1); await expect(page.locator('#history-action-error')).toBeEmpty();
});
test('leaving a document cancels its outstanding version history read', async ({ page, request }) => {
  const id = await setup(request), other = await setup(request, 'Другой документ');
  const oldHistory = `**/documents/${id}/versions?*`;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(oldHistory, async route => {
    await gate;
    await route.fulfill({ status: 401 }).catch(() => {});
  });
  const started = page.waitForRequest(oldHistory);
  try {
    await open(page, id);
    await started;
    const cancelled = page.waitForEvent('requestfailed', event => event.url().includes(`/documents/${id}/versions?`));
    await page.getByRole('link', { name: '← Документы' }).click();
    await cancelled;
    await page.getByRole('link', { name: 'Другой документ', exact: true }).click();
    await expect(page).toHaveURL(`/documents/${other}`);
    await expect(page.locator('#versions-status')).toHaveText('Сохранённых версий нет.');
  } finally {
    release();
  }
});
test('delayed response after logout cannot restore operation state', async ({ page, request }) => {
  const id = await setup(request); await open(page, id);
  let release, entered; const gate = new Promise(r => release = r), held = new Promise(r => entered = r);
  await page.route('**/commands/undo', async route => { const response = await route.fetch(); entered(); await gate; await route.fulfill({ response }).catch(() => {}); });
  await page.locator('#undo').click(); await held;
  await page.getByRole('button', { name: 'Забыть токен' }).click(); release();
  await expect(page.locator('#authentication')).toBeVisible();
  await open(page, id); await expect(page.locator('#pages > li > .page-select')).toHaveCount(0);
  await expect(page.locator('#history-action-retry')).toBeHidden();
});
