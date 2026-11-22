const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');
const { randomUUID } = require('node:crypto');
async function setup(request) {
  const id = randomUUID(), pageId = randomUUID(), screens = [randomUUID(), randomUUID()], headers = { Authorization: `Bearer ${bearer}` };
  expect((await request.post('/api/v1/documents', { headers, data: { documentId: id, name: 'Scenarios' } })).ok()).toBeTruthy();
  for (const [name, data] of [['add-page', { pageId }], ...screens.map(screenId => ['add-screen', { pageId, screenId, dimensions: { width: 600, height: 400 } }])])
    expect((await request.post(`/api/v1/documents/${id}/commands/${name}`, { headers, data: { commandId: randomUUID(), ...data } })).ok()).toBeTruthy();
  return { id, screens, headers };
}
async function open(page, id) {
  await page.goto(`/documents/${id}`); await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expect(page.locator('#screens button')).toHaveCount(2);
}
function response(route, items, total = items.length) {
  const url = new URL(route.request().url()), q = url.searchParams;
  return route.fulfill({ json: { documentId: url.pathname.split('/')[4], revision: Number(q.get('revision')), offset: Number(q.get('offset')), limit: Number(q.get('limit')), items, total } });
}
function scenario(screenId, id = randomUUID()) {
  return { id, screenId, nodeId: 'source', event: 0, actions: [
    { type: 'navigate', screenId: 'target' }, { type: 'showVariant', variantId: null },
    { type: 'setDemoValue', nodeId: 'input', value: '<img src=x onerror=alert(1)>' },
    { type: 'selectDataset', datasetId: 'data' }, { type: 'openOverlay', screenId: 'overlay' },
    { type: 'closeOverlay' }, { type: 'resetPreview' }
  ] };
}
test('reads authenticated catalog, retries, paginates, and refreshes on revision and screen', async ({ page, request }) => {
  const { id, screens, headers } = await setup(request), calls = []; let fail = true;
  await page.route('**/scenarios?*', route => {
    const url = new URL(route.request().url()), q = url.searchParams; calls.push(url);
    expect(route.request().headers().authorization).toBe(`Bearer ${bearer}`);
    expect(route.request().method()).toBe('GET');
    if (fail) { fail = false; return route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }); }
    if (q.get('screenId') === screens[1]) return response(route, []);
    const offset = Number(q.get('offset'));
    return response(route, Array.from({ length: offset ? 1 : 20 }, (_, i) => scenario(screens[0], `scenario-${offset + i}`)), 21);
  });
  await open(page, id); await page.locator('#screens button').first().click();
  await expect(page.locator('#scenarios-error')).toContainText('Нет доступа');
  await page.getByRole('button', { name: 'Повторить загрузку сценариев' }).click();
  await expect(page.locator('#scenarios-number')).toHaveText('1–20 из 21');
  const first = page.locator('#scenarios-list > li').first();
  await expect(first).toContainText('Исходный узел: source · Событие: Click');
  await expect(first.locator('ol > li')).toHaveText(['Navigate · Экран: target', 'ShowVariant · Вариант: не задано', 'SetDemoValue · Узел: input · Значение: <img src=x onerror=alert(1)>', 'SelectDataset · Датасет: data', 'OpenOverlay · Экран: overlay', 'CloseOverlay', 'ResetPreview']);
  await expect(page.locator('#scenarios-list img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Следующие сценарии' }).click(); await expect(page.locator('#scenarios-number')).toHaveText('21–21 из 21');
  await page.getByRole('button', { name: 'Предыдущие сценарии' }).click(); await expect(page.locator('#scenarios-number')).toHaveText('1–20 из 21');
  expect((await request.post(`/api/v1/documents/${id}/commands/add-page`, { headers, data: { commandId: randomUUID(), pageId: randomUUID() } })).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Обновить страницы' }).click(); await expect.poll(() => calls.at(-1).searchParams.get('revision')).toBe('4');
  await page.locator('#screens button').nth(1).click(); await expect(page.locator('#scenarios-status')).toHaveText('Сценариев для выбранного экрана нет.');
  expect(calls.at(-1).searchParams.get('screenId')).toBe(screens[1]);
});
test('Viewer can read the catalog', async ({ page, request }) => {
  const { id } = await setup(request);
  await page.route('**/api/v1/documents?*', async route => { const result = await route.fetch(), body = await result.json(); for (const item of body.items) item.role = 'Viewer'; await route.fulfill({ response: result, json: body }); });
  await page.route('**/scenarios?*', route => response(route, [scenario(new URL(route.request().url()).searchParams.get('screenId'))]));
  await open(page, id); await page.locator('#screens button').first().click(); await expect(page.locator('#scenarios-list')).toContainText('Исходный узел: source');
});
for (const exit of ['screen', 'logout', 'navigation', 'access']) test(`discards a pending response after ${exit}`, async ({ page, request }) => {
  const { id, screens } = await setup(request); let release, entered;
  const gate = new Promise(r => release = r), held = new Promise(r => entered = r);
  await page.route('**/scenarios?*', async route => {
    const screen = new URL(route.request().url()).searchParams.get('screenId');
    if (screen !== screens[0]) return response(route, []);
    entered(); await gate; await response(route, [scenario(screen, 'STALE')]).catch(() => {});
  });
  let denyAccess;
  if (exit === 'access') {
    const denial = new Promise(r => denyAccess = r);
    await page.route(`**/documents/${id}/reconnect?*`, async route => { await denial; await route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }).catch(() => {}); });
  }
  await open(page, id); await page.locator('#screens button').first().click(); await held;
  await expect(page.locator('#scenarios-status')).toContainText('Загрузка');
  if (exit === 'screen') { await page.locator('#screens button').nth(1).click(); await expect(page.locator('#scenarios-status')).toContainText('нет'); }
  if (exit === 'logout') await page.getByRole('button', { name: 'Забыть токен' }).click();
  if (exit === 'navigation') await page.getByRole('link', { name: '← Документы' }).click();
  if (exit === 'access') { denyAccess(); await expect(page.locator('#editor-view')).toBeHidden(); }
  release(); await expect(page.locator('#scenarios-list')).not.toContainText('STALE');
});
const deleteButton = page => page.getByRole('button', { name: /^Удалить сценарий / }).first();
async function mockCatalog(page, screens) {
  await page.route('**/scenarios?*', route => response(route, new URL(route.request().url()).searchParams.get('screenId') === screens[0] ? [scenario(screens[0], 'one')] : []));
}
test('confirms by scenario ID, cancellation sends nothing, then updates confirmed revision', async ({ page, request }) => {
  const { id, screens, headers } = await setup(request); let deleted = false, calls = 0;
  await page.route('**/scenarios?*', route => response(route, deleted ? [] : [scenario(screens[0], 'one')]));
  await page.route('**/commands/delete-scenario', async route => {
    calls++; const body = route.request().postDataJSON(); expect(body.expectedRevision).toBe(3); expect(body.scenarioId).toBe('one'); expect(body.commandId).toBeTruthy();
    const result = await request.post(`/api/v1/documents/${id}/commands/add-page`, { headers, data: { commandId: randomUUID(), pageId: randomUUID() } }); expect(result.ok()).toBeTruthy();
    deleted = true; await route.fulfill({ json: { code: 'ACCEPTED', documentId: id, commandId: body.commandId, revision: 4 } });
  });
  await open(page, id); await page.locator('#screens button').first().click();
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('one'); await dialog.dismiss(); }); await deleteButton(page).click(); expect(calls).toBe(0);
  page.once('dialog', dialog => dialog.accept()); await deleteButton(page).click();
  await expect(page.locator('#revision')).toContainText('ревизия 4'); await expect(page.locator('#scenarios-status')).toContainText('нет'); expect(calls).toBe(1);
});
test('Viewer has no delete control', async ({ page, request }) => {
  const { id, screens } = await setup(request); await mockCatalog(page, screens);
  await page.route('**/api/v1/documents?*', async route => { const r = await route.fetch(), body = await r.json(); body.items.forEach(item => item.role = 'Viewer'); await route.fulfill({ response: r, json: body }); });
  await open(page, id); await page.locator('#screens button').first().click(); await expect(page.locator('#scenarios-list')).toContainText('one'); await expect(deleteButton(page)).toHaveCount(0);
});
for (const [status, code, text] of [[409, 'REVISION_CONFLICT', 'Документ изменился'], [403, 'FORBIDDEN', 'Доступ']]) test(`reports ${code}`, async ({ page, request }) => {
  const { id, screens } = await setup(request); await mockCatalog(page, screens);
  await page.route('**/commands/delete-scenario', route => route.fulfill({ status, json: { code } }));
  await open(page, id); await page.locator('#screens button').first().click(); page.once('dialog', dialog => dialog.accept()); await deleteButton(page).click();
  await expect(page.locator('#scenario-command-error')).toContainText(text); await expect(deleteButton(page)).toBeEnabled();
});
test('uncertain result retries identical command body', async ({ page, request }) => {
  const { id, screens } = await setup(request); await mockCatalog(page, screens); const bodies = [];
  await page.route('**/commands/delete-scenario', async route => { bodies.push(route.request().postData()); await route.fulfill({ status: 503, json: {} }); });
  await open(page, id); await page.locator('#screens button').first().click(); page.once('dialog', dialog => dialog.accept()); await deleteButton(page).click();
  await expect(page.locator('#scenario-command-error')).toContainText('неизвестен'); await expect(deleteButton(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Повторить удаление сценария' }).click(); await expect.poll(() => bodies.length).toBe(2); expect(bodies[1]).toBe(bodies[0]);
});
for (const exit of ['screen', 'navigation', 'logout']) test(`ignores pending deletion after ${exit}`, async ({ page, request }) => {
  const { id, screens } = await setup(request); await mockCatalog(page, screens); let release, entered;
  const gate = new Promise(r => release = r), held = new Promise(r => entered = r);
  await page.route('**/commands/delete-scenario', async route => { const body = route.request().postDataJSON(); entered(); await gate; await route.fulfill({ json: { code: 'ACCEPTED', documentId: id, commandId: body.commandId, revision: 4 } }).catch(() => {}); });
  await open(page, id); await page.locator('#screens button').first().click(); page.once('dialog', dialog => dialog.accept()); await deleteButton(page).click(); await held;
  if (exit === 'screen') await page.locator('#screens button').nth(1).click();
  if (exit === 'navigation') await page.getByRole('link', { name: '← Документы' }).click();
  if (exit === 'logout') await page.getByRole('button', { name: 'Забыть токен' }).click();
  release(); await expect(page.locator('#scenario-command-status')).not.toContainText('подтверждено');
});
test('confirmed deletion returns from an empty last page', async ({ page, request }) => {
  const { id, screens, headers } = await setup(request); let deleted = false;
  await page.route('**/scenarios?*', route => { const offset = Number(new URL(route.request().url()).searchParams.get('offset')); return response(route, Array.from({ length: offset ? (deleted ? 0 : 1) : 20 }, (_, i) => scenario(screens[0], `scenario-${offset + i}`)), deleted ? 20 : 21); });
  await page.route('**/commands/delete-scenario', async route => { const body = route.request().postDataJSON(); await request.post(`/api/v1/documents/${id}/commands/add-page`, { headers, data: { commandId: randomUUID(), pageId: randomUUID() } }); deleted = true; await route.fulfill({ json: { code: 'ACCEPTED', documentId: id, commandId: body.commandId, revision: 4 } }); });
  await open(page, id); await page.locator('#screens button').first().click(); await page.getByRole('button', { name: 'Следующие сценарии' }).click(); await expect(page.locator('#scenarios-number')).toHaveText('21–21 из 21');
  page.once('dialog', dialog => dialog.accept()); await deleteButton(page).click(); await expect(page.locator('#scenarios-number')).toHaveText('1–20 из 20');
});

async function mockCapabilities(page, events = [0, 1, 2, 3], actions = ['navigate', 'openOverlay', 'closeOverlay', 'resetPreview']) {
  await page.route('**/scenario-capabilities?*', route => {
    const u = new URL(route.request().url()), q = u.searchParams;
    return route.fulfill({ json: { documentId: u.pathname.split('/')[4], revision: Number(q.get('revision')), nodeId: q.get('nodeId'), targetId: q.get('targetId'), screenId: q.get('screenId'), variantId: q.get('variantId'), datasetId: q.get('datasetId'), demoNodeId: q.get('demoNodeId'), demoValue: route.request().postDataJSON().demoValue, profile: { id: 'figvam.portable-ui', version: 1 }, events, actions: q.has('targetId') ? actions : actions.filter(a => !['navigate', 'openOverlay'].includes(a)) } });
  });
}
async function prepareCreation(page, id, screens) {
  await mockCapabilities(page);
  const node = randomUUID();
  await page.route('**/children/**', route => route.fulfill({ json: { items: [{ id: node, name: 'Source', kind: 'Frame', childCount: 0 }], total: 1 } }));
  await open(page, id); await page.locator('#screens button').first().click();
  await page.getByRole('treeitem', { name: /Source/ }).click();
  await expect(page.locator('#scenario-target option')).toHaveCount(2);
  await expect(page.locator('#scenario-action option[value=navigate]')).toHaveCount(1);
  await page.locator('#scenario-action').selectOption('navigate');
  await page.locator('#scenario-target').selectOption(screens[1]);
  await expect(page.locator('#scenario-event option')).toHaveCount(4);
  await page.locator('#scenario-event').selectOption('2');
  return node;
}
test('creates a Navigate scenario with generated IDs and refreshes the catalog', async ({ page, request }) => {
  const { id, screens, headers } = await setup(request); let body, calls = 0;
  await page.route('**/commands/create-scenario', async route => {
    calls++; body = route.request().postDataJSON();
    expect(route.request().headers().authorization).toBe(`Bearer ${bearer}`);
    await request.post(`/api/v1/documents/${id}/commands/add-page`, { headers, data: { commandId: randomUUID(), pageId: randomUUID() } });
    await route.fulfill({ json: { code: 'ACCEPTED', documentId: id, commandId: body.commandId, revision: 4 } });
  });
  const node = await prepareCreation(page, id, screens);
  await page.getByRole('button', { name: 'Создать сценарий' }).click();
  await expect(page.locator('#revision')).toContainText('ревизия 4');
  expect(calls).toBe(1); expect(body.commandId).toMatch(/^[0-9a-f-]{36}$/); expect(body.scenario.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(body.scenario).toEqual({ id: body.scenario.id, screenId: screens[0], nodeId: node, event: 2, actions: [{ type: 'navigate', screenId: screens[1] }] });
});
for (const action of ['openOverlay', 'closeOverlay', 'resetPreview']) test(`sends ${action} with its exact action payload`, async ({ page, request }) => {
  const { id, screens } = await setup(request); let body;
  await page.route('**/commands/create-scenario', async route => {
    body = route.request().postDataJSON();
    await route.fulfill({ status: 400, json: { code: 'INVALID' } });
  });
  const node = await prepareCreation(page, id, screens);
  await page.getByLabel('Действие').focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < ['openOverlay', 'closeOverlay', 'resetPreview'].indexOf(action) + 1; i++) await page.keyboard.press('ArrowDown');
  await expect(page.getByLabel('Действие')).toHaveValue(action);
  if (action === 'openOverlay') await expect(page.getByLabel('Целевой экран')).toBeVisible();
  else await expect(page.getByLabel('Целевой экран')).toBeHidden();
  await page.getByRole('button', { name: 'Создать сценарий' }).click();
  await expect(page.locator('#scenario-command-error')).toContainText('отклонено');
  expect(body.scenario).toEqual({ id: body.scenario.id, screenId: screens[0], nodeId: node, event: 2, actions: [action === 'openOverlay' ? { type: action, screenId: screens[1] } : { type: action }] });
});
test('targetless actions remain available without targets and retry the same command', async ({ page, request }) => {
  const { id, screens } = await setup(request); const bodies = [];
  await mockCapabilities(page);
  await page.route('**/children/**', route => route.fulfill({ json: { items: [{ id: randomUUID(), name: 'Source', kind: 'Frame', childCount: 0 }], total: 1 } }));
  await page.route('**/pages?*', route => new URL(route.request().url()).searchParams.get('limit') === '100' ? route.fulfill({ json: { items: [], total: 0 } }) : route.continue());
  await open(page, id); await page.locator('#screens button').first().click();
  await page.getByRole('treeitem', { name: /Source/ }).click();
  await expect(page.locator('#scenario-target-status')).toContainText('Нет доступных экранов');
  await expect(page.locator('#scenario-action option[value=openOverlay]')).toHaveCount(0);
  await page.route('**/commands/create-scenario', async route => { bodies.push(route.request().postData()); await route.fulfill({ status: 503, json: {} }); });
  await page.getByLabel('Действие').selectOption('closeOverlay');
  await page.getByRole('button', { name: 'Создать сценарий' }).click();
  await expect(page.locator('#scenario-command-error')).toContainText('неизвестен');
  expect(JSON.parse(bodies[0]).scenario.actions).toEqual([{ type: 'closeOverlay' }]);
  await page.getByRole('button', { name: 'Повторить создание сценария' }).click();
  await expect.poll(() => bodies.length).toBe(2); expect(bodies[1]).toBe(bodies[0]);
});
test('Viewer cannot create a scenario', async ({ page, request }) => {
  const { id } = await setup(request);
  await page.route('**/api/v1/documents?*', async route => { const r = await route.fetch(), body = await r.json(); body.items.forEach(item => item.role = 'Viewer'); await route.fulfill({ response: r, json: body }); });
  await open(page, id); await page.locator('#screens button').first().click(); await expect(page.locator('#scenario-create')).toBeHidden();
});
test('shows missing sources and targets and prevents submission', async ({ page, request }) => {
  const { id } = await setup(request);
  await page.route('**/pages?*', async route => {
    if (new URL(route.request().url()).searchParams.get('limit') === '100') return route.fulfill({ json: { items: [], total: 0 } });
    return route.continue();
  });
  await open(page, id); await page.locator('#screens button').first().click();
  await expect(page.locator('#scenario-source')).toContainText('нет слоёв');
  await expect(page.locator('#scenario-target-status')).toContainText('Нет доступных экранов');
  await expect(page.getByRole('button', { name: 'Создать сценарий' })).toBeDisabled();
});
for (const status of [400, 403, 503]) test(`creation handles ${status} and preserves uncertain body`, async ({ page, request }) => {
  const { id, screens } = await setup(request), bodies = [];
  await page.route('**/commands/create-scenario', async route => { bodies.push(route.request().postData()); await route.fulfill({ status, json: { code: status === 403 ? 'FORBIDDEN' : 'INVALID' } }); });
  await prepareCreation(page, id, screens); await page.getByRole('button', { name: 'Создать сценарий' }).click();
  await expect(page.locator('#scenario-command-error')).toContainText(status === 503 ? 'неизвестен' : status === 403 ? 'Доступ' : 'отклонено');
  if (status === 503) { await page.getByRole('button', { name: 'Повторить создание сценария' }).click(); await expect.poll(() => bodies.length).toBe(2); expect(bodies[1]).toBe(bodies[0]); }
});
for (const [exit, action] of [['screen', 'openOverlay'], ['navigation', 'closeOverlay'], ['logout', 'resetPreview']]) test(`ignores pending ${action} creation after ${exit}`, async ({ page, request }) => {
  const { id, screens } = await setup(request); let release, entered;
  const gate = new Promise(r => release = r), held = new Promise(r => entered = r);
  await page.route('**/commands/create-scenario', async route => { const body = route.request().postDataJSON(); entered(); await gate; await route.fulfill({ json: { code: 'ACCEPTED', documentId: id, commandId: body.commandId, revision: 4 } }).catch(() => {}); });
  await prepareCreation(page, id, screens); await page.getByLabel('Действие').selectOption(action); await page.getByRole('button', { name: 'Создать сценарий' }).click(); await held;
  await expect(page.getByRole('button', { name: 'Создать сценарий' })).toBeDisabled();
  if (exit === 'screen') await page.locator('#screens button').nth(1).click();
  if (exit === 'navigation') await page.getByRole('link', { name: '← Документы' }).click();
  if (exit === 'logout') await page.getByRole('button', { name: 'Забыть токен' }).click();
  release(); await expect(page.locator('#scenario-command-status')).not.toContainText('подтверждено');
});

test('real production profile leaves scenario creation unavailable', async ({ page, request }) => {
  const { id } = await setup(request); let commands = 0;
  await page.route('**/commands/create-scenario', route => { commands++; return route.abort(); });
  await open(page, id); await page.locator('#screens button').first().click();
  await expect(page.locator('#scenario-capabilities-status')).toContainText('недоступны');
  await expect(page.locator('#scenario-event option')).toHaveCount(0);
  await expect(page.locator('#scenario-action option')).toHaveCount(0);
  await expect(page.locator('#scenario-create-submit')).toBeDisabled();
  expect(commands).toBe(0);
});
for (const mode of ['stale', 'error', 'limited']) test(`capabilities ${mode} never permit unsupported submission`, async ({ page, request }) => {
  const { id } = await setup(request), node = randomUUID(); let commands = 0;
  await page.route('**/children/**', route => route.fulfill({ json: { items: [{ id: node, name: 'Source', kind: 'Frame', childCount: 0 }], total: 1 } }));
  await page.route('**/commands/create-scenario', route => { commands++; return route.abort(); });
  await page.route('**/scenario-capabilities?*', route => {
    if (mode === 'error') return route.fulfill({ status: 503, json: {} });
    const u = new URL(route.request().url()), q = u.searchParams;
    return route.fulfill({ json: { documentId: id, revision: Number(q.get('revision')) + (mode === 'stale' ? 1 : 0), nodeId: q.get('nodeId'), targetId: q.get('targetId'), screenId: q.get('screenId'), variantId: q.get('variantId'), datasetId: q.get('datasetId'), demoNodeId: q.get('demoNodeId'), demoValue: route.request().postDataJSON().demoValue, profile: { id: 'figvam.portable-ui', version: 1 }, events: mode === 'limited' ? [1] : [0], actions: mode === 'limited' ? ['resetPreview'] : ['navigate'] } });
  });
  await open(page, id); await page.locator('#screens button').first().click(); await page.getByRole('treeitem', { name: /Source/ }).click();
  if (mode !== 'limited') {
    await expect(page.locator('#scenario-capabilities-status')).toContainText('Не удалось');
    await expect(page.locator('#scenario-create-submit')).toBeDisabled();
  } else {
    await expect(page.locator('#scenario-event option')).toHaveText(['Change']);
    await expect(page.locator('#scenario-action option')).toHaveText(['ResetPreview']);
    await page.evaluate(() => { document.querySelector('#scenario-action').append(new Option('Unsupported', 'navigate')); document.querySelector('#scenario-action').value = 'navigate'; document.querySelector('#scenario-create').requestSubmit(); });
  }
  expect(commands).toBe(0);
});

test('ShowVariant checks exact value and discards stale capabilities', async ({ page, request }) => {
  const { id } = await setup(request), allowed = randomUUID(), denied = randomUUID(), node = randomUUID(), bodies = []; let release, entered;
  const gate = new Promise(r => release = r), held = new Promise(r => entered = r);
  await page.route('**/screens/*/variants?*', route => { const u = new URL(route.request().url()), q = u.searchParams; return route.fulfill({ json: { documentId: id, screenId: u.pathname.split('/')[6], revision: Number(q.get('revision')), total: 2, items: [{ id: allowed, name: 'Allowed' }, { id: denied, name: 'Denied' }] } }); });
  await page.route('**/children/**', route => route.fulfill({ json: { items: [{ id: node, name: 'Source', kind: 'Frame', childCount: 0 }], total: 1 } }));
  await page.route('**/scenario-capabilities?*', async route => { const q = new URL(route.request().url()).searchParams, value = q.get('variantId'); if (value === allowed) { entered(); await gate; } await route.fulfill({ json: { documentId: id, revision: Number(q.get('revision')), nodeId: q.get('nodeId'), targetId: q.get('targetId'), screenId: q.get('screenId'), variantId: value, datasetId: q.get('datasetId'), demoNodeId: q.get('demoNodeId'), demoValue: route.request().postDataJSON().demoValue, profile: { id: 'figvam.portable-ui', version: 1 }, events: [0], actions: value === denied ? [] : ['showVariant'] } }).catch(() => {}); });
  await page.route('**/commands/create-scenario', route => { bodies.push(route.request().postData()); return route.fulfill({ status: 503, json: {} }); });
  await open(page, id); await page.locator('#screens button').first().click(); await page.getByRole('treeitem', { name: /Source/ }).click();
  await expect(page.getByLabel('Вариант экрана').locator('option')).toHaveCount(3);
  await page.getByLabel('Вариант экрана').selectOption(allowed); await held;
  await page.getByLabel('Вариант экрана').selectOption(denied); await expect(page.locator('#scenario-action option')).toHaveCount(0);
  release(); await expect(page.locator('#scenario-create-submit')).toBeDisabled();
  await page.getByLabel('Вариант экрана').selectOption(''); await expect(page.getByLabel('Действие')).toHaveValue('showVariant');
  await page.getByRole('button', { name: 'Создать сценарий' }).click(); await expect(page.locator('#scenario-command-error')).toContainText('неизвестен');
  expect(JSON.parse(bodies[0]).scenario.actions).toEqual([{ type: 'showVariant', variantId: null }]);
  await page.getByRole('button', { name: 'Повторить создание сценария' }).click(); await expect.poll(() => bodies.length).toBe(2); expect(bodies[1]).toBe(bodies[0]);
});

test('ShowVariant sends the selected variant ID', async ({ page, request }) => {
  const { id } = await setup(request), variant = randomUUID(), node = randomUUID(); let body;
  await page.route('**/screens/*/variants?*', route => { const u = new URL(route.request().url()), q = u.searchParams; return route.fulfill({ json: { documentId: id, screenId: u.pathname.split('/')[6], revision: Number(q.get('revision')), total: 1, items: [{ id: variant, name: 'Alternate' }] } }); });
  await page.route('**/children/**', route => route.fulfill({ json: { items: [{ id: node, name: 'Source', kind: 'Frame', childCount: 0 }], total: 1 } }));
  await page.route('**/scenario-capabilities?*', route => { const q = new URL(route.request().url()).searchParams; return route.fulfill({ json: { documentId: id, revision: Number(q.get('revision')), nodeId: q.get('nodeId'), targetId: q.get('targetId'), screenId: q.get('screenId'), variantId: q.get('variantId'), datasetId: q.get('datasetId'), demoNodeId: q.get('demoNodeId'), demoValue: route.request().postDataJSON().demoValue, profile: { id: 'figvam.portable-ui', version: 1 }, events: [0], actions: ['showVariant'] } }); });
  await page.route('**/commands/create-scenario', route => { body = route.request().postDataJSON(); return route.fulfill({ status: 400, json: { code: 'INVALID' } }); });
  await open(page, id); await page.locator('#screens button').first().click(); await page.getByRole('treeitem', { name: /Source/ }).click();
  await expect(page.getByLabel('Вариант экрана').locator('option')).toHaveCount(2); await page.getByLabel('Вариант экрана').selectOption(variant);
  await expect(page.getByLabel('Действие')).toHaveValue('showVariant'); await page.getByRole('button', { name: 'Создать сценарий' }).click();
  await expect(page.locator('#scenario-command-error')).toContainText('отклонено'); expect(body.scenario.actions).toEqual([{ type: 'showVariant', variantId: variant }]);
});

test('Editor refreshes ShowVariant choices for screen and revision', async ({ page, request }) => {
  const { id, screens, headers } = await setup(request), node = randomUUID(), variants = [randomUUID(), randomUUID()], calls = [];
  await page.route('**/api/v1/documents?*', async route => { const r = await route.fetch(), body = await r.json(); body.items.forEach(item => item.role = 'Editor'); await route.fulfill({ response: r, json: body }); });
  await page.route('**/screens/*/variants?*', route => {
    const u = new URL(route.request().url()), screenId = u.pathname.split('/')[6], revision = Number(u.searchParams.get('revision'));
    calls.push({ screenId, revision });
    return route.fulfill({ json: { documentId: id, screenId, revision, total: 1, items: [{ id: variants[screens.indexOf(screenId)], name: `Variant ${revision}` }] } });
  });
  await page.route('**/children/**', route => route.fulfill({ json: { items: [{ id: node, name: 'Source', kind: 'Frame', childCount: 0 }], total: 1 } }));
  await page.route('**/scenario-capabilities?*', route => { const q = new URL(route.request().url()).searchParams; return route.fulfill({ json: { documentId: id, revision: Number(q.get('revision')), nodeId: q.get('nodeId'), targetId: q.get('targetId'), screenId: q.get('screenId'), variantId: q.get('variantId'), datasetId: q.get('datasetId'), demoNodeId: q.get('demoNodeId'), demoValue: route.request().postDataJSON().demoValue, profile: { id: 'figvam.portable-ui', version: 1 }, events: [0], actions: ['showVariant'] } }); });
  await open(page, id); await page.locator('#screens button').first().click(); await page.getByRole('treeitem', { name: /Source/ }).click();
  await page.getByLabel('Вариант экрана').selectOption(variants[0]); await expect(page.getByRole('button', { name: 'Создать сценарий' })).toBeEnabled();
  await page.locator('#screens button').nth(1).click(); await page.getByRole('treeitem', { name: /Source/ }).click();
  await expect(page.getByLabel('Вариант экрана').locator('option')).toHaveText(['Базовое состояние', 'Variant 3']);
  await page.getByLabel('Вариант экрана').selectOption(variants[1]);
  expect((await request.post(`/api/v1/documents/${id}/commands/add-page`, { headers, data: { commandId: randomUUID(), pageId: randomUUID() } })).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Обновить страницы' }).click();
  await expect(page.getByLabel('Вариант экрана').locator('option')).toHaveText(['Базовое состояние', 'Variant 4']);
  expect(calls).toEqual(expect.arrayContaining([{ screenId: screens[0], revision: 3 }, { screenId: screens[1], revision: 3 }, { screenId: screens[1], revision: 4 }]));
});


test('selects a dataset or no dataset and sends the exact typed action', async ({ page, request }) => {
  const { id, screens } = await setup(request), dataset = randomUUID(), bodies = [];
  await page.route('**/datasets?*', route => response(route, [{ id: dataset, name: 'Fixture' }]));
  await page.route('**/scenario-capabilities?*', route => { const u = new URL(route.request().url()), q = u.searchParams; return route.fulfill({ json: { documentId: id, revision: Number(q.get('revision')), nodeId: q.get('nodeId'), targetId: q.get('targetId'), screenId: q.get('screenId'), variantId: q.get('variantId'), datasetId: q.get('datasetId'), demoNodeId: q.get('demoNodeId'), demoValue: route.request().postDataJSON().demoValue, profile: { id: 'figvam.portable-ui', version: 1 }, events: [0], actions: ['selectDataset'] } }); });
  await page.route('**/children/**', route => route.fulfill({ json: { items: [{ id: randomUUID(), name: 'Source', kind: 'Frame', childCount: 0 }], total: 1 } }));
  await page.route('**/commands/create-scenario', route => { bodies.push(route.request().postDataJSON()); return route.fulfill({ status: 400, json: { code: 'INVALID' } }); });
  await open(page, id); await page.locator('#screens button').first().click(); await page.getByRole('treeitem', { name: /Source/ }).click();
  await expect(page.getByRole('combobox', { name: 'Датасет', exact: true })).toBeVisible();
  await expect(page.locator('#scenario-action')).toHaveValue('selectDataset');
  await page.getByRole('button', { name: 'Создать сценарий' }).click(); await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0].scenario.actions).toEqual([{ type: 'selectDataset', datasetId: null }]);
  await page.getByRole('combobox', { name: 'Датасет', exact: true }).selectOption(dataset);
  await expect(page.locator('#scenario-create-submit')).toBeEnabled();
  await page.getByRole('button', { name: 'Создать сценарий' }).click(); await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1].scenario.actions).toEqual([{ type: 'selectDataset', datasetId: dataset }]);
});

test('ignores stale dataset capability responses', async ({ page, request }) => {
  const { id } = await setup(request), allowed = randomUUID(), denied = randomUUID(); let release, entered;
  const gate = new Promise(r => release = r), held = new Promise(r => entered = r);
  await page.route('**/datasets?*', route => response(route, [{ id: allowed, name: 'Allowed' }, { id: denied, name: 'Denied' }]));
  await page.route('**/scenario-capabilities?*', async route => { const q = new URL(route.request().url()).searchParams, value = q.get('datasetId'); if (value === allowed) { entered(); await gate; } await route.fulfill({ json: { documentId: id, revision: Number(q.get('revision')), nodeId: q.get('nodeId'), targetId: q.get('targetId'), screenId: q.get('screenId'), variantId: q.get('variantId'), datasetId: value, demoNodeId: q.get('demoNodeId'), demoValue: route.request().postDataJSON().demoValue, profile: { id: 'figvam.portable-ui', version: 1 }, events: [0], actions: value === denied ? [] : ['selectDataset'] } }).catch(() => {}); });
  await page.route('**/children/**', route => route.fulfill({ json: { items: [{ id: randomUUID(), name: 'Source', kind: 'Frame', childCount: 0 }], total: 1 } }));
  await open(page, id); await page.locator('#screens button').first().click(); await page.getByRole('treeitem', { name: /Source/ }).click();
  await expect(page.getByRole('combobox', { name: 'Датасет', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Датасет', exact: true }).selectOption(allowed); await held;
  await page.getByRole('combobox', { name: 'Датасет', exact: true }).selectOption(denied); await expect(page.locator('#scenario-action option')).toHaveCount(0);
  release(); await expect(page.locator('#scenario-action option')).toHaveCount(0);
});


test('dataset load failure can be retried and an empty list permits null', async ({ page, request }) => {
  const { id } = await setup(request); let fail = true;
  await page.route('**/datasets?*', route => fail ? route.fulfill({ status: 500, json: {} }) : response(route, []));
  await page.route('**/scenario-capabilities?*', route => { const q = new URL(route.request().url()).searchParams; return route.fulfill({ json: { documentId: id, revision: Number(q.get('revision')), nodeId: q.get('nodeId'), targetId: q.get('targetId'), screenId: q.get('screenId'), variantId: q.get('variantId'), datasetId: q.get('datasetId'), demoNodeId: q.get('demoNodeId'), demoValue: route.request().postDataJSON().demoValue, profile: { id: 'figvam.portable-ui', version: 1 }, events: [0], actions: ['selectDataset', 'resetPreview'] } }); });
  await page.route('**/children/**', route => route.fulfill({ json: { items: [{ id: randomUUID(), name: 'Source', kind: 'Frame', childCount: 0 }], total: 1 } }));
  await open(page, id); await page.locator('#screens button').first().click(); await page.getByRole('treeitem', { name: /Source/ }).click();
  await expect(page.locator('#scenario-dataset-status')).toContainText('Не удалось');
  await expect(page.locator('#scenario-action option[value=selectDataset]')).toHaveCount(0);
  await expect(page.locator('#scenario-action option[value=resetPreview]')).toHaveCount(1);
  fail = false; await page.getByRole('button', { name: 'Повторить загрузку датасетов для сценария' }).click();
  await expect(page.locator('#scenario-dataset-status')).toContainText('Датасетов пока нет');
  await expect(page.locator('#scenario-action option[value=selectDataset]')).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: 'Датасет', exact: true })).toHaveValue('');
});


for (const change of ['screen', 'document', 'revision', 'user']) test(`discards a stale dataset list after ${change}`, async ({ page, request }) => {
  const { id, headers } = await setup(request); let release, entered, finished, first = true;
  const gate = new Promise(r => release = r), held = new Promise(r => entered = r), done = new Promise(r => finished = r);
  await page.route('**/datasets?*', async route => {
    if (first && new URL(route.request().url()).searchParams.get('limit') === '100') { first = false; entered(); await gate; await response(route, [{ id: randomUUID(), name: 'Stale fixture' }]).catch(() => {}); finished(); return; }
    return response(route, []);
  });
  await open(page, id); await page.locator('#screens button').first().click(); await held;
  if (change === 'screen') await page.locator('#screens button').nth(1).click();
  if (change === 'document') await page.getByRole('link', { name: '← Документы' }).click();
  if (change === 'user') await page.getByRole('button', { name: 'Забыть токен' }).click();
  if (change === 'revision') {
    expect((await request.post(`/api/v1/documents/${id}/commands/add-page`, { headers, data: { commandId: randomUUID(), pageId: randomUUID() } })).ok()).toBeTruthy();
    await page.getByRole('button', { name: 'Обновить страницы' }).click(); await expect(page.locator('#revision')).toContainText('ревизия 4');
  }
  release(); await done; await expect(page.locator('#scenario-dataset option').filter({ hasText: 'Stale fixture' })).toHaveCount(0);
});


test('SetDemoValue checks exact node and nullable value and retries the same command', async ({ page, request }) => {
  const { id } = await setup(request), node = randomUUID(), bodies = [];
  await page.route('**/children/**', route => route.fulfill({ json: { items: [{ id: node, name: 'Source', kind: 'Frame', childCount: 0 }], total: 1 } }));
  await page.route('**/scenario-capabilities?*', async route => {
    const q = new URL(route.request().url()).searchParams, value = route.request().postDataJSON().demoValue, target = q.get('demoNodeId');
    await route.fulfill({ json: { documentId: id, revision: Number(q.get('revision')), nodeId: q.get('nodeId'), targetId: q.get('targetId'), screenId: q.get('screenId'), variantId: q.get('variantId'), datasetId: q.get('datasetId'), demoNodeId: target, demoValue: value, profile: { id: 'figvam.portable-ui', version: 1 }, events: [0], actions: target === node && (value === null || value === 'allowed' || value === 'slow') ? ['setDemoValue'] : [] } }).catch(() => {});
  });
  await page.route('**/commands/create-scenario', route => { bodies.push(route.request().postDataJSON()); return route.fulfill({ status: 500, json: {} }); });
  await open(page, id); await page.locator('#screens button').first().click(); await page.getByRole('treeitem', { name: /Source/ }).click();
  await page.getByRole('button', { name: 'Использовать выбранный слой как целевой узел' }).click();
  await expect(page.locator('#scenario-action')).toHaveValue('setDemoValue');
  await page.getByRole('button', { name: 'Создать сценарий' }).click(); await expect(page.locator('#scenario-command-retry')).toBeVisible();
  await page.locator('#scenario-command-retry').click(); await expect.poll(() => bodies.length).toBe(2); expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0].scenario.actions).toEqual([{ type: 'setDemoValue', nodeId: node, value: null }]);
});


test('SetDemoValue discards stale responses and rejects changed values or nodes', async ({ page, request }) => {
  const { id } = await setup(request), node = randomUUID(), other = randomUUID(), bodies = []; let release, entered;
  const gate = new Promise(r => release = r), held = new Promise(r => entered = r);
  await page.route('**/children/**', route => route.fulfill({ json: { items: [{ id: node, name: 'Source', kind: 'Frame', childCount: 0 }], total: 1 } }));
  await page.route('**/scenario-capabilities?*', async route => {
    const q = new URL(route.request().url()).searchParams, value = route.request().postDataJSON().demoValue, target = q.get('demoNodeId');
    if (value === 'slow') { entered(); await gate; }
    await route.fulfill({ json: { documentId: id, revision: Number(q.get('revision')), nodeId: q.get('nodeId'), targetId: q.get('targetId'), screenId: q.get('screenId'), variantId: q.get('variantId'), datasetId: q.get('datasetId'), demoNodeId: target, demoValue: value, profile: { id: 'figvam.portable-ui', version: 1 }, events: [0], actions: target === node && ['slow', 'allowed'].includes(value) ? ['setDemoValue'] : [] } }).catch(() => {});
  });
  await page.route('**/commands/create-scenario', route => { bodies.push(route.request().postDataJSON()); return route.fulfill({ status: 400, json: { code: 'DENIED' } }); });
  await open(page, id); await page.locator('#screens button').first().click(); await page.getByRole('treeitem', { name: /Source/ }).click();
  await page.getByRole('button', { name: 'Использовать выбранный слой как целевой узел' }).click();
  await page.getByLabel('Значение null').uncheck(); await page.getByLabel('Демонстрационное значение').fill('slow'); await held;
  await page.getByLabel('Демонстрационное значение').fill('denied'); await expect(page.locator('#scenario-action option')).toHaveCount(0); release(); await expect(page.locator('#scenario-action option')).toHaveCount(0);
  await page.getByLabel('Демонстрационное значение').fill('allowed'); await expect(page.locator('#scenario-action')).toHaveValue('setDemoValue');
  await page.locator('#scenario-create-submit').click(); await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0].scenario.actions).toEqual([{ type: 'setDemoValue', nodeId: node, value: 'allowed' }]);
  await page.getByLabel('Целевой узел (ID)').fill(other); await expect(page.locator('#scenario-action option')).toHaveCount(0);
});

async function mockScenarioEditor(page, screens, { role = () => 'Owner', supports = () => [0], actions = (_q, _value) => ['resetPreview'], scenario: initial } = {}) {
  const node = initial?.nodeId ?? randomUUID(), other = randomUUID();
  const saved = initial ?? { id: randomUUID(), screenId: screens[0], nodeId: node, event: 0, actions: [{ type: 'resetPreview' }] };
  let current = saved;
  await page.route('**/api/v1/documents?*', async route => {
    const result = await route.fetch(), body = await result.json();
    for (const item of body.items) item.role = role();
    await route.fulfill({ response: result, json: body });
  });
  await page.route('**/children/**', route => route.fulfill({ json: { items: [
    { id: node, name: 'Source', kind: 'Frame', childCount: 0 },
    { id: other, name: 'Other', kind: 'Frame', childCount: 0 }
  ], total: 2 } }));
  await page.route('**/scenarios?*', route => response(route, new URL(route.request().url()).searchParams.get('screenId') === screens[0] ? [current] : []));
  await page.route('**/scenario-capabilities?*', async route => {
    const url = new URL(route.request().url()), q = url.searchParams, value = route.request().postDataJSON().demoValue;
    const choices = await actions(q, value);
    await route.fulfill({ json: {
      documentId: url.pathname.split('/')[4], revision: Number(q.get('revision')), nodeId: q.get('nodeId'),
      screenId: q.get('screenId'), variantId: q.get('variantId'), targetId: q.get('targetId'),
      datasetId: q.get('datasetId'), demoNodeId: q.get('demoNodeId'), demoValue: value,
      profile: { id: 'figvam.portable-ui', version: 1 }, events: supports(q.get('nodeId'), other), actions: choices
    } }).catch(() => {});
  });
  return { node, other, saved, changed: scenario => { current = scenario; } };
}

const editScenario = page => page.getByRole('button', { name: /^Изменить сценарий / });
const saveScenario = page => page.getByRole('button', { name: 'Сохранить сценарий', exact: true });

async function mockScenarioVariantCatalog(page, id, variants) {
  await page.route('**/variants?*', route => {
    const url = new URL(route.request().url()), q = url.searchParams, screenId = url.pathname.split('/')[6];
    const items = variants[screenId] ?? [];
    return route.fulfill({ json: { documentId: id, screenId, revision: Number(q.get('revision')), offset: Number(q.get('offset')), limit: Number(q.get('limit')), total: items.length, items } });
  });
}

test('Owner updates the source, event and ordered scenario actions through the typed command', async ({ page, request }) => {
  const { id, screens, headers } = await setup(request), source = randomUUID(), variant = randomUUID(), dataset = randomUUID();
  const initial = { id: randomUUID(), screenId: screens[0], nodeId: source, event: 0, actions: [
    { type: 'navigate', screenId: screens[1] },
    { type: 'showVariant', variantId: variant },
    { type: 'selectDataset', datasetId: dataset },
    { type: 'openOverlay', screenId: screens[0] },
    { type: 'setDemoValue', nodeId: source, value: '' },
    { type: 'closeOverlay' },
    { type: 'resetPreview' }
  ] };
  const capabilities = [];
  const editor = await mockScenarioEditor(page, screens, {
    scenario: initial, supports: (node, other) => node === other ? [1] : [0],
    actions: (q, value) => {
      const screen = q.get('screenId'), target = q.get('targetId'), variantId = q.get('variantId'), datasetId = q.get('datasetId'), demoNode = q.get('demoNodeId');
      capabilities.push([screen, target, variantId, datasetId, demoNode, value]);
      return [
        ...(target ? ['navigate', 'openOverlay'] : []),
        ...(!variantId || screen === screens[1] && variantId === variant ? ['showVariant'] : []),
        ...(!datasetId || datasetId === dataset ? ['selectDataset'] : []),
        ...(screen === screens[0] && demoNode === source && (value === '' || value === null) ? ['setDemoValue'] : []),
        'closeOverlay', 'resetPreview'
      ];
    }
  });
  await page.route('**/datasets?*', route => response(route, [{ id: dataset, name: 'Fixture' }]));
  await mockScenarioVariantCatalog(page, id, { [screens[1]]: [{ id: variant, name: 'Destination variant' }] });
  const bodies = [];
  await page.route('**/commands/update-scenario', async route => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    expect(route.request().headers().authorization).toBe('Bearer ' + bearer);
    expect((await request.post('/api/v1/documents/' + id + '/commands/add-page', { headers, data: { commandId: randomUUID(), pageId: randomUUID() } })).ok()).toBeTruthy();
    editor.changed(body.scenario);
    await route.fulfill({ json: { code: 'ACCEPTED', documentId: id, commandId: body.commandId, revision: 4 } });
  });

  await open(page, id);
  await page.locator('#screens button').first().click();
  await editScenario(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#scenario-edit-title')).toBeFocused();
  await expect(saveScenario(page)).toBeEnabled();
  await page.getByRole('treeitem', { name: /Other/ }).click();
  await page.getByRole('button', { name: 'Использовать выбранный слой как исходный узел' }).click();
  await expect(saveScenario(page)).toBeDisabled();
  await page.getByLabel('Событие сценария').selectOption('1');

  await page.getByRole('button', { name: 'Поднять действие 2' }).click();
  await expect(page.locator('#scenario-edit-validation')).toContainText('не поддерживаются в текущем контексте: 1');
  await expect(saveScenario(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Опустить действие 1' }).click();
  await page.getByRole('button', { name: 'Поднять действие 3' }).click();
  await page.getByRole('button', { name: 'Изменить действие 2' }).click();
  await page.getByLabel('Датасет действия').selectOption('');
  await expect(page.getByLabel('Тип действия сценария')).toHaveValue('selectDataset');
  await page.getByRole('button', { name: 'Применить действие' }).click();
  await page.getByRole('button', { name: 'Изменить действие 3' }).click();
  await expect(page.getByLabel('Вариант действия')).toHaveValue(variant);
  await expect(page.getByLabel('Тип действия сценария')).toHaveValue('showVariant');
  await page.getByRole('button', { name: 'Отменить правку действия' }).click();
  await page.getByRole('button', { name: 'Изменить действие 5' }).click();
  await page.getByLabel('Пустое значение (null)').check();
  await expect(page.getByLabel('Тип действия сценария')).toHaveValue('setDemoValue');
  await page.getByRole('button', { name: 'Применить действие' }).click();
  await page.getByRole('button', { name: 'Удалить действие 7' }).click();
  await expect(page.locator('#scenario-edit-actions > li')).toHaveCount(6);
  await page.getByRole('button', { name: 'Добавить действие', exact: true }).click();
  await page.getByLabel('Тип действия сценария').selectOption('resetPreview');
  await page.getByRole('button', { name: 'Применить действие' }).click();
  await saveScenario(page).click();

  await expect(page.locator('#revision')).toContainText('ревизия 4');
  await expect(page.locator('#scenario-command-status')).toContainText('подтверждено');
  await expect(page.locator('#scenario-edit')).toBeHidden();
  await expect(page.locator('#scenarios-list')).toContainText(editor.other + ' · Событие: Change');
  expect(bodies).toHaveLength(1);
  expect(bodies[0].commandId).toMatch(/^[0-9a-f-]{36}$/);
  expect(bodies[0]).toEqual({ commandId: bodies[0].commandId, expectedRevision: 3, scenario: { ...initial, nodeId: editor.other, event: 1, actions: [
    initial.actions[0], { type: 'selectDataset', datasetId: null }, initial.actions[1], initial.actions[3],
    { type: 'setDemoValue', nodeId: source, value: null }, initial.actions[5], initial.actions[6]
  ] } });
  expect(capabilities).toEqual(expect.arrayContaining([
    [screens[1], null, variant, null, null, null],
    [screens[0], null, null, null, source, ''],
    [screens[0], null, null, null, source, null]
  ]));
});

test('edits variant and multiline demo actions after closing an external overlay', async ({ page, request }) => {
  const { id, screens } = await setup(request), node = randomUUID(), variant = randomUUID(), demoNode = randomUUID();
  const originalText = 'line 1\r\nline 2';
  const actions = [{ type: 'closeOverlay' }, { type: 'showVariant', variantId: variant }, { type: 'setDemoValue', nodeId: demoNode, value: originalText }];
  await mockScenarioEditor(page, screens, {
    scenario: { id: randomUUID(), screenId: screens[0], nodeId: node, event: 0, actions },
    actions: (q, value) => [
      'closeOverlay',
      ...(q.get('screenId') === screens[1] && q.get('variantId') === variant ? ['showVariant'] : []),
      ...(q.get('screenId') === screens[1] && q.get('demoNodeId') === demoNode && value === originalText ? ['setDemoValue'] : [])
    ]
  });
  await mockScenarioVariantCatalog(page, id, { [screens[1]]: [{ id: variant, name: 'External variant' }] });
  let body;
  await page.route('**/commands/update-scenario', route => {
    body = route.request().postDataJSON();
    return route.fulfill({ status: 400, json: { code: 'INVALID_SCENARIO' } });
  });
  await open(page, id); await page.locator('#screens button').first().click(); await editScenario(page).click();
  await expect(saveScenario(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Изменить действие 2' }).click();
  await expect(page.getByRole('combobox', { name: 'Экран варианта', exact: true })).toHaveValue(screens[1]);
  await expect(page.getByLabel('Вариант действия')).toHaveValue(variant);
  await expect(page.getByLabel('Тип действия сценария')).toHaveValue('showVariant');
  await page.getByRole('button', { name: 'Применить действие' }).click();
  await page.getByRole('button', { name: 'Изменить действие 3' }).click();
  await expect(page.getByLabel('Значение действия')).toHaveValue('line 1\nline 2');
  await expect(page.getByLabel('Тип действия сценария')).toHaveValue('setDemoValue');
  await page.getByRole('button', { name: 'Применить действие' }).click();
  await saveScenario(page).click();
  await expect(page.locator('#scenario-command-error')).toContainText('отклонено');
  expect(body.scenario.actions).toEqual(actions);
});

test('Viewer reads an existing scenario and cannot submit the editor form', async ({ page, request }) => {
  const { id, screens } = await setup(request);
  let calls = 0;
  await mockScenarioEditor(page, screens, { role: () => 'Viewer' });
  await page.route('**/commands/update-scenario', route => { calls++; return route.abort(); });
  await open(page, id); await page.locator('#screens button').first().click();
  await expect(page.locator('#scenarios-list')).toContainText('ResetPreview');
  await expect(editScenario(page)).toHaveCount(0);
  await expect(page.locator('#scenario-edit')).toBeHidden();
  await page.locator('#scenario-edit').evaluate(form => form.requestSubmit());
  expect(calls).toBe(0);
});

test('Editor retries uncertainty with the same body and cannot submit twice while pending', async ({ page, request }) => {
  const { id, screens } = await setup(request);
  await mockScenarioEditor(page, screens, { role: () => 'Editor' });
  const bodies = [];
  let release, entered;
  const gate = new Promise(resolve => release = resolve), held = new Promise(resolve => entered = resolve);
  await page.route('**/commands/update-scenario', async route => {
    bodies.push(route.request().postData());
    if (bodies.length === 1) { entered(); await gate; }
    await route.fulfill({ status: bodies.length === 1 ? 503 : 400, json: { code: 'INVALID_SCENARIO' } });
  });
  await open(page, id); await page.locator('#screens button').first().click();
  await editScenario(page).click();
  await saveScenario(page).click(); await held;
  await expect(saveScenario(page)).toBeDisabled();
  await page.locator('#scenario-edit').evaluate(form => form.requestSubmit());
  release();
  const repeat = page.getByRole('button', { name: 'Повторить сохранение сценария' });
  await expect(repeat).toBeVisible(); expect(bodies).toHaveLength(1);
  await repeat.click();
  await expect(page.locator('#scenario-command-error')).toContainText('отклонено');
  await expect(saveScenario(page)).toBeEnabled();
  expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
});

test('conflict invalidates the draft and refreshes the scenario catalog', async ({ page, request }) => {
  const { id, screens, headers } = await setup(request);
  const editor = await mockScenarioEditor(page, screens, { supports: () => [0, 1] });
  await page.route('**/commands/update-scenario', async route => {
    editor.changed({ ...editor.saved, event: 1 });
    expect((await request.post('/api/v1/documents/' + id + '/commands/add-page', { headers, data: { commandId: randomUUID(), pageId: randomUUID() } })).ok()).toBeTruthy();
    await route.fulfill({ status: 409, json: { code: 'REVISION_CONFLICT' } });
  });
  await open(page, id); await page.locator('#screens button').first().click();
  await editScenario(page).click(); await saveScenario(page).click();
  await expect(page.locator('#scenario-command-error')).toContainText('Документ изменился');
  await expect(page.locator('#scenario-edit')).toBeHidden();
  await expect(page.locator('#revision')).toContainText('ревизия 4');
  await expect(page.locator('#scenarios-list')).toContainText('Событие: Change');
  await expect(page.locator('#scenario-command-retry')).toBeHidden();
});

test('after a command access denial, a demoted Editor can only read the catalog', async ({ page, request }) => {
  const { id, screens } = await setup(request);
  let role = 'Editor';
  await mockScenarioEditor(page, screens, { role: () => role });
  await page.route('**/commands/update-scenario', route => { role = 'Viewer'; return route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }); });
  await open(page, id); await page.locator('#screens button').first().click();
  await editScenario(page).click(); await saveScenario(page).click();
  await expect(page.locator('#scenario-command-error')).toContainText('Доступ');
  await expect(page.locator('#scenarios-list')).toContainText('ResetPreview');
  await expect(editScenario(page)).toHaveCount(0);
  await expect(page.locator('#scenario-edit')).toBeHidden();
});

test('profile restrictions disable unchanged unsupported actions and ignore stale choices', async ({ page, request }) => {
  const { id, screens } = await setup(request), node = randomUUID(), dataset = randomUUID();
  let release, entered, completed;
  const gate = new Promise(resolve => release = resolve), held = new Promise(resolve => entered = resolve), done = new Promise(resolve => completed = resolve);
  await mockScenarioEditor(page, screens, {
    scenario: { id: randomUUID(), screenId: screens[0], nodeId: node, event: 0, actions: [{ type: 'navigate', screenId: screens[1] }] },
    actions: async (q, value) => {
      if (q.get('demoNodeId') === node && value === 'slow') { entered(); await gate; return ['setDemoValue', 'resetPreview']; }
      return ['resetPreview'];
    }
  });
  page.on('response', response => {
    if (response.url().includes('demoNodeId=') && response.request().postDataJSON().demoValue === 'slow') completed();
  });
  await page.route('**/datasets?*', route => response(route, [{ id: dataset, name: 'Fixture' }]));
  await open(page, id); await page.locator('#screens button').first().click();
  await editScenario(page).click();
  await expect(page.locator('#scenario-edit-validation')).toContainText('не поддерживаются');
  await expect(saveScenario(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Удалить действие 1' }).click();
  await expect(page.locator('#scenario-edit-validation')).toContainText('хотя бы одно');
  await page.getByRole('button', { name: 'Добавить действие', exact: true }).click();
  await page.getByLabel('Датасет действия').selectOption(dataset);
  await page.getByLabel('Целевой узел действия (ID)').fill(node);
  await page.getByLabel('Пустое значение (null)').uncheck();
  await page.getByLabel('Значение действия').fill('slow'); await held;
  await page.getByLabel('Значение действия').fill('denied');
  const options = page.getByLabel('Тип действия сценария').locator('option');
  await expect(options).toHaveText(['ResetPreview']);
  release(); await done;
  await expect(options).toHaveText(['ResetPreview']);
  await page.getByRole('button', { name: 'Применить действие' }).click();
  await expect(saveScenario(page)).toBeEnabled();
});

for (const exit of ['screen', 'document', 'logout']) test('discards a stale update acknowledgement after ' + exit, async ({ page, request }) => {
  const { id, screens } = await setup(request);
  await mockScenarioEditor(page, screens);
  let release, entered, completed;
  const gate = new Promise(resolve => release = resolve), held = new Promise(resolve => entered = resolve), done = new Promise(resolve => completed = resolve);
  const calls = [];
  await page.route('**/commands/update-scenario', async route => {
    const body = route.request().postDataJSON(); calls.push(body);
    entered(); await gate;
    await route.fulfill({ json: { code: 'ACCEPTED', documentId: id, commandId: body.commandId, revision: 4 } }).catch(() => {});
    completed();
  });
  await open(page, id); await page.locator('#screens button').first().click();
  await editScenario(page).click(); await saveScenario(page).click(); await held;
  if (exit === 'screen') {
    await page.locator('#screens button').nth(1).click();
    await expect(page.locator('#scenarios-status')).toContainText('нет');
  } else if (exit === 'document') {
    await page.getByRole('link', { name: '← Документы' }).click();
    await expect(page.locator('#documents-view')).toBeVisible();
  } else {
    await page.getByRole('button', { name: 'Забыть токен' }).click();
    await expect(page.locator('#authentication')).toBeVisible();
  }
  release(); await done;
  await expect(page.locator('#scenario-command-status')).toHaveText('');
  await expect(page.locator('#scenario-edit')).toBeHidden();
  expect(calls).toHaveLength(1);
  if (exit === 'screen') {
    await expect(page.locator('#revision')).toContainText('ревизия 3');
    await page.locator('#screens button').first().click();
    await expect(page.getByRole('button', { name: 'Повторить сохранение сценария' })).toBeVisible();
  }
});
