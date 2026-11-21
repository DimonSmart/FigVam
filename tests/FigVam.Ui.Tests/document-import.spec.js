const { test, expect, bearer } = require('./fixtures');

async function login(page) {
  await page.goto('/');
  await page.getByLabel('Bearer-токен').fill(bearer);
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByRole('heading', { name: 'Документы' })).toBeVisible();
}
async function selectFile(page, name = 'document.json', buffer = Buffer.from('{}')) {
  await page.getByLabel('Файл документа (document.json или .figvam)').setInputFiles({ name, mimeType: 'application/octet-stream', buffer });
}
const submit = page => page.getByRole('button', { name: 'Открыть файл как новый документ' }).click();

for (const [format, name, mime] of [['document.json', 'document.json', 'application/json'], ['container.figvam', 'example.figvam', 'application/zip']]) {
  test(`imports raw ${format} and opens the document`, async ({ page, request, baseURL }) => {
    await login(page);
    await page.getByLabel('Имя нового документа').fill('Import target');
    await page.getByRole('button', { name: 'Создать документ' }).click();
    await expect(page.getByRole('heading', { name: 'Import target' })).toBeVisible();
    const id = page.url().split('/').pop();
    const exported = await request.get(`${baseURL}/api/v1/documents/${id}/${format}?revision=0`, { headers: { Authorization: `Bearer ${bearer}` } });
    expect(exported.ok()).toBeTruthy();
    const bytes = await exported.body();
    await page.getByRole('link', { name: '← Документы' }).click();
    await expect(page.getByRole('heading', { name: 'Документы' })).toBeVisible();
    await page.evaluate(() => { const original = window.fetch; window.fetch = async (url, options) => { if (String(url).includes('/documents/import/')) window.importBytes = Array.from(new Uint8Array(await options.body.arrayBuffer())); return original(url, options); }; });
    await page.route('**/api/v1/documents/import/**', route => route.fulfill({ status: 201, json: { code: 'ACCEPTED', documentId: id, revision: 0 } }), { times: 1 });
    await selectFile(page, name, bytes);
    const sentPromise = page.waitForRequest(`**/api/v1/documents/import/${format}`);
    await submit(page);
    const sent = await sentPromise;
    expect(sent.headers()['content-type']).toBe(mime);
    expect(sent.headers()['authorization']).toBe(`Bearer ${bearer}`);
    expect(Buffer.from(await page.evaluate(() => window.importBytes)).equals(bytes)).toBeTruthy();
    await expect(page.getByRole('heading', { name: 'Import target' })).toBeVisible();
    expect(page.url()).toContain(id);
  });
}

test('shows validation diagnostics, conflict, size and permission errors', async ({ page }) => {
  await login(page); await selectFile(page);
  for (const [status, body, expected] of [
    [400, { code: 'INVALID_DOCUMENT_FILE', diagnostics: [{ code: 'BAD_SCHEMA', path: '$.pages', message: 'Invalid' }] }, 'BAD_SCHEMA'],
    [409, { code: 'DOCUMENT_EXISTS' }, 'уже существует'],
    [413, { code: 'FILE_TOO_LARGE' }, 'размер'],
    [403, { code: 'FORBIDDEN' }, 'Нет прав']
  ]) {
    await page.route('**/api/v1/documents/import/**', route => route.fulfill({ status, json: body }), { times: 1 });
    await submit(page);
    await expect(page.locator(status === 400 ? '#import-diagnostics' : '#import-error')).toContainText(expected);
    if (status === 400) await expect(page.locator('#import-diagnostics')).toContainText('$.pages');
  }
});

test('expired authentication clears the session', async ({ page }) => {
  await login(page); await selectFile(page);
  await page.route('**/api/v1/documents/import/**', route => route.fulfill({ status: 401 }), { times: 1 });
  await submit(page);
  await expect(page.getByRole('heading', { name: 'Открыть рабочее пространство' })).toBeVisible();
  await expect(page.locator('#error')).toContainText('Сессия завершена. Войдите повторно.');
});

test('uncertain result warns before retry', async ({ page }) => {
  await login(page); await selectFile(page);
  await page.route('**/api/v1/documents/import/**', route => route.abort(), { times: 1 });
  await submit(page);
  await expect(page.locator('#import-error')).toContainText('документ мог быть создан');
  await expect(page.locator('#import-error')).toContainText('Проверьте список');
});

test('prevents double submit and ignores response after logout', async ({ page }) => {
  await login(page); await selectFile(page);
  let release, started; const gate = new Promise(resolve => release = resolve), arrival = new Promise(resolve => started = resolve);
  let count = 0;
  await page.route('**/api/v1/documents/import/**', async route => { count++; started(); await gate; await route.fulfill({ status: 409, json: { code: 'DOCUMENT_EXISTS' } }).catch(() => {}); });
  await submit(page); await arrival;
  await expect(page.getByRole('button', { name: 'Открыть файл как новый документ' })).toBeDisabled();
  await page.locator('#import-form').evaluate(form => form.requestSubmit());
  await page.getByRole('button', { name: 'Забыть токен' }).click();
  release();
  await expect(page.getByRole('heading', { name: 'Открыть рабочее пространство' })).toBeVisible();
  await expect(page.locator('#import-error')).toBeEmpty();
  expect(count).toBe(1);
});


test('ignores a pending response after leaving the list', async ({ page }) => {
  await login(page);
  await page.getByLabel('Имя нового документа').fill('Existing');
  await page.getByRole('button', { name: 'Создать документ' }).click();
  await expect(page.getByRole('heading', { name: 'Existing' })).toBeVisible();
  await page.getByRole('link', { name: '← Документы' }).click();
  await selectFile(page);
  let release, started; const gate = new Promise(resolve => release = resolve), arrival = new Promise(resolve => started = resolve);
  await page.route('**/api/v1/documents/import/**', async route => { started(); await gate; await route.fulfill({ status: 409, json: { code: 'DOCUMENT_EXISTS' } }).catch(() => {}); });
  await submit(page); await arrival;
  await page.getByRole('link', { name: 'Existing' }).click();
  release();
  await expect(page.getByRole('heading', { name: 'Existing' })).toBeVisible();
  await expect(page.locator('#import-error')).toBeEmpty();
});
