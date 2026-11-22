const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');
const { randomUUID } = require('node:crypto');
async function create(request) { const id = randomUUID(); expect((await request.post('/api/v1/documents', { headers: { Authorization: `Bearer ${bearer}` }, data: { documentId: id, name: 'Presence' } })).ok()).toBeTruthy(); return id; }
async function open(page, id) { await page.goto(`/documents/${id}`); await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer); await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expect(page.locator('#editor-view')).toBeVisible(); }
test('publishes changes, recovers and removes expired participants', async ({ page, request }) => {
  const id = await create(request), pageId = randomUUID(), screenId = randomUUID();
  for (const [name, data] of [['add-page', { pageId }], ['add-screen', { pageId, screenId, dimensions: { width: 640, height: 480 } }]]) expect((await request.post(`/api/v1/documents/${id}/commands/${name}`, { headers: { Authorization: `Bearer ${bearer}` }, data: { commandId: randomUUID(), ...data } })).ok()).toBeTruthy();
  await page.addInitScript(() => { const original = window.setTimeout; window.setTimeout = (fn, delay, ...args) => original(fn, delay === 10000 ? 250 : delay, ...args); });
  let fail = true, updates = [], participants = [{ name: 'Другой', color: '#123456', screenId, cursor: { x: 320, y: 240 }, selectedIds: [randomUUID()] }];
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
  const viewport = page.locator('#viewport');
  await page.getByRole('button', { name: '100%', exact: true }).click();
  const geometry = await page.locator('#screen-boundary').evaluate(el => {
    const matrix = new DOMMatrix(getComputedStyle(el).transform);
    return { x: matrix.e, y: matrix.f, scale: matrix.a };
  });
  const marker = page.locator('.presence-marker');
  await expect(marker).toHaveCSS('left', `${geometry.x + 320 * geometry.scale}px`);
  await expect(marker).toHaveCSS('top', `${geometry.y + 240 * geometry.scale}px`);
  const box = await viewport.boundingBox();
  await page.mouse.move(box.x + 50, box.y + 60);
  await expect.poll(() => updates.some(u => u.screenId === screenId && u.cursor &&
    Math.abs(u.cursor.x - (50 - geometry.x) / geometry.scale) < 1 &&
    Math.abs(u.cursor.y - (60 - geometry.y) / geometry.scale) < 1)).toBeTruthy();
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
  await page.locator('#editor-signout').click();
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

test('clears presence and stops polling after access is lost', async ({ page, request }) => {
  const id = await create(request); let reads = 0, requests = 0;
  await page.addInitScript(() => { const original = window.setTimeout; window.setTimeout = (fn, delay, ...args) => original(fn, delay === 10000 ? 250 : delay, ...args); });
  await page.route('**/presence', async route => {
    requests++;
    if (route.request().method() === 'PUT') return route.fulfill({ json: { code: 'UPDATED' } });
    if (++reads > 1) return route.fulfill({ status: 403 });
    return route.fulfill({ json: { code: 'PRESENCE', participants: [{ name: 'Другой', color: '#123456', screenId: null, cursor: null, selectedIds: [] }] } });
  });
  await open(page, id);
  await expect(page.locator('#presence-list')).toContainText('Другой');
  await expect(page.locator('#presence-status')).toContainText('доступ к документу потерян');
  await expect(page.locator('#presence-list li')).toHaveCount(0);
  const requestsAtLoss = requests;
  await page.waitForTimeout(700);
  expect(requests).toBe(requestsAtLoss);
});
