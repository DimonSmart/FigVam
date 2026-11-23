const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');
const { randomUUID } = require('node:crypto');

const headers = { Authorization: `Bearer ${bearer}` };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DA8J8BAAf/Af8Bf4mnAAAAAElFTkSuQmCC', 'base64');
const number = value => ({ type: 'number', value });
const color = (red, green, blue, alpha = 255) => ({ type: 'color', red, green, blue, alpha });

async function login(page) {
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
}

async function post(request, path, data) {
  const response = await request.post(path, { headers, data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function seedText(request) {
  const documentId = randomUUID(), pageId = randomUUID(), screenId = randomUUID(), nodeId = randomUUID(), tokenId = randomUUID();
  const base = `/api/v1/documents/${documentId}`;
  const command = (name, data) => post(request, `${base}/commands/${name}`, { commandId: randomUUID(), ...data });
  await post(request, '/api/v1/documents', { documentId, name: 'Typed inspector' });
  await command('add-page', { pageId });
  await command('add-screen', { pageId, screenId, dimensions: { width: 800, height: 600 } });
  await command('add-node', { nodeId, parentId: screenId, kind: 'Text' });
  await command('add-token', { tokenId, name: 'Ink', type: 0, values: {
    Light: { expression: 'literal', value: color(20, 40, 60) },
    Dark: { expression: 'literal', value: color(220, 230, 240) }
  } });
  return { documentId, screenId, nodeId, tokenId, base };
}

async function addFromPalette(page, kind) {
  await show(page, 'layers');
  await show(page, 'palette'); await page.getByLabel('Вид элемента').selectOption(kind);
  const result = page.waitForResponse(response => response.url().endsWith('/commands/add-node'));
  await page.locator('#visual-add').press('Enter');
  const response = await result;
  expect(response.ok(), await response.text()).toBeTruthy();
  const { nodeId } = await response.json();
  const row = page.locator(`[role=treeitem][data-id="${nodeId}"]`);
  await expect(row).toHaveAttribute('aria-selected', 'true');
  return { nodeId, row, body: response.request().postDataJSON() };
}

async function readNodes(request, base, screenId) {
  const response = await request.get(`${base}/nodes?screenId=${screenId}&fields=kind,parentId,properties`, { headers });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).items;
}

test('palette uploads an image, rejects invalid content, and creates all five kinds', async ({ page, request }) => {
  await page.goto('/');
  await login(page);
  await page.getByLabel('Имя нового документа').fill('Palette');
  await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+$/);
  const base = `/api/v1${new URL(page.url()).pathname}`;
  await page.getByRole('button', { name: 'Создать страницу' }).click();
  await show(page, 'screen'); await page.getByLabel('Ширина экрана').fill('800');
  await page.getByLabel('Высота экрана').fill('600');
  await page.getByRole('button', { name: 'Создать экран' }).click();
  // Wait until the asynchronous screen creation has selected the new screen.
  // Otherwise the upload form correctly refuses submission without a screen.
  await expect(page.locator('#open-preview')).toBeEnabled();
  await show(page, 'assets');
  const upload = page.getByLabel('Изображение PNG');
  await upload.setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('invalid') });
  await page.getByRole('button', { name: 'Загрузить изображение' }).press('Enter');
  await expect(page.locator('#asset-upload-error')).toContainText('Сервер отклонил изображение');
  await upload.setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: png });
  const uploadResponse = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes('/assets/'));
  await page.getByRole('button', { name: 'Загрузить изображение' }).press('Enter');
  const uploaded = await uploadResponse;
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const assetId = new URL(uploaded.url()).pathname.split('/').pop();
  await expect(page.locator('#asset-upload-status')).toContainText('Изображение загружено');
  await show(page, 'palette');
  const kindPicker = page.getByLabel('Вид элемента');
  await expect(kindPicker.locator('option')).toHaveText(['Frame', 'Text', 'Button', 'TextInput', 'Image']);
  await expect(page.locator('#visual-palette-status')).toContainText('240 × 160');
  const frame = await addFromPalette(page, 'Frame');
  const screenId = frame.body.parentId;
  const text = await addFromPalette(page, 'Text');
  expect(text.body.parentId).toBe(frame.nodeId);
  await expect(page.locator('#visual-add')).toBeDisabled();
  await expect(page.locator('#visual-palette-status')).toContainText('не допускает дочерние');
  await frame.row.press('Enter');
  const button = await addFromPalette(page, 'Button');
  await frame.row.press('Enter');
  const input = await addFromPalette(page, 'TextInput');
  await frame.row.press('Enter');
  await kindPicker.selectOption('Image');
  await expect(page.locator('#visual-add')).toBeDisabled();
  await page.locator('#visual-palette').getByRole('combobox', { name: 'Ассет', exact: true }).selectOption(assetId);
  const image = await addFromPalette(page, 'Image');
  expect(image.body.properties).toEqual({ asset: { type: 'asset', assetId } });
  await expect(page.locator('#visual-inspector').getByRole('combobox', { name: 'Ассет', exact: true })).toHaveValue(assetId);
  const nodes = await readNodes(request, base, screenId);
  expect(nodes.map(node => [node.id, node.kind, node.parentId])).toEqual([
    [frame.nodeId, 'Frame', screenId], [text.nodeId, 'Text', frame.nodeId],
    [button.nodeId, 'Button', frame.nodeId], [input.nodeId, 'TextInput', frame.nodeId], [image.nodeId, 'Image', frame.nodeId]
  ]);
  await expect(page.locator(`[data-visual-node="${image.nodeId}"] img`)).toBeVisible();
});

test('inspector validates typing, retains rejected changes and atomically saves numbers, text and colors', async ({ page, request }) => {
  const { documentId, screenId, nodeId, tokenId, base } = await seedText(request);
  await page.goto(`/documents/${documentId}`);
  await login(page);
  await page.locator('#screens button').first().click();
  await page.locator(`[role=treeitem][data-id="${nodeId}"]`).press('Enter');
  const panel = page.locator('#visual-inspector');
  const width = panel.getByLabel('Ширина', { exact: true });
  const text = panel.getByLabel('Текст', { exact: true });
  const tokenLink = () => panel.getByRole('button', { name: /Привязать токен|Изменить привязку токена/ });
  const save = panel.getByRole('button', { name: 'Сохранить свойства', exact: true });
  await expect(width).toHaveValue('160');
  await expect(panel.getByLabel('Семейство шрифта', { exact: true })).toBeVisible();
  await expect(panel.getByLabel('Цвет фона', { exact: true })).toHaveCount(0);
  const bodies = [];
  let reject = true;
  await page.route(`**${base}/commands/set-node-properties`, route => {
    bodies.push(route.request().postDataJSON());
    if (!reject) return route.continue();
    reject = false;
    return route.fulfill({ status: 400, json: { code: 'INVALID_PROPERTY_VALUE', property: 'width', detail: 'Тестовый отказ сервера' } });
  });
  await width.fill('-1');
  await expect(width).toHaveAttribute('aria-invalid', 'true');
  await save.click();
  await expect(width).toBeFocused();
  expect(bodies).toHaveLength(0);
  await width.fill('224.5');
  await panel.getByLabel('X', { exact: true }).fill('24');
  await text.fill('Первая строка\nВторая строка');
  await panel.getByRole('combobox', { name: 'Толщина шрифта' }).selectOption('Bold');
  await panel.getByRole('checkbox', { name: 'Перенос строк' }).uncheck();
  await tokenLink().click();
  await panel.getByRole('dialog', { name: 'Цвет текста — дизайн-токены' }).getByRole('button', { name: /Ink/ }).click();
  await save.click();
  await expect(panel.getByRole('alert')).toHaveText('Ширина · Тестовый отказ сервера');
  await expect(width).toHaveValue('224.5');
  await expect(text).toHaveValue('Первая строка\nВторая строка');
  await expect(panel.locator('.node-property--token .token-value-name')).toHaveText('Ink');
  expect((await readNodes(request, base, screenId))[0].properties).toEqual({});
  await save.click();
  await expect(panel.getByRole('status')).toHaveText('Свойства сохранены.');
  const expected = {
    width: number(224.5), x: number(24), text: { type: 'string', value: 'Первая строка\nВторая строка' },
    textColor: { type: 'token', tokenId }, fontWeight: { type: 'enum', value: 'Bold' },
    wrap: { type: 'boolean', value: false }
  };
  expect(bodies[1]).toMatchObject({ nodeId, expectedParentId: screenId, properties: expected });
  expect((await readNodes(request, base, screenId))[0].properties).toEqual(expected);
  await tokenLink().click();
  await panel.getByRole('dialog', { name: 'Цвет текста — дизайн-токены' })
    .getByRole('button', { name: 'Отвязать токен' }).click();
  await panel.getByLabel('Цвет текста', { exact: true }).fill('#336699');
  await panel.getByRole('button', { name: 'Изменить Alpha' }).click();
  await panel.getByLabel('Цвет текста — альфа', { exact: true }).fill('128');
  await save.click();
  await expect(panel.getByRole('status')).toHaveText('Свойства сохранены.');
  expect((await readNodes(request, base, screenId))[0].properties.textColor).toEqual(color(51, 102, 153, 128));
  await expect(page.locator(`[data-visual-node="${nodeId}"] .visual-surface`)).toHaveCSS('color', 'rgba(51, 102, 153, 0.5)');
});

test('inspector displays geometry in two compact rows without rounding stored values', async ({ page, request }) => {
  const { documentId, screenId, nodeId, base } = await seedText(request);
  const geometry = { x: 60.625, y: 61.943999999999974, width: 336.60699999999997, height: 91.35400000000001 };
  await post(request, `${base}/commands/set-node-properties`, {
    commandId: randomUUID(), nodeId,
    properties: Object.fromEntries(Object.entries(geometry).map(([name, value]) => [name, number(value)]))
  });
  await page.goto(`/documents/${documentId}`);
  await login(page);
  await page.locator('#screens button').first().click();
  await page.locator(`[role=treeitem][data-id="${nodeId}"]`).press('Enter');
  const panel = page.locator('#visual-inspector');
  const rows = panel.locator('#visual-properties > .node-geometry-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('input')).toHaveCount(2);
  await expect(rows.nth(1).locator('input')).toHaveCount(2);
  await expect(rows.nth(0).locator('input').first()).toHaveAttribute('id', 'visual-property-x');
  await expect(rows.nth(0).locator('input').last()).toHaveAttribute('id', 'visual-property-y');
  await expect(rows.nth(1).locator('input').first()).toHaveAttribute('id', 'visual-property-width');
  await expect(rows.nth(1).locator('input').last()).toHaveAttribute('id', 'visual-property-height');
  const x = panel.getByLabel('X', { exact: true });
  await x.evaluate(input => { input.dataset.geometryInstance = 'retained'; });
  await rows.nth(0).evaluate(row => { row.dataset.geometryInstance = 'retained'; });
  await expect(x).toHaveValue('60.63');
  await expect(panel.getByLabel('Y', { exact: true })).toHaveValue('61.94');
  await expect(panel.getByLabel('Ширина', { exact: true })).toHaveValue('336.61');
  await expect(panel.getByLabel('Высота', { exact: true })).toHaveValue('91.35');
  const xLabel = panel.locator('label:has(#visual-property-x)');
  expect((await xLabel.boundingBox()).height).toBeLessThanOrEqual(35);
  const save = panel.getByRole('button', { name: 'Сохранить свойства', exact: true });
  await expect(save).toBeDisabled();
  expect((await readNodes(request, base, screenId))[0].properties.x.value).toBe(geometry.x);
  await x.fill('70.126');
  await x.press('Tab');
  await expect(x).toHaveValue('70.13');
  await save.click();
  await expect(panel.getByRole('status')).toHaveText('Свойства сохранены.');
  await expect(rows).toHaveCount(2);
  await expect(x).toHaveAttribute('data-geometry-instance', 'retained');
  await expect(rows.nth(0)).toHaveAttribute('data-geometry-instance', 'retained');
  const properties = (await readNodes(request, base, screenId))[0].properties;
  expect(properties.x).toEqual(number(70.13));
  expect(properties.y).toEqual(number(geometry.y));
  expect(properties.width).toEqual(number(geometry.width));
  expect(properties.height).toEqual(number(geometry.height));
});

test('retry after a lost acknowledgement reuses the identical atomic edit', async ({ page, request }) => {
  const { documentId, screenId, nodeId, base } = await seedText(request);
  await page.goto(`/documents/${documentId}`);
  await login(page);
  await page.locator('#screens button').first().click();
  await page.locator(`[role=treeitem][data-id="${nodeId}"]`).press('Enter');
  const panel = page.locator('#visual-inspector');
  const text = panel.getByLabel('Текст', { exact: true });
  const bodies = [], revisions = [];
  await page.route(`**${base}/commands/set-node-properties`, async route => {
    bodies.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBeTruthy();
    revisions.push((await response.json()).revision);
    if (bodies.length === 1) await route.abort();
    else await route.fulfill({ response });
  });
  await text.fill('Сохранить один раз');
  await panel.getByRole('button', { name: 'Сохранить свойства', exact: true }).click();
  const retry = panel.getByRole('button', { name: 'Повторить сохранение свойств', exact: true });
  await expect(retry).toBeVisible();
  await expect(text).toHaveValue('Сохранить один раз');
  await retry.click();
  await expect(panel.getByRole('status')).toHaveText('Свойства сохранены.');
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(revisions[1]).toBe(revisions[0]);
  expect((await readNodes(request, base, screenId))[0].properties.text).toEqual({ type: 'string', value: 'Сохранить один раз' });
});

test('Viewer sees profile properties with editing controls disabled and the palette hidden', async ({ page, request }) => {
  const { documentId, nodeId } = await seedText(request);
  await page.route('**/api/v1/documents?*', async route => {
    const response = await route.fetch(), json = await response.json();
    json.items = json.items.map(item => ({ ...item, role: 'Viewer' }));
    await route.fulfill({ response, json });
  });
  await page.goto(`/documents/${documentId}`);
  await login(page);
  await page.locator('#screens button').first().click();
  await page.locator(`[role=treeitem][data-id="${nodeId}"]`).press('Enter');
  await expect(page.locator('#visual-palette')).toBeHidden();
  const panel = page.locator('#visual-inspector');
  const text = panel.getByLabel('Текст', { exact: true });
  await expect(text).toHaveValue('Text');
  await expect(text).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Сохранить свойства', exact: true })).toBeHidden();
});

test('asset upload retries the same command after a lost acknowledgement', async ({ page, request }) => {
  const { documentId, base } = await seedText(request);
  await page.goto(`/documents/${documentId}`);
  await login(page);
  await page.locator('#screens button').first().click();
  const attempts = [];
  await page.route(`**${base}/assets/*`, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    attempts.push(route.request().url());
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBeTruthy();
    if (attempts.length === 1) await route.abort();
    else await route.fulfill({ response });
  });
  await show(page, 'assets'); await page.getByLabel('Изображение PNG').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Загрузить изображение', exact: true }).press('Enter');
  const retry = page.getByRole('button', { name: 'Повторить загрузку изображения', exact: true });
  await expect(retry).toBeVisible();
  await retry.press('Enter');
  await expect(page.locator('#asset-upload-status')).toContainText('Изображение загружено');
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toBe(attempts[0]);
  const assetId = new URL(attempts[0]).pathname.split('/').pop();
  await show(page, 'palette'); await show(page, 'palette'); await page.getByLabel('Вид элемента').selectOption('Image');
  await expect(page.locator('#visual-palette').getByRole('combobox', { name: 'Ассет', exact: true }).locator(`option[value="${assetId}"]`)).toHaveCount(1);
});

test('switching documents keeps an in-flight upload isolated', async ({ page, request }) => {
  const first = await seedText(request), second = await seedText(request);
  await page.goto(`/documents/${first.documentId}`);
  await login(page);
  await page.locator('#screens button').first().click();
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  let accepted;
  const received = new Promise(resolve => { accepted = resolve; });
  await page.route(`**${first.base}/assets/*`, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBeTruthy();
    accepted();
    await hold;
    await route.fulfill({ response });
  });
  await show(page, 'assets'); await page.getByLabel('Изображение PNG').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Загрузить изображение', exact: true }).press('Enter');
  await received;
  await page.evaluate(id => { history.pushState(null, '', `/documents/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, second.documentId);
  await show(page, 'layers');
  await page.locator('#screens button').first().click();
  await expect(page.getByLabel('Изображение PNG')).toHaveValue('');
  release();
  await expect(page.locator('#asset-upload-status')).toBeEmpty();
  await show(page, 'palette'); await show(page, 'palette'); await page.getByLabel('Вид элемента').selectOption('Image');
  await expect(page.locator('#visual-palette').getByRole('combobox', { name: 'Ассет', exact: true })).toContainText('В документе нет ассетов');
});


test('compact numeric control binds, switches and unlinks aliases without auto-saving', async ({ page, request }) => {
  const { documentId, screenId, base } = await seedText(request);
  const frameId = randomUUID(), spacingId = randomUUID(), aliasId = randomUUID(), alternateId = randomUUID();
  const command = (name, data) => post(request, base + '/commands/' + name, {
    commandId: randomUUID(), ...data
  });
  const spacing = value => ({ expression: 'literal', value: { type: 'spacing', value } });
  await command('add-node', { nodeId: frameId, parentId: screenId, kind: 'Frame' });
  await command('add-token', { tokenId: spacingId, name: 'space.base', type: 1,
    values: { Light: spacing(12), Dark: spacing(24) } });
  await command('add-token', { tokenId: aliasId, name: 'space.alias', type: 1,
    values: { Light: { expression: 'alias', tokenId: spacingId },
      Dark: { expression: 'alias', tokenId: spacingId } } });
  await command('add-token', { tokenId: alternateId, name: 'space.small', type: 1,
    values: { Light: spacing(4), Dark: spacing(6) } });
  await page.goto('/documents/' + documentId);
  await login(page);
  await page.locator('#screens button').first().click();
  await page.locator('[role=treeitem][data-id="' + frameId + '"]').press('Enter');

  const panel = page.locator('#visual-inspector');
  const row = panel.locator('.node-property--token').filter({
    has: page.locator('.token-value-label', { hasText: 'Промежуток' })
  });
  const save = panel.getByRole('button', { name: 'Сохранить свойства', exact: true });
  const direct = row.getByRole('spinbutton', { name: 'Промежуток' });
  await expect(row.getByText('Источник')).toHaveCount(0);
  await direct.fill('7.5');
  await save.click();
  await expect(panel.getByRole('status')).toHaveText('Свойства сохранены.');
  expect((await readNodes(request, base, screenId)).find(node => node.id === frameId).properties.gap)
    .toEqual(number(7.5));

  await row.getByRole('button', { name: 'Привязать токен' }).click();
  const menu = row.getByRole('dialog', { name: 'Промежуток — дизайн-токены' });
  await menu.getByRole('searchbox', { name: 'Поиск токена' }).fill('space.alias');
  await menu.getByRole('button', { name: /space.alias/ }).click();
  await expect(row.locator('.token-value-name')).toHaveText('space.alias');
  await expect(row.locator('.token-value-resolved')).toContainText('12 px · Light');
  await expect(row.getByRole('button', { name: 'Изменить привязку токена' }))
    .toHaveAttribute('aria-pressed', 'true');
  // A selection only changes the local draft.
  expect((await readNodes(request, base, screenId)).find(node => node.id === frameId).properties.gap)
    .toEqual(number(7.5));
  await save.click();
  await expect(panel.getByRole('status')).toHaveText('Свойства сохранены.');
  expect((await readNodes(request, base, screenId)).find(node => node.id === frameId).properties.gap)
    .toEqual({ type: 'token', tokenId: aliasId });

  await row.getByRole('button', { name: 'Изменить привязку токена' }).click();
  await menu.getByRole('button', { name: /space.small/ }).click();
  await save.click();
  await expect(panel.getByRole('status')).toHaveText('Свойства сохранены.');
  expect((await readNodes(request, base, screenId)).find(node => node.id === frameId).properties.gap)
    .toEqual({ type: 'token', tokenId: alternateId });

  await row.getByRole('button', { name: 'Изменить привязку токена' }).click();
  await menu.getByRole('button', { name: 'Отвязать токен' }).click();
  await expect(direct).toHaveValue('4');
  await save.click();
  await expect(panel.getByRole('status')).toHaveText('Свойства сохранены.');
  expect((await readNodes(request, base, screenId)).find(node => node.id === frameId).properties.gap)
    .toEqual(number(4));
});

test('token resolver detects missing, cyclic, incompatible and theme-specific values', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { resolveTokenValue } = await import('/token-resolution.js');
    const tokens = new Map([
      ['a', { id: 'a', type: 'Spacing', values: {
        Light: { expression: 'alias', tokenId: 'b' },
        Dark: { expression: 'literal', value: { type: 'spacing', value: 25 } }
      } }],
      ['b', { id: 'b', type: 'Spacing', values: {
        Light: { expression: 'literal', value: { type: 'spacing', value: 12 } }
      } }],
      ['loop', { id: 'loop', type: 'Spacing', values: {
        Light: { expression: 'alias', tokenId: 'loop' }
      } }],
      ['wrong', { id: 'wrong', type: 'Color', values: {
        Light: { expression: 'literal', value: { type: 'color', red: 1, green: 2, blue: 3, alpha: 255 } }
      } }]
    ]);
    const resolve = (id, theme = 'Light', expected = 'Spacing') =>
      resolveTokenValue({ type: 'token', tokenId: id }, tokens, theme, expected);
    return {
      alias: resolve('a').value,
      dark: resolve('a', 'Dark').value,
      missing: resolve('deleted').error,
      cyclic: resolve('loop').error,
      incompatible: resolve('wrong').error,
      incomplete: resolve('b', 'Dark').error
    };
  });
  expect(result.alias).toEqual({ type: 'spacing', value: 12 });
  expect(result.dark).toEqual({ type: 'spacing', value: 25 });
  expect(result.missing).toContain('отсутствует');
  expect(result.cyclic).toContain('Цикл');
  expect(result.incompatible).toContain('Несовместимый');
  expect(result.incomplete).toContain('Dark');
});

test('token popover supports keyboard search, Escape and preserves a read-only inspector', async ({ page, request }) => {
  const { documentId, nodeId, tokenId, base } = await seedText(request);
  await post(request, base + '/commands/set-node-properties', {
    commandId: randomUUID(), nodeId,
    properties: { textColor: { type: 'token', tokenId } }
  });
  await page.route('**/api/v1/documents?*', async route => {
    const response = await route.fetch(), json = await response.json();
    json.items = json.items.map(item => ({ ...item, role: 'Viewer' }));
    await route.fulfill({ response, json });
  });
  await page.goto('/documents/' + documentId);
  await login(page);
  await page.locator('#screens button').first().click();
  await page.locator('[role=treeitem][data-id="' + nodeId + '"]').press('Enter');
  const row = page.locator('#visual-inspector .node-property--token').filter({
    has: page.locator('.token-value-label', { hasText: 'Цвет текста' })
  });
  const link = row.getByRole('button', { name: 'Просмотреть дизайн-токен' });
  await expect(link).toBeEnabled();
  await expect(row.locator('.token-value-name')).toHaveText('Ink');
  await link.focus();
  await link.press('Enter');
  const menu = row.getByRole('dialog', { name: 'Цвет текста — дизайн-токены' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: /Ink/ })).toBeDisabled();
  await expect(menu.getByRole('button', { name: 'Отвязать токен' })).toBeHidden();
  await menu.getByRole('searchbox').press('Escape');
  await expect(menu).toBeHidden();
  await expect(link).toBeFocused();
  await expect(page.locator('#visual-save')).toBeHidden();
});


test('an unresolvable token never silently becomes a default literal on unlink', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createPropertyControl } = await import('/node-property-controls.js');
    const definition = {
      type: 'Number', tokenType: 'Spacing',
      defaultValue: { type: 'number', value: 99 }, minimum: 0, maximum: 100
    };
    const field = createPropertyControl('gap', definition, {
      tokens: new Map(), assets: new Map()
    }, { type: 'token', tokenId: 'deleted' }, 'test');
    document.body.append(field.row);
    const errorBefore = field.validate().error;
    const link = field.row.querySelector('.token-value-link');
    link.click();
    field.row.querySelector('.token-value-unlink').click();
    const after = field.validate();
    const input = field.row.querySelector('input[type=number]');
    const result = {
      errorBefore, errorAfter: after.error, valueAfter: input.value,
      modeAfter: field.read()[0]
    };
    field.row.remove();
    return result;
  });
  expect(result.errorBefore).toContain('отсутствует');
  expect(result.errorAfter).toContain('Введите число');
  expect(result.modeAfter).toBe('number');
  expect(result.valueAfter).toBe('');
});


test('the creation palette accepts an optional token reference without saving unrelated defaults', async ({ page, request }) => {
  const { documentId, screenId, tokenId, base } = await seedText(request);
  await page.goto('/documents/' + documentId);
  await login(page);
  await page.locator('#screens button').first().click();
  await show(page, 'palette');
  const palette = page.locator('#visual-palette');
  await palette.getByLabel('Вид элемента').selectOption('Button');
  const details = palette.locator('#visual-optional-details');
  await expect(details).toBeVisible();
  await details.locator('summary').click();
  const row = palette.locator('#visual-optional-properties .node-property--token').filter({
    has: palette.locator('.token-value-label', { hasText: 'Цвет фона' })
  });
  await row.getByRole('button', { name: 'Привязать токен' }).click();
  await row.getByRole('dialog', { name: 'Цвет фона — дизайн-токены' })
    .getByRole('button', { name: /Ink/ }).click();
  await expect(row.locator('.token-value-name')).toHaveText('Ink');
  const responsePromise = page.waitForResponse(response =>
    response.url().endsWith('/commands/add-node') && response.request().method() === 'POST');
  await palette.locator('#visual-add').click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = response.request().postDataJSON();
  expect(body.properties).toEqual({ backgroundColor: { type: 'token', tokenId } });
  const { nodeId } = await response.json();
  await expect.poll(async () =>
    (await readNodes(request, base, screenId)).find(node => node.id === nodeId)?.properties.backgroundColor
  ).toEqual({ type: 'token', tokenId });
});
