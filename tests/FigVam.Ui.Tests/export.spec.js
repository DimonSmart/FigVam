const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');

async function open(page, request) {
  const id = require('node:crypto').randomUUID();
  expect((await request.post('/api/v1/documents', { headers: { Authorization: `Bearer ${bearer}` }, data: { documentId: id, name: 'Export test' } })).status()).toBe(201);
  await page.goto(`/documents/${id}`);
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await show(page, 'document'); await expect(page.locator('#export-json')).toBeEnabled();
  return id;
}

test('downloads both formats at the displayed revision with authorization', async ({ page, request }) => {
  await open(page, request);
  const revision = (await page.locator('#revision').textContent()).match(/\d+$/)[0];
  for (const [button, endpoint, filename] of [['export-json', 'document.json', 'document.json'], ['export-container', 'container.figvam', 'document.figvam']]) {
    const requestPromise = page.waitForRequest(r => r.url().includes(`/${endpoint}?`));
    const downloadPromise = page.waitForEvent('download');
    await page.locator(`#${button}`).click();
    const sent = await requestPromise, download = await downloadPromise;
    expect(new URL(sent.url()).searchParams.get('revision')).toBe(revision);
    expect(sent.headers().authorization).toBe(`Bearer ${bearer}`);
    expect(download.suggestedFilename()).toBe(filename);
    await expect(page.locator('#export-status')).toContainText(`ревизия ${revision}`);
  }
});

test('shows errors and viewer policy', async ({ page, request }) => {
  await open(page, request);
  for (const [status, code, text] of [[403, 'FORBIDDEN', 'Нет прав'], [404, 'REVISION_UNAVAILABLE', 'ревизия больше недоступна'], [400, 'EXPORT_DEPENDENCY_UNAVAILABLE', 'ассет'], [413, 'EXPORT_TOO_LARGE', 'размер']]) {
    await page.route('**/document.json?*', route => route.fulfill({ status, json: { code } }), { times: 1 });
    await show(page, 'document'); await page.locator('#export-json').click();
    await expect(page.locator('#export-error')).toContainText(text);
  }
  await page.route('**/document.json?*', route => route.abort(), { times: 1 });
  await show(page, 'document'); await page.locator('#export-json').click();
  await expect(page.locator('#export-error')).toContainText('связаться');
  await page.route('**/api/v1/documents?*', async route => {
    const response = await route.fetch(), body = await response.json();
    body.items.forEach(item => item.role = 'Viewer');
    await route.fulfill({ response, json: body });
  });
  await page.getByRole('link', { name: '← Документы' }).click();
  await page.getByRole('link', { name: 'Export test' }).click();
  await show(page, 'document'); await expect(page.locator('#export-access')).toContainText('недоступно');
  await expect(page.locator('#export-json')).toBeDisabled();
  await expect(page.locator('#export-container')).toBeDisabled();
});

for (const action of ['navigate', 'logout']) test(`ignores pending export after ${action} and prevents duplicates`, async ({ page, request }) => {
  await open(page, request);
  let release, started;
  const gate = new Promise(resolve => release = resolve), arrival = new Promise(resolve => started = resolve);
  let calls = 0, downloads = 0;
  page.on('download', () => downloads++);
  await page.route('**/document.json?*', async route => { calls++; started(); await gate; await route.fulfill({ body: '{}' }).catch(() => {}); });
  await show(page, 'document'); await page.locator('#export-json').click(); await arrival;
  await expect(page.locator('#export-json')).toBeDisabled();
  await expect(page.locator('#export-container')).toBeDisabled();
  if (action === 'navigate') await page.getByRole('link', { name: '← Документы' }).click();
  else await page.getByRole('button', { name: 'Забыть токен' }).click();
  release();
  await page.waitForTimeout(300);
  expect(calls).toBe(1); expect(downloads).toBe(0);
});

test('expired export token clears the session', async ({ page, request }) => {
  await open(page, request);
  await page.route('**/document.json?*', route => route.fulfill({ status: 401 }), { times: 1 });
  await show(page, 'document'); await page.locator('#export-json').click();
  await expect(page.locator('#authentication')).toBeVisible();
  await expect(page.locator('#error')).toContainText('Сессия завершена. Войдите повторно.');
});
