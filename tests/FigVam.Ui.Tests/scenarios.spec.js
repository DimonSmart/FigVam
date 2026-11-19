const { test, expect, bearer } = require('./fixtures');
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
    return route.fulfill({ json: { documentId: u.pathname.split('/')[4], revision: Number(q.get('revision')), nodeId: q.get('nodeId'), targetId: q.get('targetId'), screenId: q.get('screenId'), variantId: q.get('variantId'), profile: { id: 'figvam.portable-ui', version: 1 }, events, actions: q.has('targetId') ? actions : actions.filter(a => !['navigate', 'openOverlay'].includes(a)) } });
  });
}
async function prepareCreation(page, id, screens) {
  await mockCapabilities(page);
  const node = randomUUID();
  await page.route('**/children/**', route => route.fulfill({ json: { items: [{ id: node, name: 'Source', kind: 'Frame', childCount: 0 }], total: 1 } }));
  await open(page, id); await page.locator('#screens button').first().click();
  await page.getByRole('treeitem', { name: /Source/ }).click();
  await expect(page.locator('#scenario-target option')).toHaveCount(2);
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
    return route.fulfill({ json: { documentId: id, revision: Number(q.get('revision')) + (mode === 'stale' ? 1 : 0), nodeId: q.get('nodeId'), targetId: q.get('targetId'), screenId: q.get('screenId'), variantId: q.get('variantId'), profile: { id: 'figvam.portable-ui', version: 1 }, events: mode === 'limited' ? [1] : [0], actions: mode === 'limited' ? ['resetPreview'] : ['navigate'] } });
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
  await page.route('**/scenario-capabilities?*', async route => { const q = new URL(route.request().url()).searchParams, value = q.get('variantId'); if (value === allowed) { entered(); await gate; } await route.fulfill({ json: { documentId: id, revision: Number(q.get('revision')), nodeId: q.get('nodeId'), targetId: q.get('targetId'), screenId: q.get('screenId'), variantId: value, profile: { id: 'figvam.portable-ui', version: 1 }, events: [0], actions: value === denied ? [] : ['showVariant'] } }).catch(() => {}); });
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
  await page.route('**/scenario-capabilities?*', route => { const q = new URL(route.request().url()).searchParams; return route.fulfill({ json: { documentId: id, revision: Number(q.get('revision')), nodeId: q.get('nodeId'), targetId: q.get('targetId'), screenId: q.get('screenId'), variantId: q.get('variantId'), profile: { id: 'figvam.portable-ui', version: 1 }, events: [0], actions: ['showVariant'] } }); });
  await page.route('**/commands/create-scenario', route => { body = route.request().postDataJSON(); return route.fulfill({ status: 400, json: { code: 'INVALID' } }); });
  await open(page, id); await page.locator('#screens button').first().click(); await page.getByRole('treeitem', { name: /Source/ }).click();
  await expect(page.getByLabel('Вариант экрана').locator('option')).toHaveCount(2); await page.getByLabel('Вариант экрана').selectOption(variant);
  await expect(page.getByLabel('Действие')).toHaveValue('showVariant'); await page.getByRole('button', { name: 'Создать сценарий' }).click();
  await expect(page.locator('#scenario-command-error')).toContainText('отклонено'); expect(body.scenario.actions).toEqual([{ type: 'showVariant', variantId: variant }]);
});
