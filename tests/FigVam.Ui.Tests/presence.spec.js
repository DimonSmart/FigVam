const { test, expect, bearer } = require('./fixtures');
const { randomUUID } = require('node:crypto');
async function create(request) { const id = randomUUID(); expect((await request.post('/api/v1/documents', { headers: { Authorization: `Bearer ${bearer}` }, data: { documentId: id, name: 'Presence' } })).ok()).toBeTruthy(); return id; }
async function open(page, id) { await page.goto(`/documents/${id}`); await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer); await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expect(page.locator('#editor-view')).toBeVisible(); }
test('publishes changes, recovers and removes expired participants', async ({ page, request }) => {
  const id = await create(request), pageId = randomUUID(), screenId = randomUUID();
  for (const [name, data] of [['add-page', { pageId }], ['add-screen', { pageId, screenId, dimensions: { width: 640, height: 480 } }]]) expect((await request.post(`/api/v1/documents/${id}/commands/${name}`, { headers: { Authorization: `Bearer ${bearer}` }, data: { commandId: randomUUID(), ...data } })).ok()).toBeTruthy();
  await page.addInitScript(() => { const original = window.setTimeout; window.setTimeout = (fn, delay, ...args) => original(fn, delay === 10000 ? 250 : delay, ...args); });
  let fail = true, updates = [], participants = [{ name: 'Другой', color: '#123456', screenId, cursor: { x: 10, y: 20 }, selectedIds: [randomUUID()] }];
  await page.route('**/presence', async route => {
    if (fail) { fail = false; await route.fulfill({ status: 503 }); return; }
    if (route.request().method() === 'PUT') { updates.push(route.request().postDataJSON()); await route.fulfill({ json: { code: 'UPDATED' } }); }
    else await route.fulfill({ json: { code: 'PRESENCE', participants } });
  });
  const nodeId = randomUUID();
  await page.route('**/children/**', route => route.fulfill({ json: { items: [{ id: nodeId, name: 'Layer', kind: 'FixtureLeaf', childCount: 0 }], total: 1 } }));
  await open(page, id);
  await expect(page.locator('#presence-list')).toContainText('Другой');
  await page.locator('#screens button').click();
  await expect(page.locator('.presence-marker')).toContainText('Другой');
  await page.locator('#layers .layer-label').click();
  await expect.poll(() => updates.some(u => u.screenId === screenId && u.selectedIds.includes(nodeId))).toBeTruthy();
  await page.locator('#viewport').hover();
  await expect.poll(() => updates.some(u => u.screenId === screenId && u.cursor)).toBeTruthy();
  participants = []; await expect(page.locator('#presence-list li')).toHaveCount(0);
  await expect(page.locator('#revision')).toContainText('ревизия 2');
});
test('ignores a late presence response after document switching', async ({ page, request }) => {
  const first = await create(request), second = await create(request); let release;
  await page.route('**/presence', async route => {
    const old = route.request().url().includes(first);
    if (old && route.request().method() === 'GET') await new Promise(resolve => { release = resolve; });
    try { await route.fulfill({ json: route.request().method() === 'PUT' ? { code: 'UPDATED' } : { code: 'PRESENCE', participants: [{ name: old ? 'Старый' : 'Новый', color: '#123456', screenId: null, cursor: null, selectedIds: [] }] } }); } catch {}
  });
  await open(page, first); await expect.poll(() => !!release).toBeTruthy();
  await page.goto(`/documents/${second}`); await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer); await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#presence-list')).toContainText('Новый'); release(); await expect(page.locator('#presence-list')).not.toContainText('Старый');
});

test('logout cancels pending presence and its timer before the next session', async ({ page, request }) => {
  const id = await create(request); let release, requests = 0;
  await page.addInitScript(() => { const original = window.setTimeout; window.setTimeout = (fn, delay, ...args) => original(fn, delay === 10000 ? 250 : delay, ...args); });
  await page.route('**/presence', async route => {
    requests++;
    if (route.request().method() === 'GET' && !release) {
      await new Promise(resolve => { release = resolve; });
      try { await route.fulfill({ json: { code: 'PRESENCE', participants: [{ name: 'Старый', color: '#123456', screenId: null, cursor: null, selectedIds: [] }] } }); } catch {}
      return;
    }
    await route.fulfill({ json: route.request().method() === 'PUT' ? { code: 'UPDATED' } : { code: 'PRESENCE', participants: [{ name: 'Новый', color: '#123456', screenId: null, cursor: null, selectedIds: [] }] } });
  });
  await open(page, id);
  await expect.poll(() => !!release).toBeTruthy();
  await page.getByRole('button', { name: 'Забыть токен' }).click();
  const requestsAtLogout = requests;
  await page.waitForTimeout(700);
  expect(requests).toBe(requestsAtLogout);
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#presence-list')).toContainText('Новый');
  release();
  await page.waitForTimeout(700);
  await expect(page.locator('#presence-list')).toContainText('Новый');
  await expect(page.locator('#presence-list')).not.toContainText('Старый');
});
