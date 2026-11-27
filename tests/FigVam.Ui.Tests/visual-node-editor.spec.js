const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');
const { exposeFrontendModules } = require('./frontend-modules');
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

test('inspector applies valid properties automatically, rejects invalid values and retries a rejected edit', async ({ page, request }) => {
  const { documentId, screenId, nodeId, tokenId, base } = await seedText(request);
  await page.goto(`/documents/${documentId}`);
  await login(page);
  await page.locator('#screens button.screen-select').first().click();
  await page.locator(`[role=treeitem][data-id="${nodeId}"]`).press('Enter');
  const panel = page.locator('#visual-inspector');
  const width = panel.getByLabel('Ширина', { exact: true });
  const text = panel.getByLabel('Текст', { exact: true });
  const saved = () => expect(panel.getByRole('status')).toHaveText('Свойства сохранены.');
  const properties = async () => (await readNodes(request, base, screenId))[0].properties;
  const tokenLink = () => panel.locator('.node-property--token').filter({ hasText: 'Цвет текста' })
    .getByRole('button', { name: /Привязать токен|Изменить привязку токена/ });
  await expect(panel.getByRole('button', { name: 'Сохранить свойства', exact: true })).toHaveCount(0);
  await expect(width).toHaveValue('160');
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
  await width.press('Enter');
  expect(bodies).toHaveLength(0);
  await width.fill('224.5');
  await width.press('Enter');
  await expect(panel.getByRole('alert')).toHaveText('Ширина · Тестовый отказ сервера');
  await expect(width).toHaveValue('224.5');
  expect(await properties()).toEqual({});
  await panel.getByRole('button', { name: 'Повторить сохранение свойств', exact: true }).click();
  await saved();
  expect(await properties()).toMatchObject({ width: number(224.5) });
  const acceptedCount = bodies.length;
  await width.fill('224.5');
  await width.press('Tab');
  await saved();
  expect(bodies).toHaveLength(acceptedCount);
  await panel.getByLabel('X', { exact: true }).fill('24');
  await panel.getByLabel('X', { exact: true }).press('Enter');
  await saved();
  await text.fill('Первая строка\nВторая строка');
  await saved();
  await panel.getByRole('combobox', { name: 'Толщина шрифта' }).selectOption('Bold');
  await saved();
  await panel.getByRole('checkbox', { name: 'Перенос строк' }).uncheck();
  await saved();
  await tokenLink().click();
  await panel.getByRole('dialog', { name: 'Цвет текста — дизайн-токены' }).getByRole('button', { name: /Ink/ }).click();
  await saved();
  expect(await properties()).toEqual({
    width: number(224.5), x: number(24), text: { type: 'string', value: 'Первая строка\nВторая строка' },
    textColor: { type: 'token', tokenId }, fontWeight: { type: 'enum', value: 'Bold' },
    wrap: { type: 'boolean', value: false }
  });
  expect(bodies.find(body => body.properties.x)).toMatchObject({ nodeId, expectedParentId: screenId });
  await tokenLink().click();
  await panel.getByRole('dialog', { name: 'Цвет текста — дизайн-токены' })
    .getByRole('button', { name: 'Отвязать токен' }).click();
  await saved();
  await panel.getByLabel('Цвет текста', { exact: true }).fill('#336699');
  await panel.getByRole('button', { name: 'Изменить Alpha' }).click();
  await panel.getByLabel('Цвет текста — альфа', { exact: true }).fill('128');
  await saved();
  expect((await properties()).textColor).toEqual(color(51, 102, 153, 128));
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
  await page.locator('#screens button.screen-select').first().click();
  await page.locator(`[role=treeitem][data-id="${nodeId}"]`).press('Enter');
  const panel = page.locator('#visual-inspector');
  const rows = panel.locator('#visual-properties > .node-geometry-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('input')).toHaveCount(2);
  await expect(rows.nth(1).locator('input[type="number"]')).toHaveCount(2);
  await expect(rows.nth(0).locator('input').first()).toHaveAttribute('id', 'visual-property-x');
  await expect(rows.nth(0).locator('input').last()).toHaveAttribute('id', 'visual-property-y');
  await expect(rows.nth(1).locator('input[type="number"]').first()).toHaveAttribute('id', 'visual-property-width');
  await expect(rows.nth(1).locator('input[type="number"]').last()).toHaveAttribute('id', 'visual-property-height');
  const x = panel.getByLabel('X', { exact: true });
  await x.evaluate(input => { input.dataset.geometryInstance = 'retained'; });
  await rows.nth(0).evaluate(row => { row.dataset.geometryInstance = 'retained'; });
  await expect(x).toHaveValue('60.63');
  await expect(panel.getByLabel('Y', { exact: true })).toHaveValue('61.94');
  await expect(panel.getByLabel('Ширина', { exact: true })).toHaveValue('336.61');
  await expect(panel.getByLabel('Высота', { exact: true })).toHaveValue('91.35');
  const dimensions = rows.nth(1);
  await expect(dimensions.locator('.token-value-label')).toHaveText(['W', 'H']);
  // Check actual layout at both desktop sidebar widths, not just DOM presence.
  for (const viewportWidth of [1280, 1150]) {
    await page.setViewportSize({ width: viewportWidth, height: 720 });
    for (const name of ['width', 'height']) {
      const input = panel.locator('#visual-property-' + name);
      const field = input.locator('xpath=ancestor::div[contains(@class,"node-property--geometry")]');
      const link = field.locator('.token-value-link');
      await expect(input).toBeVisible();
      await expect(link).toBeVisible();
      const bounds = await field.evaluate(row => {
        const rect = element => element.getBoundingClientRect().toJSON();
        const input = row.querySelector('input[type=number]');
        return { field: rect(row), label: rect(row.querySelector('.token-value-label')),
          input: rect(input), link: rect(row.querySelector('.token-value-link')) };
      });
      expect(bounds.input.width).toBeGreaterThanOrEqual(55);
      expect(bounds.input.left).toBeGreaterThanOrEqual(bounds.label.right - 1);
      expect(bounds.input.right).toBeLessThanOrEqual(bounds.link.left + 1);
      expect(bounds.link.right).toBeLessThanOrEqual(bounds.field.right + 1);
      await input.click();
      await expect(input).toBeFocused();
      await link.click();
      await expect(field.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(field.getByRole('dialog')).toBeHidden();
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  const xLabel = panel.locator('label:has(#visual-property-x)');
  expect((await xLabel.boundingBox()).height).toBeLessThanOrEqual(35);
  expect((await readNodes(request, base, screenId))[0].properties.x.value).toBe(geometry.x);
  await x.fill('70.126');
  await x.press('Tab');
  await expect(x).toHaveValue('70.13');
  await expect(panel.getByRole('status')).toHaveText('Свойства сохранены.');
  await expect(rows).toHaveCount(2);
  await expect(x).toHaveAttribute('data-geometry-instance', 'retained');
  await expect(rows.nth(0)).toHaveAttribute('data-geometry-instance', 'retained');
  const properties = (await readNodes(request, base, screenId))[0].properties;
  expect(properties.x).toEqual(number(70.13));
  expect(properties.y).toEqual(number(geometry.y));
  expect(properties.width).toEqual(number(geometry.width));
  expect(properties.height).toEqual(number(geometry.height));
  await panel.getByLabel('Ширина', { exact: true }).fill('240.5');
  await panel.getByLabel('Ширина', { exact: true }).press('Enter');
  await expect.poll(async () => (await readNodes(request, base, screenId))[0].properties.width).toEqual(number(240.5));
  await panel.getByLabel('Высота', { exact: true }).fill('105.25');
  await panel.getByLabel('Высота', { exact: true }).press('Enter');
  await expect.poll(async () => (await readNodes(request, base, screenId))[0].properties.height).toEqual(number(105.25));
});

test('retry after a lost acknowledgement reuses the identical atomic edit', async ({ page, request }) => {
  const { documentId, screenId, nodeId, base } = await seedText(request);
  await page.goto(`/documents/${documentId}`);
  await login(page);
  await page.locator('#screens button.screen-select').first().click();
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
  await page.locator('#screens button.screen-select').first().click();
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
  await page.locator('#screens button.screen-select').first().click();
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
  await page.locator('#screens button.screen-select').first().click();
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
  await page.locator('#screens button.screen-select').first().click();
  await expect(page.getByLabel('Изображение PNG')).toHaveValue('');
  release();
  await expect(page.locator('#asset-upload-status')).toBeEmpty();
  await show(page, 'palette'); await show(page, 'palette'); await page.getByLabel('Вид элемента').selectOption('Image');
  await expect(page.locator('#visual-palette').getByRole('combobox', { name: 'Ассет', exact: true })).toContainText('В документе нет ассетов');
});


test('compact numeric control binds, switches and unlinks aliases with automatic application', async ({ page, request }) => {
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
  await page.locator('#screens button.screen-select').first().click();
  await page.locator('[role=treeitem][data-id="' + frameId + '"]').press('Enter');

  const panel = page.locator('#visual-inspector');
  const row = panel.locator('.node-property--token').filter({
    has: page.locator('.token-value-label', { hasText: 'Между элементами' })
  });
  const direct = row.getByRole('spinbutton', { name: 'Между элементами' });
  await expect(row.getByText('Источник')).toHaveCount(0);
  await direct.fill('7.5');
  await expect(panel.getByRole('status')).toHaveText('Свойства сохранены.');
  expect((await readNodes(request, base, screenId)).find(node => node.id === frameId).properties.gap)
    .toEqual(number(7.5));

  await row.getByRole('button', { name: 'Привязать токен' }).click();
  const menu = row.getByRole('dialog', { name: 'Между элементами — дизайн-токены' });
  await menu.getByRole('searchbox', { name: 'Поиск токена' }).fill('space.alias');
  await menu.getByRole('button', { name: /space.alias/ }).click();
  await expect(row.locator('.token-value-name')).toHaveText('space.alias');
  await expect(row.locator('.token-value-resolved')).toContainText('12 px · Light');
  await expect(row.getByRole('button', { name: 'Изменить привязку токена' }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('status')).toHaveText('Свойства сохранены.');
  expect((await readNodes(request, base, screenId)).find(node => node.id === frameId).properties.gap)
    .toEqual({ type: 'token', tokenId: aliasId });

  await row.getByRole('button', { name: 'Изменить привязку токена' }).click();
  await menu.getByRole('button', { name: /space.small/ }).click();
  await expect(panel.getByRole('status')).toHaveText('Свойства сохранены.');
  expect((await readNodes(request, base, screenId)).find(node => node.id === frameId).properties.gap)
    .toEqual({ type: 'token', tokenId: alternateId });

  await row.getByRole('button', { name: 'Изменить привязку токена' }).click();
  await menu.getByRole('button', { name: 'Отвязать токен' }).click();
  await expect(direct).toHaveValue('4');
  await expect(panel.getByRole('status')).toHaveText('Свойства сохранены.');
  expect((await readNodes(request, base, screenId)).find(node => node.id === frameId).properties.gap)
    .toEqual(number(4));
});

test('token resolver detects missing, cyclic, incompatible and theme-specific values', async ({ page }) => {
  await page.goto('/');
  await exposeFrontendModules(page, 'token-resolution');
  const result = await page.evaluate(async () => {
    const { resolveTokenValue } = await import('/__figvam-test/token-resolution.js');
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
  await page.locator('#screens button.screen-select').first().click();
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
  await exposeFrontendModules(page, 'property-controls');
  const result = await page.evaluate(async () => {
    const { createTestField, mountFields, commit } = await import('/__figvam-test/property-controls.js');
    const definition = {
      type: 'Number', tokenType: 'Spacing',
      defaultValue: { type: 'number', value: 99 }, minimum: 0, maximum: 100
    };
    const field = createTestField('gap', definition, {
      tokens: new Map(), assets: new Map()
    }, { type: 'token', tokenId: 'deleted' }, 'test');
    const mounted = mountFields([field]);
    const errorBefore = field.validate().error;
    const link = mounted.host.querySelector('.token-value-link');
    commit(() => link.click());
    commit(() => mounted.host.querySelector('.token-value-unlink').click());
    const after = field.validate();
    const input = mounted.host.querySelector('input[type=number]');
    const result = {
      errorBefore, errorAfter: after.error, valueAfter: input.value,
      modeAfter: field.read()[0]
    };
    mounted.dispose();
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
  await page.locator('#screens button.screen-select').first().click();
  await show(page, 'palette');
  const palette = page.locator('#visual-palette');
  await palette.getByLabel('Вид элемента').selectOption('Button');
  const details = palette.locator('#visual-optional-details');
  await expect(details).toBeVisible();
  await details.locator('summary').click();
  const row = palette.locator('#visual-optional-properties .node-property--token').filter({
    has: page.locator('.token-value-label', { hasText: 'Цвет фона' })
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

test('letter spacing exposes a local style override reset and restores inherited value', async ({ page, request }) => {
  const { documentId, screenId, nodeId, base } = await seedText(request);
  const typographyId = randomUUID(), styleId = randomUUID();
  const typography = { expression: 'literal', value: {
    type: 'typography', fontFamily: 'Arial', fontSize: 16, fontWeight: 400,
    lineHeight: 1.25, letterSpacing: 2
  } };
  await post(request, base + '/commands/add-token', {
    commandId: randomUUID(), tokenId: typographyId, name: 'Body typography', type: 2,
    values: { Light: typography, Dark: typography }
  });
  await post(request, base + '/commands/upsert-style', {
    commandId: randomUUID(), expectedRevision: 5,
    style: { id: styleId, name: 'Text base', type: 0,
      fields: { typography: { type: 'token', tokenId: typographyId } } }
  });
  await post(request, base + '/commands/set-node-properties', {
    commandId: randomUUID(), nodeId, properties: {
      textStyle: { type: 'style', styleId }, letterSpacing: number(5)
    }
  });
  await page.goto('/documents/' + documentId);
  await login(page);
  await page.locator('#screens button.screen-select').first().click();
  await page.locator('[role=treeitem][data-id="' + nodeId + '"]').press('Enter');
  const inspector = page.locator('#visual-inspector');
  const reset = inspector.getByRole('button', { name: 'Сбросить к стилю: Межбуквенный интервал' });
  await expect(reset).toBeVisible();
  await expect(inspector.locator('.node-property').filter({
    has: page.getByRole('button', { name: 'Сбросить к стилю: Межбуквенный интервал' })
  })).toHaveAttribute('data-style-override', 'true');
  const removed = page.waitForResponse(response => response.url().endsWith('/commands/remove-node-properties') &&
    response.request().method() === 'POST');
  await reset.click();
  const response = await removed;
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect.poll(async () => (await readNodes(request, base, screenId))[0].properties)
    .toEqual({ textStyle: { type: 'style', styleId } });
  await expect(reset).toBeHidden();
  await expect(page.locator('[data-visual-node="' + nodeId + '"] .visual-surface'))
    .toHaveCSS('letter-spacing', '2px');
});


test('Effects is optional, edits one typed shadow, resets variants and removes without losing other drafts', async ({ page, request }) => {
  const { documentId, screenId, nodeId, base } = await seedText(request);
  const frameId = randomUUID(), variantId = randomUUID();
  await post(request, base + '/commands/add-node', { commandId: randomUUID(), nodeId: frameId, parentId: screenId, kind: 'Frame' });
  await post(request, base + '/commands/add-screen-variant', { commandId: randomUUID(), screenId, variantId, name: 'Alternate' });
  await page.goto('/documents/' + documentId);
  await login(page);
  await page.locator('#screens button.screen-select').first().click();
  await show(page, 'design');
  const panel = page.locator('#visual-inspector');
  const effects = panel.locator('.shadow-effects');
  const select = id => page.locator('[role=treeitem][data-id="' + id + '"]').press('Enter');
  await select(nodeId);
  await expect(effects).toHaveCount(0);
  await select(frameId);
  await expect(effects).toBeVisible();
  const add = effects.getByRole('button', { name: 'Add drop shadow', exact: true });
  const remove = effects.getByRole('button', { name: 'Remove drop shadow', exact: true });
  const field = label => effects.getByLabel('Drop shadow ' + label, { exact: true });
  const saved = () => expect(panel.getByRole('status')).toHaveText('Свойства сохранены.');
  const properties = async () => (await readNodes(request, base, screenId)).find(node => node.id === frameId).properties;
  const typedShadow = { type: 'shadow', offsetX: -4, offsetY: 12, blurRadius: 24, spreadRadius: -3,
    color: { red: 17, green: 34, blue: 51, alpha: 100 } };
  await add.click();
  for (const [label, value] of [['X', '0'], ['Y', '4'], ['Blur', '8'], ['Spread', '0']])
    await expect(field(label)).toHaveValue(value);
  await expect(effects.getByLabel('Drop shadow', { exact: true })).toHaveValue('#000000');
  await effects.getByRole('button', { name: 'Изменить Alpha' }).click();
  await expect(effects.getByLabel('Drop shadow — альфа', { exact: true })).toHaveValue('38');
  await saved();
  expect((await properties()).shadow).toBeDefined();
  await field('Blur').fill('-1');
  await expect(field('Blur')).toHaveAttribute('aria-invalid', 'true');
  for (const [label, value] of [['X', -4], ['Y', 12], ['Blur', 24], ['Spread', -3]])
    await field(label).fill(String(value));
  await effects.getByLabel('Drop shadow', { exact: true }).fill('#112233');
  await effects.getByLabel('Drop shadow — альфа', { exact: true }).fill('100');
  await saved();
  expect((await properties()).shadow).toEqual(typedShadow);
  await select(nodeId);
  await select(frameId);
  await expect(field('Blur')).toHaveValue('24');

  await show(page, 'assets');
  await page.locator('#screen-variants-list [data-variant-id="' + variantId + '"]').click();
  await show(page, 'design');
  await expect(field('Blur')).toHaveValue('24');
  await field('Blur').fill('48');
  await saved();
  await expect(effects.getByRole('button', { name: 'Reset Override' })).toBeVisible();
  expect((await properties()).shadow).toEqual(typedShadow);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('#preview-viewport [data-visual-node="' + frameId + '"]'))
    .toHaveCSS('box-shadow', /-4px 12px 48px -3px/);
  await page.getByRole('button', { name: 'Вернуться в Design' }).click();
  await show(page, 'design');
  await effects.getByRole('button', { name: 'Reset Override' }).click();
  await expect(field('Blur')).toHaveValue('24');
  await show(page, 'assets');
  await page.locator('#screen-variants-list [data-variant-id=""]').click();
  await show(page, 'design');
  const width = panel.getByLabel('Ширина', { exact: true });
  await width.fill('321');
  await saved();
  await remove.click();
  await expect(add).toBeVisible();
  await expect(width).toHaveValue('321');
  await expect.poll(async () => (await properties()).shadow).toBeUndefined();
  await saved();
  expect((await properties()).width).toEqual(number(321));
});

test('Viewer can inspect saved shadow but cannot add, edit or remove it', async ({ page, request }) => {
  const { documentId, screenId, base } = await seedText(request);
  const frameId = randomUUID();
  await post(request, base + '/commands/add-node', { commandId: randomUUID(), nodeId: frameId, parentId: screenId, kind: 'Frame',
    properties: { shadow: { type: 'shadow', offsetX: 0, offsetY: 4, blurRadius: 8, spreadRadius: 0,
      color: { red: 0, green: 0, blue: 0, alpha: 38 } } } });
  await page.route('**/api/v1/documents?*', async route => {
    const response = await route.fetch(), json = await response.json();
    json.items = json.items.map(item => ({ ...item, role: 'Viewer' }));
    await route.fulfill({ response, json });
  });
  await page.goto('/documents/' + documentId);
  await login(page);
  await page.locator('#screens button.screen-select').first().click();
  await page.locator('[role=treeitem][data-id="' + frameId + '"]').press('Enter');
  const effects = page.locator('#visual-inspector .shadow-effects');
  await expect(effects.getByLabel('Drop shadow Blur', { exact: true })).toHaveValue('8');
  await expect(effects.getByLabel('Drop shadow Blur', { exact: true })).toBeDisabled();
  await expect(effects.getByRole('button', { name: 'Remove drop shadow' })).toBeHidden();
});


test('padding editor retains individual controls, tokens, drafts, history and variant overrides', async ({ page, request }) => {
  test.setTimeout(90_000);
  const { documentId, screenId, nodeId, base } = await seedText(request);
  const frameId = randomUUID(), tokenId = randomUUID(), variantId = randomUUID();
  const command = (name, data) => post(request, base + '/commands/' + name, {
    commandId: randomUUID(), ...data
  });
  await command('add-node', { nodeId: frameId, parentId: screenId, kind: 'Frame' });
  const spacing = value => ({ expression: 'literal', value: { type: 'spacing', value } });
  const tokenName = 'spacing.extremely-long-name-for-a-narrow-inspector';
  await command('add-token', { tokenId, name: tokenName, type: 1,
    values: { Light: spacing(32), Dark: spacing(40) } });
  await command('add-screen-variant', { screenId, variantId, name: 'Alternate' });
  await page.goto('/documents/' + documentId);
  await login(page);
  await page.locator('#screens button.screen-select').first().click();
  await show(page, 'design');
  const select = id => page.locator('[role=treeitem][data-id="' + id + '"]').press('Enter');
  const panel = page.locator('#visual-inspector');
  const editor = panel.locator('.padding-editor');
  const gap = panel.locator('.padding-gap-row');
  const saved = () => expect(panel.getByRole('status')).toHaveText('Свойства сохранены.');
  const sides = [['top', 'Top', 24], ['right', 'Right', 32], ['bottom', 'Bottom', 16], ['left', 'Left', 32]];
  const input = side => panel.locator('#visual-property-padding' + side);
  const slot = side => editor.locator('.padding-editor-field[data-side="' + side + '"]');
  const properties = async () => (await readNodes(request, base, screenId)).find(node => node.id === frameId).properties;
  await select(nodeId);
  await expect(editor).toHaveCount(0);
  await select(frameId);
  await expect(editor).toHaveCount(1);
  await expect(gap).toBeVisible();
  for (const [side, name] of sides) {
    await expect(input(name)).toHaveCount(1);
    await expect(slot(side).locator('input[type=number]')).toHaveAttribute('id', 'visual-property-padding' + name);
    await expect(input(name)).toHaveValue('0');
    const target = editor.locator('.padding-editor-side[data-side="' + side + '"]');
    await input(name).hover();
    await expect(target).toHaveCSS('box-shadow', /inset/);
    await target.click();
    await expect(input(name)).toBeFocused();
    await expect(target).toHaveCSS('box-shadow', /inset/);
  }
  const bounds = await Promise.all(sides.map(([side]) => slot(side).boundingBox()));
  const [top, right, bottom, left] = bounds;
  expect(Math.abs(top.x - bottom.x)).toBeLessThan(1);
  expect(Math.abs(left.y - right.y)).toBeLessThan(1);
  expect(left.x).toBeLessThan(top.x);
  expect(right.x).toBeGreaterThan(top.x);
  expect(top.y).toBeLessThan(left.y);
  expect(bottom.y).toBeGreaterThan(left.y);
  await input('Top').fill('-1');
  await expect(input('Top')).toHaveAttribute('aria-invalid', 'true');
  await expect(input('Right')).not.toHaveAttribute('aria-invalid', 'true');
  for (const [, name, value] of sides) await input(name).fill(String(value));
  await gap.getByRole('spinbutton', { name: 'Между элементами' }).fill('12');
  await input('Top').focus();
  await input('Top').evaluate(el => el.dataset.instance = 'retained');
  // An unrelated remote property update must not replace a live padding draft.
  await command('set-node-properties', { nodeId: frameId, properties: { width: number(320) } });
  await expect(panel.getByLabel('Ширина', { exact: true })).toHaveValue('320');
  await expect(input('Top')).toBeFocused();
  await expect(input('Top')).toHaveAttribute('data-instance', 'retained');
  await expect(input('Top')).toHaveValue('24');
  await saved();
  for (const [, name, value] of sides)
    expect((await properties())['padding' + name]).toEqual(number(value));
  expect((await properties()).gap).toEqual(number(12));

  const rightSlot = slot('right');
  await rightSlot.getByRole('button', { name: 'Привязать токен' }).click();
  await rightSlot.getByRole('dialog').getByRole('button', { name: new RegExp(tokenName) }).click();
  await expect(rightSlot.locator('.token-value-name')).toHaveText(tokenName);
  await expect(rightSlot.locator('.token-value-reference')).toHaveAttribute('title', /32/);
  expect(await editor.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await saved();
  expect((await properties()).paddingRight).toEqual({ type: 'token', tokenId });
  await page.getByRole('button', { name: 'Отменить действие', exact: true }).click();
  await expect(input('Right')).toHaveValue('32');
  await page.getByRole('button', { name: 'Повторить действие', exact: true }).click();
  await expect(rightSlot.locator('.token-value-reference')).toBeVisible();
  await expect(rightSlot.locator('.token-value-name')).toHaveText(tokenName);
  await expect.poll(async () => (await properties()).paddingRight).toEqual({ type: 'token', tokenId });
  await editor.locator('.padding-editor-side[data-side=right]').click();
  await expect(rightSlot.getByRole('button', { name: 'Изменить привязку токена' })).toBeFocused();
  await rightSlot.getByRole('button', { name: 'Изменить привязку токена' }).click();
  await rightSlot.getByRole('button', { name: 'Отвязать токен' }).click();
  await expect(input('Right')).toHaveValue('32');
  await saved();

  await show(page, 'assets');
  await page.locator('#screen-variants-list [data-variant-id="' + variantId + '"]').click();
  await show(page, 'design');
  await input('Bottom').fill('20');
  await saved();
  await expect(slot('bottom').locator('.node-property')).toHaveAttribute('data-variant-override', 'true');
  expect((await properties()).paddingBottom).toEqual(number(16));
  await slot('bottom').getByRole('button', { name: 'Reset Override' }).click();
  await expect(input('Bottom')).toHaveValue('16');
  await show(page, 'assets');
  await page.locator('#screen-variants-list [data-variant-id=""]').click();
  await show(page, 'design');
  await select(nodeId);
  await select(frameId);
  for (const [, name, value] of sides) await expect(input(name)).toHaveValue(String(value));
  await expect(gap.getByRole('spinbutton')).toHaveValue('12');
  await panel.locator('#visual-property-layout').selectOption('Vertical');
  await saved();
  await expect(gap.locator('.padding-gap-icon')).toHaveCSS('flex-direction', 'column');
  await panel.locator('#visual-property-layout').selectOption('Horizontal');
  await expect(gap.locator('.padding-gap-icon')).toHaveCSS('flex-direction', 'row');
});

test('padding editor preserves missing token feedback and read-only controls', async ({ page }) => {
  await page.goto('/');
  await exposeFrontendModules(page, 'property-controls');
  const result = await page.evaluate(async () => {
    const { createTestField, mountPadding, paddingProperties, commit } = await import('/__figvam-test/property-controls.js');
    const definition = { type: 'Number', tokenType: 'Spacing', defaultValue: { type: 'number', value: 0 }, minimum: 0 };
    const model = { tokens: new Map(), assets: new Map() };
    const fields = new Map(paddingProperties.map(name => [name, createTestField(name, definition, model,
      name === 'paddingTop' ? { type: 'token', tokenId: 'missing' } : undefined, 'test-padding')]));
    const mounted = mountPadding(fields);
    commit(() => { for (const field of fields.values()) field.setDisabled(true); });
    const root = mounted.host;
    const result = { invalid: Boolean(fields.get('paddingTop').validate().error),
      invalidLink: root.querySelector('#test-padding-paddingTop-1').getAttribute('aria-invalid'),
      disabled: [...root.querySelectorAll('input[type=number]')].every(input => input.disabled),
      linkEnabled: !root.querySelector('#test-padding-paddingTop-1').disabled };
    mounted.dispose();
    return result;
  });
  expect(result).toEqual({ invalid: true, invalidLink: 'true', disabled: true, linkEnabled: true });
});

test('automatic inspector preserves a newer edit during a delayed acknowledgement and applies it to the original node', async ({ page, request }) => {
  const { documentId, screenId, nodeId, base } = await seedText(request);
  const other = randomUUID();
  await post(request, base + '/commands/add-node', { commandId: randomUUID(), nodeId: other, parentId: screenId, kind: 'Text' });
  await page.goto('/documents/' + documentId);
  await login(page);
  await page.locator('#screens button.screen-select').first().click();
  await page.locator('[role=treeitem][data-id="' + nodeId + '"]').press('Enter');
  const panel = page.locator('#visual-inspector');
  const field = panel.getByLabel('Текст', { exact: true });
  const bodies = [];
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const held = new Promise(resolve => { entered = resolve; });
  await page.route('**' + base + '/commands/set-node-properties', async route => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) {
      const response = await route.fetch(); entered(); await gate; await route.fulfill({ response });
    } else await route.continue();
  });
  try {
    await field.fill('First');
    await expect(page.locator('[data-visual-node="' + nodeId + '"] .visual-surface')).toHaveText('First');
    await held;
    await expect(field).toBeEditable();
    await field.fill('Second');
    await page.locator('[role=treeitem][data-id="' + other + '"]').press('Enter');
    release();
    await expect.poll(async () => (await readNodes(request, base, screenId)).find(node => node.id === nodeId).properties.text?.value).toBe('Second');
    expect(bodies.map(body => body.nodeId)).toEqual([nodeId, nodeId]);
    expect((await readNodes(request, base, screenId)).find(node => node.id === other).properties.text).toBeUndefined();
  } finally { release(); }
});


test('shadow token can be created, edited, bound, resolved by theme, persisted and detached in the UI', async ({ page, request }) => {
  test.setTimeout(90_000);
  const { documentId, screenId, base } = await seedText(request);
  const frameId = randomUUID();
  await post(request, base + '/commands/add-node', { commandId: randomUUID(), nodeId: frameId, parentId: screenId, kind: 'Frame' });
  await page.goto('/documents/' + documentId);
  await login(page);
  await show(page, 'tokens');
  await page.locator('#token-menu-open').click();
  await page.locator('#new-token-open').click();
  await page.locator('#new-token-name').fill('Elevation');
  await page.locator('#new-token-type').selectOption('Shadow');
  const field = (host, theme) => page.locator(host + ' [data-theme="' + theme + '"]').getByLabel('Drop shadow Blur', { exact: true });
  await field('#new-token-values', 'Light').fill('16');
  await field('#new-token-values', 'Dark').fill('32');
  await page.getByRole('button', { name: 'Создать токен' }).click();
  await expect(page.locator('#token-detail-title')).toHaveText('Elevation');
  await expect(field('#token-values', 'Light')).toHaveValue('16');
  await expect(field('#token-values', 'Dark')).toHaveValue('32');
  await field('#token-values', 'Light').fill('20');
  await field('#token-values', 'Light').press('Tab');
  await expect(page.locator('#tokens-list')).toContainText('20 px');
  await page.locator('#document-mode-editor').click();
  await show(page, 'design');
  await page.locator('#screens button.screen-select').first().click();
  await page.locator('[role=treeitem][data-id="' + frameId + '"]').press('Enter');
  const effects = page.locator('#visual-inspector .shadow-effects');
  await effects.getByRole('button', { name: 'Add drop shadow' }).click();
  await expect(page.locator('#visual-inspector').getByRole('status')).toHaveText('Свойства сохранены.');
  await expect(effects.getByRole('button', { name: 'Привязать токен' })).toBeVisible();
  await effects.getByRole('button', { name: 'Привязать токен' }).click();
  await effects.getByRole('button', { name: /Elevation/ }).click();
  await expect(effects.locator('.token-value-name')).toHaveText('Elevation');
  const node = () => page.locator('#screen-boundary [data-visual-node="' + frameId + '"]');
  await expect(node()).toHaveCSS('box-shadow', /0px 4px 20px 0px/);
  const properties = async () => (await readNodes(request, base, screenId)).find(n => n.id === frameId).properties;
  await expect.poll(async () => (await properties()).shadow?.type).toBe('token');
  const reference = (await properties()).shadow;
  await page.reload();
  await login(page);
  await page.locator('#screens button.screen-select').first().click();
  await show(page, 'design');
  await page.locator('[role=treeitem][data-id="' + frameId + '"]').press('Enter');
  await expect(effects.locator('.token-value-name')).toHaveText('Elevation');
  expect((await properties()).shadow).toEqual(reference);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.locator('#preview-theme button[data-theme=Dark]').click();
  await expect(page.locator('#preview-viewport [data-visual-node="' + frameId + '"]')).toHaveCSS('box-shadow', /0px 4px 32px 0px/);
  await page.getByRole('button', { name: 'Вернуться в Design' }).click();
  await show(page, 'design');
  await effects.getByRole('button', { name: 'Изменить привязку токена' }).click();
  await effects.getByRole('button', { name: 'Отвязать токен' }).click();
  await expect(effects.getByLabel('Drop shadow Blur', { exact: true })).toHaveValue('20');
  await expect.poll(async () => (await properties()).shadow?.type).toBe('shadow');
  expect((await properties()).shadow.blurRadius).toBe(20);
});
