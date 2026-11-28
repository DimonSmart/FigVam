const { test, expect, bearer } = require('./fixtures');
const { fulfillLayerPage } = require('./layer-fixture');
const { randomUUID } = require('node:crypto');
const { show } = require('./ui-panels');

async function open(page, id) {
  await page.goto(`/documents/${id}`);
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#editor-view')).toBeVisible();
}
async function create(request, name) {
  const id = randomUUID();
  expect((await request.post('/api/v1/documents', { headers: { Authorization: `Bearer ${bearer}` }, data: { documentId: id, name } })).ok()).toBeTruthy();
  return id;
}
async function command(page, name, data) {
  return page.evaluate(async ({ name, data, bearer }) => {
    const response = await fetch(`/api/v1${location.pathname}/commands/${name}`, {
      method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: crypto.randomUUID(), ...data })
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, { name, data, bearer });
}
const connected = page => expect(page.locator('#connection-status')).toContainText('Подключено');

test('two clients converge through authenticated events while local commands retain the displayed cursor', async ({ page, context, request }) => {
  const id = await create(request, 'Shared');
  const second = await context.newPage();
  const subscriptions = [];
  second.on('request', request => { if (request.url().includes('/events?')) subscriptions.push(request); });
  await open(page, id); await open(second, id); await connected(second);
  await page.getByRole('button', { name: 'Создать страницу' }).click();
  await expect(second.locator('#pages > li > .page-select')).toHaveCount(1);
  await page.getByRole('button', { name: /Переименовать страницу/ }).click();
  await page.getByLabel('Имя страницы', { exact: true }).fill('Renamed remotely');
  await page.getByRole('button', { name: 'Сохранить название страницы' }).click();
  await expect(second.locator('#pages > li > .page-select')).toHaveText('Renamed remotely');
  await show(second, 'screen');
  await second.getByLabel('Ширина экрана').fill('640');
  await second.getByLabel('Высота экрана').fill('480');
  await second.getByRole('button', { name: 'Создать экран' }).click();
  await expect(page.locator('#screens button.screen-select')).toContainText('640 × 480');
  await expect(second.locator('#revision')).toHaveText(await page.locator('#revision').textContent());
  const screenId = await second.locator('#screens button.screen-select').getAttribute('data-screen-id');
  await page.locator('#screens button.screen-select').click();
  await connected(page);
  await command(second, 'resize-screen', { screenId, dimensions: { width: 800, height: 600 } });
  await expect(page.locator('#canvas-selection')).toHaveText('Экран: 800 × 600 uiUnit');
  await expect(page.locator('#screen-boundary')).toHaveCSS('width', '800px');
  expect(subscriptions.length).toBeGreaterThan(0);
  for (const subscription of subscriptions) {
    expect(subscription.headers().authorization).toBe(`Bearer ${bearer}`);
    expect([...new URL(subscription.url()).searchParams.keys()]).toEqual(['lastSeenRevision']);
    expect(subscription.url()).not.toContain(bearer);
  }
});

test('five open editors converge within the five-stream actor limit', async ({ page, context, request }) => {
  const id = await create(request, 'Five editors');
  const clients = [page];
  for (let index = 1; index < 5; index++) clients.push(await context.newPage());
  const captureConnections = [];
  for (const client of clients) {
    client.on('request', request => { if (request.url().endsWith('/screen-capture/providers')) captureConnections.push(request); });
    await open(client, id); await connected(client);
  }
  expect(captureConnections).toHaveLength(0);
  await command(page, 'add-page', { pageId: randomUUID() });
  for (const client of clients) {
    await expect(client.locator('#pages > li > .page-select')).toHaveCount(1);
    await expect(client.locator('#revision')).toContainText('ревизия 1');
  }
});

test('refreshes the expanded layer tree and selected object, then clears a remotely deleted page', async ({ page, context, request }) => {
  const id = await create(request, 'Layers'), pageId = randomUUID(), screenId = randomUUID();
  await open(page, id);
  await command(page, 'add-page', { pageId });
  await command(page, 'add-screen', { pageId, screenId, dimensions: { width: 640, height: 480 } });
  const other = await context.newPage(); await open(other, id);
  // Synthetic read-only layer fixture: production's unverified profile permits no node kinds.
  await page.route('**/children/**', async route => {
    const url = new URL(route.request().url()), parent = url.pathname.split('/').at(-1);
    const items = parent === screenId
      ? [{ id: 'root', name: 'Fixture group', kind: 'FixtureContainer', childCount: 1 }]
      : [{ id: 'child', name: Number(url.searchParams.get('revision')) >= 3 ? 'Updated fixture' : 'Original fixture', kind: 'FixtureLeaf', childCount: 0 }];
    await fulfillLayerPage(route, items);
  });
  await expect(page.locator('#screens button.screen-select')).toHaveCount(1);
  await expect(page.locator('#screens button.screen-select')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Обновить страницы' }).click();
  await page.locator('#layers [data-id=root] .layer-label').click();
  await page.locator('#layers [data-id=child] .layer-label').click();
  await expect(page.locator('#inspector-selection')).toContainText('Original fixture');
  await command(other, 'rename-page', { pageId, name: 'Remote rename' });
  await expect(page.locator('#layers [data-id=child]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#inspector-selection')).toContainText('Updated fixture');
  await expect(page.locator('#layers [data-id=root]')).toHaveAttribute('aria-expanded', 'true');
  await command(other, 'delete-page', { pageId, expectedRevision: 3 });
  await expect(page.locator('#pages > li > .page-select')).toHaveCount(0);
  await expect(page.locator('#layers [role=treeitem]')).toHaveCount(0);
  await expect(page.locator('#inspector-selection')).toHaveText('Выберите слой.');
  await expect(page.locator('#screen-boundary')).toBeHidden();
});

test('logout cancels a held remote refresh without showing its revision or objects', async ({ page, context, request }) => {
  const id = await create(request, 'Logout'), other = await context.newPage();
  await open(page, id); await open(other, id); await connected(page);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const held = new Promise(resolve => { entered = resolve; });
  await page.route('**/pages?*', async route => {
    if (new URL(route.request().url()).searchParams.get('revision') === '1') { entered(); await gate; }
    await route.continue().catch(() => {});
  });
  await command(other, 'add-page', { pageId: randomUUID() });
  await held;
  await page.locator('#editor-signout').click();
  release();
  await expect(page.locator('#authentication')).toBeVisible();
  await expect(page.locator('#revision')).toHaveText('');
  await expect(page.locator('#pages > li > .page-select')).toHaveCount(0);
  await expect(page.locator('#connection-status')).toHaveText('');
});

test('a local command supersedes a held remote refresh without regressing the cursor', async ({ page, context, request }) => {
  const id = await create(request, 'Concurrent commands'), other = await context.newPage();
  await open(page, id); await open(other, id); await connected(page);
  let release, entered, heldOnce = false;
  const gate = new Promise(resolve => { release = resolve; });
  const held = new Promise(resolve => { entered = resolve; });
  await page.route('**/pages?*', async route => {
    if (!heldOnce && new URL(route.request().url()).searchParams.get('revision') === '1') {
      heldOnce = true; entered(); await gate;
    }
    await route.continue().catch(() => {});
  });
  await command(other, 'add-page', { pageId: randomUUID() }); await held;
  await page.getByRole('button', { name: 'Создать страницу' }).click();
  await expect(page.locator('#pages > li > .page-select')).toHaveCount(2);
  await expect(page.locator('#revision')).toContainText('ревизия 2');
  release(); await connected(page);
  await expect(other.locator('#pages > li > .page-select')).toHaveCount(2);
  await expect(page.locator('#revision')).toContainText('ревизия 2');
  await expect(page.locator('#pages > li > .page-select')).toHaveCount(2);
});

test('logout during a local command leaves the next session editable', async ({ page, request }) => {
  const id = await create(request, 'New session'); await open(page, id);
  await page.getByRole('button', { name: 'Создать страницу' }).click();
  await expect(page.locator('#pages > li > .page-select')).toHaveCount(1);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const held = new Promise(resolve => { entered = resolve; });
  await page.route('**/commands/add-screen', async route => {
    const response = await route.fetch(); entered(); await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await show(page, 'screen');
  await page.getByLabel('Ширина экрана').fill('640');
  await page.getByLabel('Высота экрана').fill('480');
  await page.getByRole('button', { name: 'Создать экран' }).click(); await held;
  await page.locator('#editor-signout').click();
  release(); await page.unroute('**/commands/add-screen');
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await connected(page);
  await expect(page.locator('#screens button.screen-select')).toHaveCount(1);
  await show(page, 'screen');
  await show(page, 'screen');
  await page.getByLabel('Ширина экрана').fill('800');
  await page.getByLabel('Высота экрана').fill('600');
  await page.getByRole('button', { name: 'Создать экран' }).click();
  await expect(page.locator('#screens button.screen-select')).toHaveCount(2);
});

for (const mode of ['gap', 'RECONNECT_REQUIRED', 'EOF']) {
  test(`recovers after ${mode}, ignores duplicates and does not advance past an unrendered revision`, async ({ page, context, request }) => {
    const id = await create(request, mode), other = await context.newPage();
    await open(other, id);
    let streams = 0, release, staged;
    const gate = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { staged = resolve; });
    await page.route('**/events?*', async route => {
      streams++;
      if (streams > 1) return route.continue();
      await gate;
      const change = revision => `data: ${JSON.stringify({ code: 'CHANGE', revision, change: { documentId: id } })}\n\n`;
      const suffix = mode === 'gap' ? change(3) : mode === 'RECONNECT_REQUIRED' ? 'data: {"code":"RECONNECT_REQUIRED"}\n\n' : '';
      await route.fulfill({ contentType: 'text/event-stream', body: change(0) + suffix });
    });
    await open(page, id);
    await expect.poll(() => streams).toBe(1);
    await other.getByRole('button', { name: 'Создать страницу' }).click();
    await expect(other.locator('#pages > li > .page-select')).toHaveCount(1);
    let pinned = false;
    await page.route('**/pages?*', async route => {
      if (new URL(route.request().url()).searchParams.get('revision') === '1' && !pinned) {
        pinned = true; staged(); await gate2;
      }
      await route.continue();
    });
    let finish; const gate2 = new Promise(resolve => { finish = resolve; });
    release(); await ready;
    await expect(page.locator('#revision')).toContainText('ревизия 0');
    await expect(page.locator('#pages > li > .page-select')).toHaveCount(0);
    finish();
    await expect(page.locator('#pages > li > .page-select')).toHaveCount(1);
    await expect(page.locator('#revision')).toContainText('ревизия 1');
    await connected(page);
    expect(streams).toBeGreaterThan(1);
  });
}

test('a late recovery cannot overwrite another document, logout or an access refusal', async ({ page, context, request }) => {
  const first = await create(request, 'Old document'), next = await create(request, 'Next document');
  const other = await context.newPage(); await open(other, first);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const held = new Promise(resolve => { entered = resolve; });
  await page.route(`**/${first}/reconnect?*`, async route => { entered(); await gate; await route.fulfill({ json: { code: 'EVENTS', revision: 0, events: [] } }).catch(() => {}); });
  await open(page, first); await held;
  // Same-page navigation keeps pending JavaScript alive, exercising its cancellation guards.
  await page.getByRole('link', { name: '← Документы' }).click();
  await page.locator(`#document-list a[href='/documents/${next}']`).click();
  await expect(page.locator('#document-title')).toHaveText('Next document');
  release(); await connected(page);
  await other.getByRole('button', { name: 'Создать страницу' }).click();
  await expect(page.locator('#document-title')).toHaveText('Next document');
  await expect(page.locator('#pages > li > .page-select')).toHaveCount(0);
  await page.route(`**/${next}/events?*`, route => route.fulfill({ contentType: 'text/event-stream', body: 'data: {"code":"FORBIDDEN","revision":0}\n\n' }));
  await page.getByRole('button', { name: 'Обновить страницы' }).click();
  await expect(page.locator('#editor-view')).toBeHidden();
  await expect(page.locator('#error')).toContainText('Доступ к документу потерян');
  await expect(page.locator('#revision')).toHaveText('');
  await expect(page.locator('#document-title')).toHaveText('');
  await expect(page.locator('#layers [role=treeitem]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Забыть токен' }).click();
  await expect(page.locator('#authentication')).toBeVisible();
  await expect(page.locator('#revision')).toHaveText('');
});


test('two connected inspectors reconcile one structured shadow edit', async ({ page, context, request }) => {
  const id = await create(request, 'Shared drop shadow');
  const pageId = randomUUID(), screenId = randomUUID(), nodeId = randomUUID();
  const headers = { Authorization: 'Bearer ' + bearer };
  for (const [name, data] of [
    ['add-page', { pageId }], ['add-screen', { pageId, screenId, dimensions: { width: 640, height: 480 } }],
    ['add-node', { nodeId, parentId: screenId, kind: 'Frame' }]
  ]) expect((await request.post('/api/v1/documents/' + id + '/commands/' + name,
    { headers, data: { commandId: randomUUID(), ...data } })).ok()).toBeTruthy();
  const other = await context.newPage();
  for (const client of [page, other]) {
    await open(client, id);
    await client.locator('#screens button.screen-select').first().click();
    await client.locator('#layers [data-id="' + nodeId + '"]').press('Enter');
    await show(client, 'design');
    await connected(client);
    await expect(client.locator('.shadow-effects').getByRole('button', { name: 'Add drop shadow' })).toBeVisible();
  }
  const effects = page.locator('.shadow-effects');
  await effects.getByRole('button', { name: 'Add drop shadow' }).click();
  await effects.getByLabel('Drop shadow Blur', { exact: true }).fill('32');
  await expect(page.locator('#visual-inspector').getByRole('status')).toHaveText('Свойства сохранены.');
  const otherEffects = other.locator('.shadow-effects');
  await expect(otherEffects.getByLabel('Drop shadow Blur', { exact: true })).toHaveValue('32');
  await expect(other.locator('#revision')).toHaveText(await page.locator('#revision').textContent());
  const selector = '#screen-boundary [data-visual-node="' + nodeId + '"]';
  await expect(page.locator(selector)).not.toHaveCSS('box-shadow', 'none');
  const paint = await page.locator(selector).evaluate(el => getComputedStyle(el).boxShadow);
  expect(paint).not.toBe('none');
  await expect(other.locator(selector)).toHaveCSS('box-shadow', paint);
  const response = await request.get('/api/v1/documents/' + id + '/document.json', { headers });
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).document.nodes.find(node => node.id === nodeId).properties.shadow).toEqual({
    type: 'shadow', offsetX: 0, offsetY: 4, blurRadius: 32, spreadRadius: 0,
    color: { red: 0, green: 0, blue: 0, alpha: 38 }
  });
});
