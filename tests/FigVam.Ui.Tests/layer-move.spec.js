const { test, expect, bearer } = require('./fixtures');
const { randomUUID } = require('node:crypto');
const { layerRow, label, startLayerDrag, hoverLayer, dragLayer } = require('./layer-drag-helper');
const headers = { Authorization: `Bearer ${bearer}` };

async function setup(page, request) {
  const documentId = randomUUID(), pageId = randomUUID(), screenId = randomUUID();
  const frameId = randomUUID(), firstId = randomUUID(), secondId = randomUUID();
  const base = `/api/v1/documents/${documentId}`;
  async function post(path, data) {
    const response = await request.post(path, { headers, data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const command = (name, data) => post(`${base}/commands/${name}`, { commandId: randomUUID(), ...data });
  await post('/api/v1/documents', { documentId, name: 'Layer moves' });
  await command('add-page', { pageId });
  await command('add-screen', { pageId, screenId, dimensions: { width: 800, height: 600 } });
  for (const [nodeId, kind] of [[frameId, 'Frame'], [firstId, 'Text'], [secondId, 'Button']])
    await command('add-node', { nodeId, parentId: screenId, kind });
  await page.goto(`/documents/${documentId}`);
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.locator('#screens button').first().click();
  await expect(page.locator('[role=treeitem]')).toHaveCount(3);
  return { base, screenId, frameId, firstId, secondId, command };
}

async function children(request, base, parentId) {
  const response = await request.get(`${base}/children/${parentId}?offset=0&limit=100`, { headers });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).items.map(item => item.id);
}

test('real ACK synchronizes reorder and reparent; retry does not apply a lost ACK twice', async ({ page, request }) => {
  const { base, screenId, frameId, firstId, secondId } = await setup(page, request);
  const bodies = [], acknowledgements = [];
  await page.route(`**${base}/commands/move-node`, async route => {
    bodies.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBeTruthy();
    acknowledgements.push(await response.json());
    if (bodies.length === 1) await route.abort();
    else await route.fulfill({ response });
  });
  await page.locator(`[role=treeitem][data-id="${firstId}"]`).press('Enter');
  await dragLayer(page, firstId, secondId, 'after');
  await expect(page.locator('#node-order-retry')).toBeVisible();
  await page.locator('#node-order-retry').click();
  await expect(page.locator('#node-order-retry')).toBeHidden();
  await expect.poll(() => children(request, base, screenId)).toEqual([frameId, secondId, firstId]);
  await expect.poll(() => page.locator('#layers > [role=treeitem]').evaluateAll(rows => rows.map(row => row.dataset.id))).toEqual([frameId, secondId, firstId]);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(acknowledgements[1].revision).toBe(acknowledgements[0].revision);
  expect(acknowledgements[1].status).toBe('ACCEPTED');
  await dragLayer(page, firstId, frameId);
  await expect(page.locator('#node-order-status')).toContainText('Слой перемещён к новому родителю');
  await expect(page.locator('#node-order-retry')).toBeHidden();
  await expect(page.locator(`[role=treeitem][data-id="${frameId}"] [role=treeitem][data-id="${firstId}"]`)).toBeVisible();
  expect(await children(request, base, screenId)).toEqual([frameId, secondId]);
  expect(await children(request, base, frameId)).toEqual([firstId]);
  expect(bodies).toHaveLength(3);
  expect(acknowledgements[2].revision).toBe(acknowledgements[1].revision + 1);
});

test('a stale parent is rejected by the server without a false acknowledgement', async ({ page, request }) => {
  const { base, screenId, frameId, firstId, command } = await setup(page, request);
  await page.locator(`[role=treeitem][data-id="${firstId}"]`).press('Enter');
  let concurrent;
  await page.route(`**${base}/commands/move-node`, async route => {
    concurrent = await command('move-node', { nodeId: firstId, expectedParentId: screenId, targetParentId: frameId, position: 0 });
    await route.continue();
  }, { times: 1 });
  const rejection = page.waitForResponse(response => response.url().endsWith('/commands/move-node'));
  await dragLayer(page, firstId, frameId);
  const response = await rejection;
  expect(response.ok()).toBeFalsy();
  expect((await response.json()).code).toBe('INVALID_LAYOUT_CONTEXT');
  await expect(page.locator('#node-order-status')).toContainText('Родитель слоя изменился');
  await expect(page.locator('#node-order-retry')).toBeHidden();
  expect(await children(request, base, frameId)).toEqual([firstId]);
  const state = await request.get(`${base}/nodes?screenId=${screenId}&fields=parentId`, { headers });
  expect((await state.json()).revision).toBe(concurrent.revision);
});

test('drag across siblings, preserve selection and focus, synchronize canvas and survive reload', async ({ page, request }) => {
  const { base, screenId, frameId, firstId, secondId } = await setup(page, request);
  const order = () => page.locator('#layers > [role=treeitem]').evaluateAll(rows => rows.map(row => row.dataset.id));
  await expect(page.locator('#node-earlier, #node-later, #node-reparent, #node-reparent-form')).toHaveCount(0);
  await dragLayer(page, secondId, frameId, 'before');
  await expect.poll(order).toEqual([secondId, frameId, firstId]);
  await expect(layerRow(page, secondId)).toHaveAttribute('aria-selected', 'true');
  await expect(layerRow(page, secondId)).toBeFocused();
  const canvas = page.locator('#screen-boundary');
  await expect.poll(() => canvas.locator('[data-visual-node]').evaluateAll(nodes => nodes.map(node => node.dataset.visualNode))).toEqual([secondId, frameId, firstId]);
  await dragLayer(page, secondId, firstId, 'after');
  await expect.poll(order).toEqual([frameId, firstId, secondId]);
  await dragLayer(page, secondId, firstId, 'before');
  await expect.poll(order).toEqual([frameId, secondId, firstId]);
  await layerRow(page, secondId).press('Control+ArrowDown');
  await expect.poll(order).toEqual([frameId, firstId, secondId]);
  await layerRow(page, secondId).press('Meta+ArrowUp');
  await expect.poll(order).toEqual([frameId, secondId, firstId]);
  expect(await children(request, base, screenId)).toEqual([frameId, secondId, firstId]);
  await page.reload();
  const auth = page.getByLabel('Bearer-токен', { exact: true });
  if (await auth.isVisible()) {
    await auth.fill(bearer);
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  }
  await page.locator('#screens button').first().click();
  await expect.poll(order).toEqual([frameId, secondId, firstId]);
});

test('cancel, no-op and cyclic drops issue no command; leaf rows have only before/after zones', async ({ page, request }) => {
  const { base, screenId, frameId, firstId, secondId } = await setup(page, request);
  let calls = 0;
  await page.route(`**${base}/commands/move-node`, route => { calls++; return route.continue(); });
  await startLayerDrag(page, firstId);
  await hoverLayer(page, secondId, 'before');
  await expect(layerRow(page, secondId)).toHaveAttribute('data-layer-drop', 'invalid');
  await page.mouse.up();
  expect(calls).toBe(0);
  await startLayerDrag(page, firstId);
  await hoverLayer(page, frameId);
  await page.keyboard.press('Escape');
  await expect(page.locator('.layer-drag-ghost')).toHaveCount(0);
  await page.mouse.up();
  expect(calls).toBe(0);
  await dragLayer(page, firstId, frameId);
  await expect(layerRow(page, firstId)).toBeVisible();
  await expect(layerRow(page, firstId)).toHaveAttribute('aria-selected', 'true');
  await startLayerDrag(page, frameId);
  await hoverLayer(page, firstId, 'after');
  await expect(layerRow(page, firstId)).toHaveAttribute('data-layer-drop', 'invalid');
  await page.mouse.up();
  expect(calls).toBe(1);
  await startLayerDrag(page, frameId);
  await hoverLayer(page, secondId, 'after');
  await expect(layerRow(page, secondId)).toHaveAttribute('data-layer-drop', 'after');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(calls).toBe(1);
  expect(await children(request, base, screenId)).toEqual([frameId, secondId]);
  expect(await children(request, base, frameId)).toEqual([firstId]);
  await dragLayer(page, firstId, secondId, 'after');
  await expect.poll(() => children(request, base, screenId)).toEqual([frameId, secondId, firstId]);
});

test('moves a container together with its children and expands a collapsed target', async ({ page, request }) => {
  const { base, screenId, frameId, firstId, secondId } = await setup(page, request);
  await dragLayer(page, firstId, frameId);
  await expect(layerRow(page, firstId)).toBeVisible();
  await dragLayer(page, frameId, secondId, 'after');
  await expect.poll(() => children(request, base, screenId)).toEqual([secondId, frameId]);
  expect(await children(request, base, frameId)).toEqual([firstId]);
  await layerRow(page, frameId).press('ArrowLeft');
  await expect(layerRow(page, frameId)).toHaveAttribute('aria-expanded', 'false');
  await startLayerDrag(page, secondId);
  await hoverLayer(page, frameId);
  await expect(layerRow(page, frameId)).toHaveAttribute('aria-expanded', 'true');
  await hoverLayer(page, firstId, 'before');
  await page.mouse.up();
  await expect.poll(() => children(request, base, frameId)).toEqual([secondId, firstId]);
});

test('edge scrolling is isolated to the layers detail panel', async ({ page, request }) => {
  const { screenId, command, frameId } = await setup(page, request);
  for (let i = 0; i < 20; i++) await command('add-node', { nodeId: randomUUID(), parentId: screenId, kind: 'Text' });
  await page.getByRole('button', { name: 'Обновить страницы' }).click();
  await expect(page.locator('#layers > [role=treeitem]')).toHaveCount(23);
  const scroll = page.locator('.layer-tree-group');
  const master = page.locator('#pages');
  const before = await master.evaluate(e => e.scrollTop);
  await startLayerDrag(page, frameId);
  const bounds = await scroll.boundingBox();
  await page.mouse.move(bounds.x + 50, bounds.y + bounds.height - 3);
  await expect.poll(() => scroll.evaluate(e => e.scrollTop)).toBeGreaterThan(30);
  expect(await master.evaluate(e => e.scrollTop)).toBe(before);
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('a concurrently changed sibling order rejects the stale numeric insertion index', async ({ page, request }) => {
  const { base, screenId, frameId, firstId, secondId, command } = await setup(page, request);
  let result;
  await page.route(`**${base}/commands/move-node`, async route => {
    await command('move-node', { nodeId: firstId, expectedParentId: screenId, targetParentId: screenId, position: 0 });
    const response = await route.fetch();
    result = await response.json();
    await route.fulfill({ response });
  }, { times: 1 });
  await dragLayer(page, secondId, frameId, 'before');
  await expect(page.locator('#node-order-status')).toContainText('Структура документа изменилась');
  expect(result.code).toBe('REVISION_CONFLICT');
  expect(await children(request, base, screenId)).toEqual([firstId, frameId, secondId]);
  await expect.poll(() => page.locator('#layers > [role=treeitem]').evaluateAll(rows => rows.map(row => row.dataset.id))).toEqual([firstId, frameId, secondId]);
});
