const { test, expect, bearer } = require('./fixtures');
const { randomUUID } = require('node:crypto');
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
  await page.locator('#node-later').click();
  await expect(page.locator('#node-order-retry')).toBeVisible();
  await page.locator('#node-order-retry').click();
  await expect(page.locator('#node-order-retry')).toBeHidden();
  await expect.poll(() => children(request, base, screenId)).toEqual([frameId, secondId, firstId]);
  await expect.poll(() => page.locator('#layers > [role=treeitem]').evaluateAll(rows => rows.map(row => row.dataset.id))).toEqual([frameId, secondId, firstId]);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(acknowledgements[1].revision).toBe(acknowledgements[0].revision);
  expect(acknowledgements[1].status).toBe('ACCEPTED');
  await page.locator('#node-reparent').click();
  await page.locator('#node-reparent-target').selectOption(frameId);
  await page.locator('#node-reparent-submit').click();
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
  await page.locator('#node-reparent').click();
  await page.locator('#node-reparent-target').selectOption(frameId);
  const concurrent = await command('move-node', { nodeId: firstId, expectedParentId: screenId, targetParentId: frameId, position: 0 });
  const rejection = page.waitForResponse(response => response.url().endsWith('/commands/move-node'));
  await page.locator('#node-reparent-submit').click();
  const response = await rejection;
  expect(response.ok()).toBeFalsy();
  expect((await response.json()).code).toBe('INVALID_LAYOUT_CONTEXT');
  await expect(page.locator('#node-order-status')).toContainText('Родитель слоя изменился');
  await expect(page.locator('#node-order-retry')).toBeHidden();
  expect(await children(request, base, frameId)).toEqual([firstId]);
  const state = await request.get(`${base}/nodes?screenId=${screenId}&fields=parentId`, { headers });
  expect((await state.json()).revision).toBe(concurrent.revision);
});
