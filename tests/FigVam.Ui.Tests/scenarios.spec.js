const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');
const { randomUUID } = require('node:crypto');
const headers = { Authorization: 'Bearer ' + bearer };
const str = value => ({ type: 'string', value });
const guids = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function setup(request, { duplicate = false, extra = false } = {}) {
  const id = randomUUID(), pageId = randomUUID(), screens = [randomUUID(), randomUUID(), randomUUID()];
  const source = randomUUID(), second = randomUUID(), target = randomUUID(), overlay = randomUUID();
  const base = '/api/v1/documents/' + id;
  async function command(action, data) {
    const result = await request.post(base + '/commands/' + action, { headers, data: { commandId: randomUUID(), ...data } });
    expect(result.ok(), action + ': ' + await result.text()).toBeTruthy();
    return result.json();
  }
  const created = await request.post('/api/v1/documents', { headers, data: { documentId: id, name: 'Scenarios' } });
  expect(created.ok()).toBeTruthy();
  await command('add-page', { pageId });
  for (const [index, screenId] of screens.entries()) {
    await command('add-screen', { pageId, screenId, dimensions: { width: 600, height: 400 } });
    await command('rename-screen', { screenId, name: ['Start', 'Destination', duplicate ? 'Destination' : 'Overlay'][index] });
  }
  await command('add-node', { nodeId: source, parentId: screens[0], kind: 'Button', properties: { text: str('Source') } });
  await command('add-node', { nodeId: second, parentId: screens[0], kind: 'Button', properties: { text: str('Second') } });
  await command('add-node', { nodeId: target, parentId: screens[1], kind: 'TextInput', properties: { placeholder: str('Target') } });
  await command('add-node', { nodeId: overlay, parentId: screens[2], kind: 'TextInput', properties: { placeholder: str('Overlay field'), inputType: { type: 'enum', value: 'Password' } } });
  let variant = null, dataset = null;
  if (extra) {
    variant = randomUUID(); dataset = randomUUID();
    await command('add-screen-variant', { screenId: screens[1], variantId: variant, name: 'Loading' });
    await command('add-dataset', { datasetId: dataset, name: 'Fixture', fixtureJson: '[1]' });
  }
  async function catalog() {
    const result = await request.get(base + '/scenarios?limit=100', { headers });
    expect(result.ok()).toBeTruthy();
    return result.json();
  }
  async function add(nodeId = source, actions = [{ type: 'resetPreview' }], event = 0) {
    const scenario = { id: randomUUID(), screenId: screens[0], nodeId, event, actions };
    await command('create-scenario', { scenario }); return scenario;
  }
  return { id, base, screens, source, second, target, overlay, variant, dataset, command, catalog, add };
}

async function open(page, fixture) {
  await page.goto('/documents/' + fixture.id);
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#screens .screen-select')).toHaveCount(3);
  await screen(page, 'Start');
  await show(page, 'prototype');
  await expect(page.locator('#scenarios-status')).not.toContainText('Загрузка');
}
async function screen(page, name) {
  await page.locator('#screens .screen-select').filter({ hasText: new RegExp('^' + name + '(?:\\s|$)') }).first().click();
}
async function layer(page, name) {
  await page.getByRole('treeitem', { name: new RegExp('^' + name + ',') }).click();
  await expect(page.locator('#scenarios-title')).toContainText(name);
}
const form = page => page.locator('#scenario-edit');
const actions = page => page.locator('#scenario-edit-actions > li');
const save = page => page.getByRole('button', { name: 'Сохранить взаимодействие', exact: true });
const card = page => page.locator('#scenarios-list > li');
const refresh = page => page.getByRole('button', { name: 'Обновить страницы' }).click();
async function create(page, name = 'Source') {
  await layer(page, name);
  await page.getByRole('button', { name: 'Добавить взаимодействие', exact: true }).click();
  await expect(page.getByLabel('Событие', { exact: true })).toHaveValue('0');
}
async function type(page, index, label) {
  await page.getByLabel('Тип действия ' + (index + 1), { exact: true }).selectOption({ label });
}
async function addAction(page, label) {
  const index = await actions(page).count();
  await page.getByRole('button', { name: 'Добавить действие', exact: true }).click();
  await type(page, index, label);
  return index;
}
async function pick(page, index, name, search) {
  const row = actions(page).nth(index);
  const select = row.getByLabel(name, { exact: true });
  await row.getByLabel('Поиск: ' + name, { exact: true }).fill(search);
  const option = select.getByRole('option', { name: new RegExp(search.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')) });
  await expect(option).toHaveCount(1);
  await select.selectOption({ label: await option.textContent() });
}
async function persist(page, command = 'create') {
  await expect(save(page)).toBeEnabled();
  const response = page.waitForResponse(r => r.url().endsWith('/commands/' + command + '-scenario'));
  await save(page).click();
  const result = await response;
  expect(result.ok(), await result.text()).toBeTruthy();
  await expect(page.locator('#scenario-command-status')).toContainText('подтверждено');
  await expect(form(page)).toBeHidden();
}
async function resetDraft(page) {
  await create(page); await type(page, 0, 'Сбросить Preview'); await expect(save(page)).toBeEnabled();
}
async function edit(page, name = 'Source') {
  await layer(page, name);
  await card(page).first().getByRole('button', { name: /^Изменить сценарий/ }).click();
  await expect(form(page)).toBeVisible();
}

test('creates named interaction with multiple actions, overview, marker, and delete', async ({ page, request }) => {
  const f = await setup(request); await open(page, f);
  await expect(form(page)).toBeHidden();
  await expect(page.locator('#scenario-create')).toBeHidden();
  await create(page);
  await expect(actions(page).first().getByLabel('Целевой экран', { exact: true })).toHaveCount(0);
  await type(page, 0, 'Перейти на экран');
  await expect(actions(page).first().getByLabel('Датасет', { exact: true })).toHaveCount(0);
  await expect(actions(page).first().getByLabel('Целевой элемент', { exact: true })).toHaveCount(0);
  await pick(page, 0, 'Целевой экран', 'Destination');
  await addAction(page, 'Установить значение');
  await pick(page, 1, 'Целевой элемент', 'Target');
  await persist(page);
  await expect(card(page)).toHaveCount(1);
  await expect(card(page)).toContainText('Destination');
  await expect(card(page)).not.toContainText(guids);
  await expect(page.getByRole('treeitem', { name: /Source, Button/ }).locator('.layer-interaction')).toHaveCount(1);
  const stored = (await f.catalog()).items;
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ nodeId: f.source, event: 0, actions: [{ type: 'navigate', screenId: f.screens[1] }, { type: 'setDemoValue', nodeId: f.target, value: null }] });
  await layer(page, 'Second'); await expect(card(page)).toHaveCount(0);
  await screen(page, 'Start'); await expect(card(page)).toHaveCount(1);
  await card(page).getByRole('button', { name: 'Source · По нажатию' }).click();
  await expect(page.getByRole('treeitem', { name: /Source, Button/ })).toHaveAttribute('aria-selected', 'true');
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('Source'); expect(dialog.message()).not.toMatch(guids); await dialog.dismiss(); });
  await card(page).getByRole('button', { name: /^Удалить сценарий/ }).click();
  expect((await f.catalog()).items).toHaveLength(1);
  page.once('dialog', dialog => dialog.accept());
  await card(page).getByRole('button', { name: /^Удалить сценарий/ }).click();
  await expect(page.locator('#scenario-command-status')).toContainText('подтверждено');
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByRole('treeitem', { name: /Source, Button/ }).locator('.layer-interaction')).toHaveCount(0);
});

test('reads every API page for overview, selected element and indicators', async ({ page, request }) => {
  const f = await setup(request);
  for (let i = 0; i < 20; i++) await f.add();
  const last = await f.add(f.second);
  const offsets = [];
  await page.route('**/scenarios?*', route => {
    const q = new URL(route.request().url()).searchParams;
    expect(route.request().headers().authorization).toBe('Bearer ' + bearer);
    offsets.push(Number(q.get('offset'))); return route.continue();
  });
  await open(page, f);
  await expect(page.locator('#scenarios-number')).toHaveText('1–20 из 21');
  await expect(page.getByRole('treeitem', { name: /Second, Button/ }).locator('.layer-interaction')).toHaveCount(1);
  await page.getByRole('button', { name: 'Следующие сценарии' }).click();
  await expect(page.locator('#scenarios-number')).toHaveText('21–21 из 21');
  await expect(card(page)).toHaveAttribute('data-scenario-id', last.id);
  expect(offsets).toContain(20);
  await layer(page, 'Second'); await expect(card(page)).toHaveCount(1);
  await layer(page, 'Source'); await expect(card(page)).toHaveCount(20);
});

test('rename updates names without changing stable references', async ({ page, request }) => {
  const f = await setup(request); const original = await f.add(f.source, [{ type: 'navigate', screenId: f.screens[1] }]);
  await open(page, f); await expect(card(page)).toContainText('Destination');
  await f.command('rename-screen', { screenId: f.screens[1], name: 'Renamed destination' });
  await f.command('set-node-name', { nodeId: f.source, name: 'Renamed source' });
  await refresh(page);
  await expect(card(page)).toContainText('Renamed destination');
  await expect(card(page)).toContainText('Renamed source');
  expect((await f.catalog()).items).toEqual([original]);
});

test('identical screen paths are distinguished without GUIDs', async ({ page, request }) => {
  const f = await setup(request, { duplicate: true }); await open(page, f); await create(page);
  await type(page, 0, 'Перейти на экран');
  const picker = actions(page).first().getByLabel('Целевой экран', { exact: true });
  const options = picker.getByRole('option', { name: /Destination/ });
  await expect(options).toHaveCount(2);
  const labels = await options.allTextContents();
  expect(new Set(labels).size).toBe(2); expect(labels.join(' ')).not.toMatch(guids);
  await picker.selectOption({ label: labels[1] }); await persist(page);
  expect((await f.catalog()).items[0].actions).toEqual([{ type: 'navigate', screenId: f.screens[2] }]);
});

test('overlay context and navigation variant context stay distinct; null and empty values survive reopening', async ({ page, request }) => {
  test.setTimeout(120_000);
  const f = await setup(request, { extra: true }); await open(page, f); await create(page);
  await type(page, 0, 'Перейти на экран'); await pick(page, 0, 'Целевой экран', 'Destination');
  await addAction(page, 'Переключить вариант'); await pick(page, 1, 'Вариант', 'Loading');
  await addAction(page, 'Открыть оверлей'); await pick(page, 2, 'Целевой экран', 'Overlay');
  await addAction(page, 'Установить значение'); await pick(page, 3, 'Целевой элемент', 'Overlay field');
  await expect(actions(page).nth(3).getByRole('option', { name: /Target/ })).toHaveCount(0);
  await addAction(page, 'Закрыть оверлей');
  await addAction(page, 'Установить значение'); await pick(page, 5, 'Целевой элемент', 'Target');
  await actions(page).nth(5).getByLabel('Значение null', { exact: true }).uncheck();
  await addAction(page, 'Переключить вариант'); await pick(page, 6, 'Вариант', 'Базовое состояние');
  await addAction(page, 'Выбрать датасет'); await pick(page, 7, 'Датасет', 'Fixture');
  await addAction(page, 'Выбрать датасет'); await pick(page, 8, 'Датасет', 'Без датасета');
  await persist(page);
  const expected = [
    { type: 'navigate', screenId: f.screens[1] }, { type: 'showVariant', variantId: f.variant },
    { type: 'openOverlay', screenId: f.screens[2] }, { type: 'setDemoValue', nodeId: f.overlay, value: null },
    { type: 'closeOverlay' }, { type: 'setDemoValue', nodeId: f.target, value: '' },
    { type: 'showVariant', variantId: null }, { type: 'selectDataset', datasetId: f.dataset },
    { type: 'selectDataset', datasetId: null }
  ];
  expect((await f.catalog()).items[0].actions).toEqual(expected);
  await open(page, f);
  await edit(page);
  await expect(actions(page)).toHaveCount(9);
  await expect(actions(page).nth(3).getByLabel('Значение null')).toBeChecked();
  await expect(actions(page).nth(5).getByLabel('Значение null')).not.toBeChecked();
  await expect(save(page)).toBeEnabled();
  await persist(page, 'update');
  expect((await f.catalog()).items[0].actions).toEqual(expected);
});

test('unknown navigation screen allows eligible targets with context and preserves password privacy', async ({ page, request }) => {
  const f = await setup(request); await open(page, f); await create(page);
  await type(page, 0, 'Закрыть оверлей');
  await addAction(page, 'Установить значение'); await pick(page, 1, 'Целевой элемент', 'Overlay field');
  await actions(page).nth(1).getByLabel('Значение null').uncheck();
  const password = actions(page).nth(1).locator('input[type=password]');
  await expect(password).toBeVisible(); await password.fill('example-only');
  await expect(actions(page).nth(1)).toContainText('состоянием Preview');
  await persist(page);
  await expect(card(page)).not.toContainText('example-only');
  await expect(card(page)).toContainText('Значение задано');
});

test('reordering an invalidated target preserves the target and prevents save', async ({ page, request }) => {
  const f = await setup(request); const original = await f.add(f.source, [{ type: 'navigate', screenId: f.screens[1] }, { type: 'setDemoValue', nodeId: f.target, value: null }]);
  await open(page, f); await edit(page); await expect(save(page)).toBeEnabled();
  const up = page.getByRole('button', { name: 'Поднять действие 2' });
  await up.focus(); await up.press('Enter');
  await expect(actions(page).first()).toContainText('Цель недоступна');
  await expect(actions(page).first().getByLabel('Целевой элемент', { exact: true })).toHaveValue(f.target);
  await expect(save(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Опустить действие 1' }).press('Enter');
  await expect(save(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect((await f.catalog()).items).toEqual([original]);
});

test('draft cancellation and selection change require explicit choice', async ({ page, request }) => {
  const f = await setup(request); await open(page, f); await resetDraft(page);
  let writes = 0;
  await page.route('**/commands/create-scenario', route => { writes++; return route.continue(); });
  await page.getByRole('treeitem', { name: /Second, Button/ }).click();
  await expect(page.locator('#scenario-leave-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить редактирование' }).click();
  await expect(form(page)).toBeVisible();
  await page.getByRole('tab', { name: 'Дизайн' }).click();
  await expect(page.locator('#scenario-leave-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Отбросить изменения' }).click();
  await expect(form(page)).toBeHidden(); expect(writes).toBe(0);
  await show(page, 'prototype'); await resetDraft(page);
  await page.getByRole('treeitem', { name: /Second, Button/ }).click();
  await page.locator('#scenario-leave-save').click();
  await expect(page.locator('#scenarios-title')).toContainText('Second');
  expect(writes).toBe(1); expect((await f.catalog()).items).toHaveLength(1);
});

test('same event scenarios keep identity and order on edit', async ({ page, request }) => {
  const f = await setup(request); const first = await f.add(); const second = await f.add();
  await open(page, f); await edit(page);
  await type(page, 0, 'Перейти на экран'); await pick(page, 0, 'Целевой экран', 'Destination'); await persist(page, 'update');
  const stored = (await f.catalog()).items;
  expect(stored.map(s => s.id)).toEqual([first.id, second.id]);
  expect(stored[0].actions).toEqual([{ type: 'navigate', screenId: f.screens[1] }]);
  expect(stored[1]).toEqual(second);
});

test('remote changes preserve dirty draft until explicit reload', async ({ page, request }) => {
  const f = await setup(request); const original = await f.add();
  await open(page, f); await edit(page);
  await type(page, 0, 'Перейти на экран'); await pick(page, 0, 'Целевой экран', 'Destination');
  await expect(save(page)).toBeEnabled();
  const revision = (await f.catalog()).revision;
  await f.command('update-scenario', { expectedRevision: revision, scenario: { ...original, actions: [{ type: 'closeOverlay' }] } });
  await refresh(page);
  await expect(page.locator('#scenario-edit-conflict')).toContainText('Документ изменился');
  await expect(actions(page).first().getByLabel('Тип действия 1')).toHaveValue('navigate');
  await expect(save(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Загрузить актуальное взаимодействие' }).click();
  await expect(actions(page).first().getByLabel('Тип действия 1')).toHaveValue('closeOverlay');
  await expect(save(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
});

test('Viewer can navigate from overview but not edit', async ({ page, request }) => {
  const f = await setup(request); await f.add();
  await page.route('**/api/v1/documents?*', async route => {
    const result = await route.fetch(), body = await result.json(); body.items.forEach(item => item.role = 'Viewer');
    await route.fulfill({ response: result, json: body });
  });
  await open(page, f);
  await expect(card(page)).toContainText('Source');
  await card(page).getByRole('button', { name: 'Source · По нажатию' }).click();
  await expect(page.locator('#scenarios-title')).toContainText('Source');
  await expect(page.locator('#scenario-create')).toBeHidden();
  await expect(card(page).getByRole('button', { name: /^Изменить сценарий|^Удалить сценарий/ })).toHaveCount(0);
});

for (const kind of ['create', 'update', 'delete']) test('unknown ' + kind + ' result retries the identical payload', async ({ page, request }) => {
  const f = await setup(request); if (kind !== 'create') await f.add();
  await open(page, f); const bodies = [];
  await page.route('**/commands/' + kind + '-scenario', async route => {
    bodies.push(route.request().postData());
    if (bodies.length === 1) { await route.fetch(); await route.abort(); }
    else await route.continue();
  });
  if (kind === 'create') { await resetDraft(page); await save(page).click(); }
  if (kind === 'update') { await edit(page); await type(page, 0, 'Закрыть оверлей'); await expect(save(page)).toBeEnabled(); await save(page).click(); }
  if (kind === 'delete') { await layer(page, 'Source'); page.once('dialog', d => d.accept()); await card(page).getByRole('button', { name: /^Удалить сценарий/ }).click(); }
  await expect(page.locator('#scenario-command-error')).toContainText('неизвестен');
  await page.locator('#scenario-command-retry').click();
  await expect(page.locator('#scenario-command-status')).toContainText('подтверждено');
  expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]);
  expect((await f.catalog()).items).toHaveLength(kind === 'delete' ? 0 : 1);
});

test('server rejection retains draft without writing document', async ({ page, request }) => {
  const f = await setup(request); await open(page, f); await resetDraft(page);
  await page.route('**/commands/create-scenario', route => route.fulfill({ status: 400, json: { code: 'INVALID_SCENARIO', message: 'At most 1000 scenarios are allowed.' } }));
  await save(page).click();
  await expect(page.locator('#scenario-command-error')).toContainText('отклонена');
  await expect(form(page)).toBeVisible();
  await expect(actions(page).first().getByLabel('Тип действия 1')).toHaveValue('resetPreview');
  expect((await f.catalog()).items).toHaveLength(0);
});

test('catalog error is not an empty state and can be retried', async ({ page, request }) => {
  const f = await setup(request); await f.add();
  await page.route('**/scenarios?*', route => route.fulfill({ status: 503, json: {} }), { times: 1 });
  await open(page, f);
  await expect(page.locator('#scenarios-status')).toContainText('Не удалось');
  await page.getByRole('button', { name: 'Повторить загрузку сценариев' }).click();
  await expect(card(page)).toHaveCount(1);
});

test('late screen response is not shown in new screen', async ({ page, request }) => {
  const f = await setup(request); await f.add();
  let release, entered;
  const gate = new Promise(r => release = r), held = new Promise(r => entered = r);
  await page.route('**/scenarios?*', async route => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get('screenId') !== f.screens[0]) return route.continue();
    const response = await route.fetch(); entered(); await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.goto('/documents/' + f.id);
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await screen(page, 'Start'); await held; await show(page, 'prototype');
  await screen(page, 'Destination');
  await expect(page.locator('#scenarios-status')).toContainText('нет');
  release(); await expect(card(page)).toHaveCount(0);
});

test('potential action types are available before choosing a target; server restrictions are authoritative', async ({ page, request }) => {
  const f = await setup(request); await open(page, f);
  await page.route('**/scenario-capabilities?*', async route => {
    const response = await route.fetch(), body = await response.json();
    body.potentialActions = ['navigate']; body.actions = [];
    await route.fulfill({ response, json: body });
  });
  await create(page); await type(page, 0, 'Перейти на экран');
  await expect(actions(page).first().getByRole('option', { name: 'Сбросить Preview' })).toHaveCount(0);
  await pick(page, 0, 'Целевой экран', 'Destination');
  await expect(actions(page).first()).toContainText('Параметры не поддерживаются');
  await expect(save(page)).toBeDisabled();
});

test('undo and redo update the scenario and layer marker together', async ({ page, request }) => {
  const f = await setup(request); await open(page, f); await resetDraft(page); await persist(page);
  const row = page.getByRole('treeitem', { name: /Source, Button/ });
  await expect(row.locator('.layer-interaction')).toHaveCount(1);
  await page.getByRole('button', { name: 'Отменить действие', exact: true }).click();
  await expect(row.locator('.layer-interaction')).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
  expect((await f.catalog()).items).toHaveLength(0);
  await page.getByRole('button', { name: 'Повторить действие', exact: true }).click();
  await expect(row.locator('.layer-interaction')).toHaveCount(1);
  await expect(card(page)).toHaveCount(1);
  expect((await f.catalog()).items).toHaveLength(1);
});

test('failed object catalog read cannot be mistaken for an empty scenario list', async ({ page, request }) => {
  const f = await setup(request); await f.add();
  await page.route('**/datasets?*', route => {
    if (new URL(route.request().url()).searchParams.get('limit') === '100') return route.fulfill({ status: 503, json: {} });
    return route.continue();
  });
  await open(page, f);
  await expect(page.locator('#scenarios-status')).toContainText('Не удалось');
  await expect(page.getByRole('treeitem', { name: /Source, Button/ }).locator('.layer-interaction')).toHaveCount(1);
  await page.unroute('**/datasets?*');
  await page.getByRole('button', { name: 'Повторить загрузку сценариев' }).click();
  await expect(card(page)).toHaveCount(1);
});

test('late capability response cannot populate another node draft', async ({ page, request }) => {
  const f = await setup(request); await open(page, f);
  let release, entered;
  const gate = new Promise(r => release = r), held = new Promise(r => entered = r);
  await page.route('**/scenario-capabilities?*', async route => {
    if (new URL(route.request().url()).searchParams.get('nodeId') !== f.source) return route.continue();
    const response = await route.fetch(); entered(); await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await layer(page, 'Source');
  await page.getByRole('button', { name: 'Добавить взаимодействие', exact: true }).click();
  await held;
  await layer(page, 'Second');
  await page.getByRole('button', { name: 'Добавить взаимодействие', exact: true }).click();
  await expect(page.locator('#scenario-edit-source')).toContainText('Second');
  release();
  await type(page, 0, 'Сбросить Preview'); await persist(page);
  expect((await f.catalog()).items[0].nodeId).toBe(f.second);
});

test('actions can be edited using keyboard controls and cannot exceed the action limit', async ({ page, request }) => {
  test.setTimeout(120_000);
  const f = await setup(request); await f.add(f.source, Array.from({ length: 32 }, () => ({ type: 'resetPreview' })));
  await open(page, f); await edit(page);
  await expect(actions(page)).toHaveCount(32);
  await expect(page.getByRole('button', { name: 'Добавить действие', exact: true })).toBeDisabled();
  const remove = page.getByRole('button', { name: 'Удалить действие 32', exact: true });
  await remove.focus(); await remove.press('Enter');
  await expect(actions(page)).toHaveCount(31);
  const add = page.getByRole('button', { name: 'Добавить действие', exact: true });
  await add.focus(); await add.press('Enter');
  await expect(actions(page)).toHaveCount(32);
  await type(page, 31, 'Закрыть оверлей');
  await persist(page, 'update');
  expect((await f.catalog()).items[0].actions.at(-1)).toEqual({ type: 'closeOverlay' });
});
