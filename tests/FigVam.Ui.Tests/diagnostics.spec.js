const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');
const { randomUUID } = require('node:crypto');

async function setup(request) {
  const id = randomUUID(), pageId = randomUUID(), screens = [randomUUID(), randomUUID()];
  const headers = { Authorization: `Bearer ${bearer}` };
  expect((await request.post('/api/v1/documents', { headers, data: { documentId: id, name: 'Diagnostics' } })).ok()).toBeTruthy();
  for (const [name, data] of [['add-page', { pageId }], ...screens.map((screenId, i) => ['add-screen', { pageId, screenId, dimensions: { width: 600 + i, height: 400 } }])])
    expect((await request.post(`/api/v1/documents/${id}/commands/${name}`, { headers, data: { commandId: randomUUID(), ...data } })).ok()).toBeTruthy();
  return { id, screens, headers };
}
async function open(page, id) {
  await page.goto(`/documents/${id}`);
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#screens button')).toHaveCount(2);
  await show(page, 'diagnostics');
}
function response(route, items, total = items.length) {
  const url = new URL(route.request().url()), q = url.searchParams;
  return route.fulfill({ json: { documentId: url.pathname.split('/')[4], screenId: q.get('screenId'), revision: Number(q.get('revision')), offset: Number(q.get('offset')), limit: Number(q.get('limit')), items, total } });
}

test('reads selected screen and revision, paginates, retries and renders fields as text', async ({ page, request }) => {
  const { id, screens, headers } = await setup(request), calls = [];
  let fail = true;
  await page.route('**/diagnostics?*', route => {
    const url = new URL(route.request().url()); calls.push(url);
    expect(route.request().headers().authorization).toBe(`Bearer ${bearer}`);
    if (fail) { fail = false; return route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }); }
    const offset = Number(url.searchParams.get('offset'));
    return response(route, Array.from({ length: offset ? 1 : 20 }, (_, i) => ({ code: `CODE-${offset + i}`, path: '/nodes/<img>', message: 'Message', referenceId: 'ref', property: 'color' })), 21);
  });
  await open(page, id);
  await expect(page.locator('#diagnostics-status')).toHaveText('Выберите экран.');
  await page.locator('#screens button').first().click();
  await expect(page.locator('#diagnostics-error')).toContainText('Нет доступа');
  await page.getByRole('button', { name: 'Повторить загрузку диагностики' }).click();
  await expect(page.locator('#diagnostics-number')).toHaveText('1–20 из 21');
  await expect(page.locator('#diagnostics-list').locator('li').first()).toContainText('CODE-0 — /nodes/<img> — Message — ID ссылки: ref — Свойство: color');
  await expect(page.locator('#diagnostics-list img')).toHaveCount(0);
  expect(calls.at(-1).searchParams.get('screenId')).toBe(screens[0]);
  expect(calls.at(-1).searchParams.get('revision')).toBe('3');
  await page.getByRole('button', { name: 'Следующие диагностики' }).click();
  await expect(page.locator('#diagnostics-number')).toHaveText('21–21 из 21');
  await page.getByRole('button', { name: 'Предыдущие диагностики' }).click();
  await expect(page.locator('#diagnostics-number')).toHaveText('1–20 из 21');
  const changed = await request.post(`/api/v1/documents/${id}/commands/add-page`, { headers, data: { commandId: randomUUID(), pageId: randomUUID() } });
  expect(changed.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Обновить страницы' }).click();
  await expect.poll(() => calls.at(-1).searchParams.get('revision')).toBe('4');
  await page.locator('#screens button').nth(1).click();
  await expect.poll(() => calls.at(-1).searchParams.get('screenId')).toBe(screens[1]);
});

test('ignores delayed responses after screen change and logout', async ({ page, request }) => {
  const { id, screens } = await setup(request);
  let release, entered; const gate = new Promise(r => release = r), held = new Promise(r => entered = r);
  await page.route('**/diagnostics?*', async route => {
    const screen = new URL(route.request().url()).searchParams.get('screenId');
    if (screen === screens[0]) { entered(); await gate; return response(route, [{ code: 'STALE', path: '/', message: 'stale' }]).catch(() => {}); }
    return response(route, []);
  });
  await open(page, id);
  await page.locator('#screens button').first().click(); await held;
  await expect(page.locator('#diagnostics-status')).toContainText('Загрузка');
  await page.locator('#screens button').nth(1).click();
  await expect(page.locator('#diagnostics-status')).toHaveText('Диагностик для выбранного экрана нет.');
  release(); await expect(page.locator('#diagnostics-list')).not.toContainText('STALE');
  await page.getByRole('button', { name: 'Забыть токен' }).click();
  await expect(page.locator('#diagnostics-list')).toBeEmpty();
});

test('Viewer can read diagnostics without sending mutations', async ({ page, request }) => {
  const { id } = await setup(request); const methods = [];
  await page.route('**/api/v1/documents?*', async route => {
    const result = await route.fetch(), body = await result.json();
    for (const item of body.items) item.role = 'Viewer';
    await route.fulfill({ response: result, json: body });
  });
  await page.route('**/diagnostics?*', route => { methods.push(route.request().method()); return response(route, [{ code: 'VIEW', path: '/nodes/a', message: 'Readable' }]); });
  await open(page, id); await page.locator('#screens button').first().click();
  await expect(page.locator('#diagnostics-list')).toContainText('VIEW');
  expect(methods).toEqual(['GET']);
  await expect(page.locator('#screen-resize')).toBeHidden();
});

test('discards an outstanding response after logout', async ({ page, request }) => {
  const { id } = await setup(request);
  let release, entered; const gate = new Promise(r => release = r), held = new Promise(r => entered = r);
  await page.route('**/diagnostics?*', async route => {
    entered(); await gate;
    await response(route, [{ code: 'AFTER-LOGOUT', path: '/', message: 'stale' }]).catch(() => {});
  });
  await open(page, id); await page.locator('#screens button').first().click(); await held;
  await page.getByRole('button', { name: 'Забыть токен' }).click(); release();
  await expect(page.locator('#diagnostics-list')).toBeEmpty();
  await expect(page.locator('#diagnostics-status')).toHaveText('Выберите экран.');
});

test('discards an outstanding response after navigating to documents', async ({ page, request }) => {
  const { id } = await setup(request);
  let release, entered; const gate = new Promise(r => release = r), held = new Promise(r => entered = r);
  await page.route('**/diagnostics?*', async route => {
    entered(); await gate;
    await response(route, [{ code: 'AFTER-NAVIGATION', path: '/', message: 'stale' }]).catch(() => {});
  });
  await open(page, id); await page.locator('#screens button').first().click(); await held;
  await page.getByRole('link', { name: '← Документы' }).click(); release();
  await expect(page.locator('#diagnostics-list')).toBeEmpty();
  await expect(page.locator('#editor-view')).toBeHidden();
});

test('rejects a malformed response and retries successfully', async ({ page, request }) => {
  const { id } = await setup(request);
  let malformed = true;
  await page.route('**/diagnostics?*', route => {
    if (!malformed) return response(route, [{ code: 'RECOVERED', message: 'OK' }]);
    malformed = false;
    return route.fulfill({ json: { items: [], total: 0 } });
  });
  await open(page, id); await page.locator('#screens button').first().click();
  await expect(page.locator('#diagnostics-error')).toHaveText('Не удалось получить корректный ответ сервера.');
  await page.getByRole('button', { name: 'Повторить загрузку диагностики' }).click();
  await expect(page.locator('#diagnostics-list')).toContainText('RECOVERED');
  await expect(page.locator('#diagnostics-error')).toBeEmpty();
});

test('discards an outstanding response after revision changes', async ({ page, request }) => {
  const { id, headers } = await setup(request);
  let release, entered; const gate = new Promise(r => release = r), held = new Promise(r => entered = r);
  await page.route('**/diagnostics?*', async route => {
    if (new URL(route.request().url()).searchParams.get('revision') === '3') {
      entered(); await gate;
      return response(route, [{ code: 'STALE-REVISION', message: 'stale' }]).catch(() => {});
    }
    return response(route, [{ code: 'CURRENT-REVISION', message: 'current' }]);
  });
  await open(page, id); await page.locator('#screens button').first().click(); await held;
  const changed = await request.post(`/api/v1/documents/${id}/commands/add-page`, { headers, data: { commandId: randomUUID(), pageId: randomUUID() } });
  expect(changed.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Обновить страницы' }).click();
  await expect(page.locator('#diagnostics-list')).toContainText('CURRENT-REVISION');
  release();
  await expect(page.locator('#diagnostics-list')).not.toContainText('STALE-REVISION');
});
