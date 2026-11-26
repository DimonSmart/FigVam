const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');
const { randomUUID } = require('node:crypto');

const text = value => ({ type: 'string', value });
const number = value => ({ type: 'number', value });
const flag = value => ({ type: 'boolean', value });
const option = value => ({ type: 'enum', value });
const rgba = (red, green, blue, alpha = 255) => ({ type: 'color', red, green, blue, alpha });
const geometry = (x, y, width, height) => ({ x: number(x), y: number(y), width: number(width), height: number(height) });
const visual = id => `[data-visual-node="${id}"]`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DA8J8BAAf/Af8Bf4mnAAAAAElFTkSuQmCC', 'base64');
const plainText = '<strong>Обычный текст</strong>';

async function seed(request, minimal = false) {
  const documentId = randomUUID(), pageId = randomUUID(), screen = randomUUID(), other = randomUUID();
  const base = `/api/v1/documents/${documentId}`;
  const headers = { Authorization: `Bearer ${bearer}` };
  async function post(path, data) {
    const response = await request.post(path, { headers, data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
    return response.json();
  }
  const command = (name, data) => post(`${base}/commands/${name}`, { commandId: randomUUID(), ...data });
  async function node(parentId, kind, name, properties) {
    const nodeId = randomUUID();
    await command('add-node', { nodeId, parentId, kind, properties });
    if (name) await command('set-node-name', { nodeId, name });
    return nodeId;
  }
  async function read(path) {
    const response = await request.get(`${base}/${path}`, { headers });
    expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
    return response.json();
  }
  await post('/api/v1/documents', { documentId, name: 'Визуальные компоненты' });
  await command('add-page', { pageId });
  for (const screenId of [screen, other])
    await command('add-screen', { pageId, screenId, dimensions: { width: 500, height: 360 } });
  const assetId = randomUUID();
  const uploaded = await request.put(`${base}/assets/${assetId}?commandId=${randomUUID()}`, {
    headers: { ...headers, 'Content-Type': 'image/png' }, data: png
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const image = await node(screen, 'Image', null, { ...geometry(272, 26, 116, 64),
    asset: { type: 'asset', assetId }, fit: option('Contain'), altText: text('Полосы')
  });
  const otherLabel = await node(other, 'Text', null, { text: text('Другой экран') });
  if (minimal) {
    const label = await node(screen, 'Text', null, { text: text(plainText) });
    return { base, documentId, screen, other, label, otherLabel, assetId, image, command, read };
  }
  const tokenId = randomUUID(), aliasId = randomUUID();
  await command('add-token', { tokenId, name: 'Panel', type: 0, values: {
    Light: { expression: 'literal', value: rgba(211, 239, 224) },
    Dark: { expression: 'literal', value: rgba(18, 60, 72) }
  } });
  const alias = { expression: 'alias', tokenId };
  await command('add-token', { tokenId: aliasId, name: 'Card', type: 0, values: { Light: alias, Dark: alias } });
  const frame = await node(screen, 'Frame', null, {
    ...geometry(24, 24, 206, 174), overflow: option('Clip'), borderWidth: number(3), borderColor: rgba(20, 40, 70),
    cornerRadius: number(9), backgroundColor: { type: 'token', tokenId: aliasId }
  });
  const stack = await node(frame, 'Frame', null, {
    ...geometry(12, 10, 190, 120), paddingLeft: number(4), paddingTop: number(3),
    gap: number(8), layout: option('Vertical')
  });
  const label = await node(stack, 'Text', null, {
    ...geometry(0, 0, 228, 22), text: text(plainText), textColor: rgba(37, 63, 104), fontWeight: option('Bold')
  });
  const input = await node(stack, 'TextInput', 'Поле', { ...geometry(0, 0, 150, 28), value: text('Пример'), placeholder: text('Введите текст') });
  const button = await node(stack, 'Button', null, { ...geometry(0, 0, 116, 32), text: text('Применить') });
  const textarea = await node(frame, 'TextInput', 'Комментарий', { ...geometry(18, 130, 160, 30), multiline: flag(true), placeholder: text('Комментарий') });
  const hidden = await node(screen, 'Text', null, { ...geometry(0, 0, 50, 20), visible: flag(false) });
  const disabled = await node(screen, 'Button', null, { ...geometry(280, 110, 116, 36), enabled: flag(false), text: text('Недоступно') });
  const cover = await node(screen, 'Button', null, { ...geometry(330, 160, 116, 40), text: text('Дальше') });
  const variantId = randomUUID();
  const baseData = randomUUID(), selectedData = randomUUID();
  for (const [datasetId, title] of [[baseData, plainText], [selectedData, '<em>Другой датасет</em>']])
    await command('add-dataset', { datasetId, name: datasetId, fixtureJson: JSON.stringify({ title }) });
  await command('bind-node-data', { nodeId: label, property: 'text', binding: {
    datasetId: baseData, binding: { path: [{ type: 'property', name: 'title' }], operation: 0, expectedType: 1 }
  } });
  await command('add-screen-variant', { screenId: screen, variantId, name: 'Активный' });
  await command('set-screen-variant-override', { screenId: screen, variantId, nodeId: frame, property: 'width', value: number(210) });
  await command('create-scenario', { scenario: { id: randomUUID(), screenId: screen, nodeId: button, event: 0, actions: [
    { type: 'setDemoValue', nodeId: input, value: 'Значение сценария' }, { type: 'showVariant', variantId },
    { type: 'selectDataset', datasetId: selectedData }
  ] } });
  await command('create-scenario', { scenario: { id: randomUUID(), screenId: screen, nodeId: cover, event: 0, actions: [
    { type: 'navigate', screenId: other }
  ] } });
  return { documentId, base, screen, other, frame, stack, label, input, button, textarea, hidden, image, assetId,
    disabled, cover, otherLabel, variantId, command, read };
}

async function openScreen(page, documentId) {
  await page.goto(`/documents/${documentId}`);
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.locator('#screens button').first().click();
}

async function expectLayout(page, selector, layout) {
  const actual = await page.locator(selector).evaluate(root => {
    const base = root.getBoundingClientRect();
    const scale = base.width / parseFloat(root.style.width);
    return Object.fromEntries([...root.querySelectorAll('[data-visual-node]')].map(node => {
      const box = node.getBoundingClientRect();
      return [node.dataset.visualNode, [(box.x - base.x) / scale, (box.y - base.y) / scale, box.width / scale, box.height / scale]];
    }));
  });
  const expected = layout.boxes.slice(1);
  expect(Object.keys(actual)).toEqual(expected.map(box => box.objectId));
  for (const box of expected) {
    const { x, y, width, height } = box.bounds;
    for (const [index, value] of [x, y, width, height].entries())
      expect(actual[box.objectId][index]).toBeCloseTo(value, 1);
  }
}

test('the inspector saves a spacing alias and Preview uses each theme’s reference geometry', async ({ page, request }) => {
  const { documentId, screen, frame, stack, input, command, read } = await seed(request);
  const tokenId = randomUUID(), aliasId = randomUUID();
  const spacing = value => ({ expression: 'literal', value: { type: 'spacing', value } });
  const alias = { expression: 'alias', tokenId };
  await command('add-token', { tokenId, name: 'Spacing scale', type: 1, values: { Light: spacing(14), Dark: spacing(28) } });
  await command('add-token', { tokenId: aliasId, name: 'Field spacing', type: 1, values: { Light: alias, Dark: alias } });
  const layoutPath = `screens/${screen}/layout`;
  await page.setViewportSize({ width: 1400, height: 900 });
  await openScreen(page, documentId);
  const design = page.locator('#screen-boundary');
  await expect(design.locator(visual(input))).toHaveCSS('top', '33px');
  // Select the nested container through its layer tree: descendants may
  // legitimately cover parts of the container's surface on the canvas.
  await page.locator(`#layers [data-id="${frame}"] > .layer-label`).click();
  await page.locator(`#layers [data-id="${stack}"] > .layer-label`).click();
  const inspector = page.locator('#visual-inspector');
  const gap = inspector.locator('.node-property--token').filter({
    has: page.locator('.token-value-label', { hasText: 'Между элементами' })
  });
  await expect(gap.getByRole('spinbutton', { name: 'Между элементами' })).toHaveValue('8');
  await expect(gap.getByText('Источник')).toHaveCount(0);
  await gap.getByRole('button', { name: 'Привязать токен' }).click();
  const menu = gap.getByRole('dialog', { name: 'Между элементами — дизайн-токены' });
  await expect(menu.getByRole('button', { name: /Panel/ })).toHaveCount(0);
  await menu.getByRole('button', { name: /Field spacing/ }).click();
  await expect(gap.locator('.token-value-name')).toHaveText('Field spacing');
  await expect(gap.locator('.token-value-resolved')).toContainText('14 px · Light');
  await expect(inspector.getByRole('status')).toHaveText('Свойства сохранены.');
  await expect(design.locator(visual(input))).toHaveCSS('top', '39px');
  await expectLayout(page, '#screen-boundary', await read(layoutPath));

  const savedToken = { type: 'token', tokenId: aliasId };
  const before = await read('document.json');
  expect(before.document.nodes.find(node => node.id === stack).properties.gap).toEqual(savedToken);
  const designThemes = page.getByRole('group', { name: 'Тема редактора', exact: true });
  const designDark = designThemes.getByRole('button', { name: 'Тёмная тема', exact: true });
  const designLight = designThemes.getByRole('button', { name: 'Светлая тема', exact: true });
  await expect(designLight).toHaveAttribute('aria-pressed', 'true');
  await designDark.click();
  await expect(designDark).toHaveAttribute('aria-pressed', 'true');
  await expect(design.locator(visual(input))).toHaveCSS('top', '53px');
  await expect(gap.locator('.token-value-resolved')).toContainText('28 px · Dark');
  await expectLayout(page, '#screen-boundary', await read(`${layoutPath}?theme=Dark`));
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = `#preview-viewport [data-preview-screen="${screen}"]`;
  await expect(page.locator(preview).locator(visual(input))).toHaveCSS('top', '53px');
  await expectLayout(page, preview, await read(`${layoutPath}?theme=Dark`));
  const themes = page.getByRole('group', { name: 'Тема', exact: true });
  const light = themes.getByRole('button', { name: 'Светлая тема', exact: true });
  const dark = themes.getByRole('button', { name: 'Тёмная тема', exact: true });
  await expect(light).toHaveAttribute('aria-pressed', 'false');
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await light.click();
  await expect(page.locator(preview).locator(visual(input))).toHaveCSS('top', '39px');
  await dark.click();
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await expect(light).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator(preview).locator(visual(input))).toHaveCSS('top', '53px');
  await expectLayout(page, preview, await read(`${layoutPath}?theme=Dark`));
  await light.focus();
  await page.keyboard.press('Space');
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await expect(dark).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator(preview).locator(visual(input))).toHaveCSS('top', '39px');
  expect(await read('document.json')).toEqual(before);

  await page.getByRole('button', { name: 'Вернуться в Design', exact: true }).click();
  await expect(designLight).toHaveAttribute('aria-pressed', 'true');
  await expect(design.locator(visual(input))).toHaveCSS('top', '39px');
  await show(page, 'document');
  await page.getByLabel('Имя версии (необязательно)').fill('Spacing reference');
  const saving = page.waitForResponse(response => response.url().endsWith('/commands/save'));
  await show(page, 'document'); await page.getByRole('button', { name: 'Создать версию', exact: true }).click();
  const response = await saving;
  expect(response.ok(), await response.text()).toBeTruthy();
  const { versionId } = await response.json();
  const snapshot = await read(`document.json?versionId=${versionId}`);
  expect(snapshot.document.nodes.find(node => node.id === stack).properties.gap).toEqual(savedToken);

  await openScreen(page, documentId);
  await expect(design.locator(visual(input))).toHaveCSS('top', '39px');
  await design.locator(`${visual(stack)} > .visual-surface`).click({ position: { x: 174, y: 113 } });
  await expect(gap.getByRole('button', { name: 'Изменить привязку токена' })).toHaveAttribute('aria-pressed', 'true');
  await expect(gap.locator('.token-value-name')).toHaveText('Field spacing');
  await expect(gap.locator('.token-value-resolved')).toContainText('14 px · Light');
});

test('Design and Preview use the server bounds, clipping, typed styling and local controls', async ({ page, request }) => {
  const model = await seed(request);
  const { documentId, screen, frame, stack, label, input, button, textarea, image, hidden, cover, variantId, command, read } = model;
  const saved = await command('save', { name: 'Перед Preview' });
  const designLayout = await read(`screens/${screen}/layout`);
  const before = await read('document.json');
  const savedSnapshot = await read(`document.json?versionId=${saved.versionId}`);
  await page.setViewportSize({ width: 1400, height: 900 });
  await openScreen(page, documentId);
  const design = page.locator('#screen-boundary');
  const layer = id => page.locator(`#layers [data-id="${id}"]`);
  const canvasLabel = design.locator(visual(label));
  await expect(canvasLabel).toHaveText(plainText);
  await expect(design.locator('strong')).toHaveCount(0);
  await expect(design.locator(visual(hidden))).toBeHidden();
  await expectLayout(page, '#screen-boundary', designLayout);
  await expect(design.locator(`${visual(frame)} > .visual-surface`)).toHaveCSS('background-color', 'rgb(211, 239, 224)');
  await expect(design.locator(`${visual(frame)} > .visual-surface`)).toHaveCSS('border-radius', '9px');
  await expect(design.locator(`${visual(label)} > .visual-surface`)).toHaveCSS('font-weight', '700');
  await expect.poll(() => design.locator(`${visual(image)} img`).evaluate(img => img.naturalWidth)).toBe(2);
  await expect(design.locator(`${visual(image)} img`)).toHaveCSS('object-fit', 'contain');
  await expect(layer(label)).toHaveCount(0);
  await canvasLabel.locator('.visual-surface').click({ position: { x: 20, y: 8 } });
  await expect(layer(label)).toHaveAttribute('aria-selected', 'true');
  await expect(layer(stack).locator(`[data-id="${label}"]`)).toHaveCount(1);
  await layer(input).locator('.layer-label').click();
  await expect(design.locator(visual(input))).toHaveAttribute('data-selected', 'true');

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.locator('#preview-viewport');
  const screenRoot = `[data-preview-screen="${screen}"]`;
  await expect(preview.getByRole('textbox', { name: 'Поле' })).toHaveValue('Пример');
  await expect(page.locator('#viewport')).toBeHidden();
  await expect(page.locator('#layers')).toBeHidden();
  await expect(preview.locator('[data-selected]')).toHaveCount(0);
  await expect(preview.getByRole('button', { name: 'Недоступно' })).toBeDisabled();
  const clip = designLayout.boxes.find(box => box.objectId === label).clip;
  const hits = await preview.locator(screenRoot).evaluate((root, clip) => {
    const box = root.getBoundingClientRect();
    return [-1, 1].map(delta => document.elementFromPoint(box.left + clip.x + clip.width + delta, box.top + clip.y + 16)
      ?.closest('[data-visual-node]')?.dataset.visualNode);
  }, clip);
  expect(hits).toEqual([label, undefined]);
  await expectLayout(page, `#preview-viewport ${screenRoot}`, designLayout);
  const themes = page.getByRole('group', { name: 'Тема', exact: true });
  const light = themes.getByRole('button', { name: 'Светлая тема', exact: true });
  const dark = themes.getByRole('button', { name: 'Тёмная тема', exact: true });
  await dark.focus();
  await page.keyboard.press('Enter');
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await expect(preview.locator(`${visual(frame)} > .visual-surface`)).toHaveCSS('background-color', 'rgb(18, 60, 72)');
  const field = preview.getByRole('textbox', { name: 'Поле' });
  await field.focus();
  await page.keyboard.type(' local');
  await expect(field).toHaveValue(/local/);
  await page.keyboard.press('Tab');
  await expect(preview.getByRole('button', { name: 'Применить' })).toBeFocused();
  const playbackRequest = page.waitForRequest(req => req.method() === 'POST' && req.url().endsWith('/preview'));
  await page.keyboard.press('Enter');
  expect((await playbackRequest).postDataJSON().selection.theme).toBe(1);
  await expect(field).toHaveValue('Значение сценария');
  await expect(preview.locator(visual(label))).toHaveText('<em>Другой датасет</em>');
  await expect(preview.locator('em')).toHaveCount(0);
  await expect(preview.locator(visual(frame))).toHaveCSS('width', '210px');
  await preview.getByRole('textbox', { name: 'Комментарий' }).fill('Строка 1\nСтрока 2');
  const resized = page.waitForResponse(response => response.url().includes('/layout?') && new URL(response.url()).searchParams.get('previewWidth') === '302');
  await page.setViewportSize({ width: 302, height: 900 });
  const resizedLayout = await (await resized).json();
  expect(new URL((await resized).url()).searchParams.get('variantId')).toBe(variantId);
  await expect(preview.locator(screenRoot)).toHaveCSS('width', '302px');
  await expectLayout(page, `#preview-viewport ${screenRoot}`, resizedLayout);
  await expect(preview.locator(`${visual(textarea)} textarea`)).toHaveValue('Строка 1\nСтрока 2');
  await expect(preview.locator(visual(cover))).toHaveCSS('clip-path', 'inset(-160px 144px -160px -330px)');
  await page.setViewportSize({ width: 1400, height: 900 });
  await preview.getByRole('button', { name: 'Дальше' }).click();
  await expect(preview).toContainText('Другой экран');
  await page.getByRole('button', { name: 'Назад по сценарию' }).click();
  await expect(preview.locator(visual(button))).toBeVisible();
  await page.getByRole('button', { name: 'Вернуться в Design' }).click();
  await expect(design.locator(visual(input))).toHaveAttribute('data-selected', 'true');
  await expect(design.locator(`${visual(frame)} > .visual-surface`)).toHaveCSS('background-color', 'rgb(18, 60, 72)');
  await page.locator(`#screens .screen-select[data-screen-id="${model.other}"]`).click();
  await expect(design.locator(visual(model.otherLabel))).toBeVisible();
  await page.locator(`#screens .screen-select[data-screen-id="${screen}"]`).click();
  await expect(design.locator(`${visual(frame)} > .visual-surface`)).toHaveCSS('background-color', 'rgb(18, 60, 72)');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(field).toHaveValue('Пример');
  await expect(light).toHaveAttribute('aria-pressed', 'false');
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  expect(await read('document.json')).toEqual(before);
  expect(await read(`document.json?versionId=${saved.versionId}`)).toEqual(savedSnapshot);
  expect((await read('pages')).revision).toBe(saved.revision);
});

test('paginates both snapshots, discards a delayed screen, and reports a failed asset read', async ({ page, request }) => {
  const { base, documentId, screen, label, otherLabel, assetId, command } = await seed(request, true);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const delayed = new Promise(resolve => { entered = resolve; });
  const offsets = { nodes: [], layout: [] };
  let delay = true;
  await page.route(`**${base}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/assets/${assetId}`)) return route.fulfill({ status: 500, json: { code: 'ASSET_CONTENT_UNAVAILABLE' } });
    const resource = url.pathname.split('/').at(-1);
    if (!offsets[resource] || !url.searchParams.has('offset')) return route.continue();
    offsets[resource].push(Number(url.searchParams.get('offset')));
    if (delay && resource === 'layout' && url.pathname.endsWith(`/${screen}/layout`)) {
      delay = false;
      entered();
      await gate;
    }
    url.searchParams.set('limit', '1');
    await route.continue({ url: url.href }).catch(() => {});
  });
  await openScreen(page, documentId);
  await delayed;
  await page.locator('#screens button').nth(1).click();
  const canvas = page.locator('#screen-boundary');
  await expect(canvas.locator(visual(otherLabel))).toHaveText('Другой экран');
  release();
  await expect(canvas.locator(visual(label))).toHaveCount(0);
  await page.locator('#screens button').first().click();
  await expect(canvas.locator(visual(label))).toHaveText(plainText);
  expect(offsets.nodes).toContain(1);
  expect(offsets.layout).toContain(1);
  await expect(page.locator('#design-render-diagnostics')).toContainText('Не удалось загрузить изображение');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const liveText = page.locator(`#preview-viewport ${visual(label)}`);
  await expect(liveText).toHaveText(plainText);
  await command('set-node-property', { nodeId: label, property: 'text', value: text('Изменено в общей ревизии') });
  await expect(liveText).toHaveText('Изменено в общей ревизии');
});


const shadow = (offsetX, offsetY, blurRadius, spreadRadius, red, green, blue, alpha = 255) =>
  ({ type: 'shadow', offsetX, offsetY, blurRadius, spreadRadius, color: { red, green, blue, alpha } });

test('shadow is shared by Design and Preview, uses effective corner radius and does not change bounds or hit area', async ({ page, request }) => {
  const { documentId, screen, other, image, command, read } = await seed(request, true);
  const button = randomUUID();
  await command('add-node', { nodeId: button, parentId: screen, kind: 'Button',
    properties: { ...geometry(60, 100, 100, 40), cornerRadius: number(12), text: text('Next') } });
  await command('create-scenario', { scenario: { id: randomUUID(), screenId: screen, nodeId: button, event: 0,
    actions: [{ type: 'navigate', screenId: other }] } });
  const before = await read('screens/' + screen + '/layout');
  const effect = shadow(0, 10, 8, 4, 15, 23, 42);
  await command('set-node-property', { nodeId: button, property: 'shadow', value: effect });
  await command('set-node-property', { nodeId: image, property: 'shadow', value: effect });
  const after = await read('screens/' + screen + '/layout');
  expect(after.boxes).toEqual(before.boxes);
  expect(after.diagnostics).toEqual(before.diagnostics);
  await page.setViewportSize({ width: 1400, height: 900 });
  await openScreen(page, documentId);
  const design = page.locator('#screen-boundary');
  const designButton = design.locator(visual(button));
  const expected = 'rgb(15, 23, 42) 0px 10px 8px 4px';
  await expect(designButton).toHaveCSS('box-shadow', expected);
  await expect(designButton).toHaveCSS('border-radius', '12px');
  await expect(design.locator(visual(image))).toHaveCSS('border-radius', '0px');
  await expect(design.locator(visual(image))).toHaveCSS('box-shadow', expected);
  await expectLayout(page, '#screen-boundary', after);
  await page.locator('#zoom-in').click();
  await expect(designButton).toHaveCSS('box-shadow', expected);
  const current = await read('document.json');
  expect(current.document.nodes.find(node => node.id === button).properties.shadow).toEqual(effect);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const root = page.locator('[data-preview-screen="' + screen + '"]');
  const previewButton = root.locator(visual(button));
  await expect(previewButton).toHaveCSS('box-shadow', expected);
  await expect(previewButton).toHaveCSS('border-radius', '12px');
  const box = await previewButton.boundingBox();
  const outside = { x: box.x + box.width / 2, y: box.y + box.height + 5 };
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-visual-node]')?.dataset.visualNode, outside)).not.toBe(button);
  await page.mouse.click(outside.x, outside.y);
  await expect(root).toBeVisible();
  await root.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('[data-preview-screen="' + other + '"]')).toBeVisible();
});

// Read pixels from a deterministic screenshot without modifying the rendered document.
async function assertPixels(page, root, name, samples) {
  const png = await root.screenshot({ animations: 'disabled', scale: 'css' });
  await test.info().attach(name, { body: png, contentType: 'image/png' });
  const colors = await page.evaluate(async ({ bytes, samples }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    return samples.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
  }, { bytes: [...png], samples: samples.map(([x, y]) => [x, y]) });
  expect(colors).toEqual(samples.map(([, , color]) => color));
}

test('own Overflow.Clip does not clip its own shadow', async ({ page, request }) => {
  const { documentId, screen, command } = await seed(request, true);
  const frame = randomUUID();
  await command('add-node', { nodeId: frame, parentId: screen, kind: 'Frame',
    properties: { ...geometry(50, 80, 100, 80), overflow: option('Clip'), backgroundColor: rgba(255, 255, 255),
      cornerRadius: number(8), shadow: shadow(0, 0, 0, 12, 0, 0, 0) } });
  await page.setViewportSize({ width: 1400, height: 900 });
  await openScreen(page, documentId);
  await expect(page.locator('#screen-boundary ' + visual(frame))).toHaveCSS('box-shadow', 'rgb(0, 0, 0) 0px 0px 0px 12px');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const root = page.locator('[data-preview-screen="' + screen + '"]');
  await expect(root.locator(visual(frame) + ' > .visual-children')).toHaveCSS('overflow', 'clip');
  await assertPixels(page, root, 'Own Clip and own shadow', [
    [44, 120, [0, 0, 0, 255]], [30, 120, [255, 255, 255, 255]]
  ]);
});

test('ancestor Overflow.Clip clips child shadow while Visible lets it paint outside', async ({ page, request }) => {
  const { documentId, screen, command } = await seed(request, true);
  const parent = randomUUID(), child = randomUUID();
  await command('add-node', { nodeId: parent, parentId: screen, kind: 'Frame',
    properties: { ...geometry(50, 80, 100, 80), overflow: option('Clip'), backgroundColor: rgba(255, 255, 255) } });
  await command('add-node', { nodeId: child, parentId: parent, kind: 'Button',
    properties: { ...geometry(80, 20, 40, 40), shadow: shadow(0, 0, 0, 12, 255, 0, 0) } });
  await page.setViewportSize({ width: 1400, height: 900 });
  await openScreen(page, documentId);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const root = page.locator('[data-preview-screen="' + screen + '"]');
  await expect(root.locator(visual(child))).toHaveCSS('box-shadow', 'rgb(255, 0, 0) 0px 0px 0px 12px');
  await assertPixels(page, root, 'Parent Clip and child shadow', [
    [145, 94, [255, 0, 0, 255]], [155, 94, [255, 255, 255, 255]]
  ]);
  await page.getByRole('button', { name: 'Вернуться в Design' }).click();
  await command('set-node-property', { nodeId: parent, property: 'overflow', value: option('Visible') });
  await expect(page.locator('#screen-boundary ' + visual(parent) + ' > .visual-children')).toHaveCSS('overflow', 'visible');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(root.locator(visual(parent))).toHaveCSS('overflow', 'visible');
  await assertPixels(page, root, 'Parent Visible and child shadow', [
    [145, 94, [255, 0, 0, 255]], [155, 94, [255, 0, 0, 255]]
  ]);
});
