const { test, expect, bearer } = require('./fixtures');
const { randomUUID } = require('node:crypto');
const { dragLayer, startLayerDrag, hoverLayer } = require('./layer-drag-helper');

function deferred() {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
}

async function setup(page, request, { role = 'Owner', paged = false } = {}) {
  const doc = randomUUID(), pageId = randomUUID(), screens = [randomUUID(), randomUUID()];
  const headers = { Authorization: `Bearer ${bearer}` }, base = `/api/v1/documents/${doc}`;
  expect((await request.post('/api/v1/documents', { headers, data: { documentId: doc, name: 'Layers' } })).ok()).toBeTruthy();
  for (const [name, data] of [['add-page', { pageId }], ...screens.map(screenId => ['add-screen', { pageId, screenId, dimensions: { width: 600, height: 400 } }])])
    expect((await request.post(`${base}/commands/${name}`, { headers, data: { commandId: randomUUID(), ...data } })).ok()).toBeTruthy();
  if (role !== 'Owner') {
    await page.route('**/api/v1/documents?*', async route => {
      const response = await route.fetch(), body = await response.json();
      for (const item of body.items) if (item.documentId === doc) item.role = role;
      await route.fulfill({ response, json: body });
    });
  }

  const nodes = new Map(), children = new Map(screens.map(screen => [screen, []]));
  function add(parent, name, canContainChildren = false) {
    const id = randomUUID();
    nodes.set(id, { id, name, kind: canContainChildren ? 'Test container' : 'Test leaf', canContainChildren });
    children.set(id, []);
    children.get(parent).push(id);
    return id;
  }
  const [screen, anotherScreen] = screens;
  const source = add(screen, 'Source', true);
  const descendant = add(source, 'Excluded descendant', true);
  add(descendant, 'Excluded grandchild', true);
  const folder = add(screen, 'Folder', true), leaf = add(screen, 'Leaf');
  if (paged) for (let i = 0; i < 101; i++) add(folder, `Filler ${i}`);
  const target = add(folder, 'Destination', true), existingChild = add(target, 'Existing child');
  add(anotherScreen, 'Other screen container', true);
  const reads = [], calls = [];
  const item = (id, parentId) => ({ ...nodes.get(id), parentId, childCount: children.get(id).length });
  const descendants = parent => children.get(parent).flatMap(id => [item(id, parent), ...descendants(id)]);
  function read(route, items) {
    const params = new URL(route.request().url()).searchParams;
    const offset = Number(params.get('offset')), limit = Number(params.get('limit')) || 100;
    return route.fulfill({ json: {
      documentId: doc, revision: Number(params.get('revision') ?? 3), offset, limit, total: items.length, items: items.slice(offset, offset + limit)
    } });
  }
  await page.route('**/children/*?*', route => {
    const parent = new URL(route.request().url()).pathname.split('/').at(-1);
    return read(route, (children.get(parent) ?? []).map(id => item(id, parent)));
  });
  await page.route('**/nodes/*?*', route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    return read(route, nodes.has(id) ? [nodes.get(id)] : []);
  });
  function move(nodeId, expectedParentId, targetParentId, position) {
    const oldChildren = children.get(expectedParentId);
    oldChildren.splice(oldChildren.indexOf(nodeId), 1);
    children.get(targetParentId).splice(position, 0, nodeId);
  }
  let answer = (route, body) => { move(body.nodeId, body.expectedParentId, body.targetParentId, body.position); return ack(route, body); };
  function ack(route, body) {
    return route.fulfill({ json: { status: 'ACCEPTED', documentId: doc, commandId: body.commandId, revision: 4 } });
  }
  await page.route('**/commands/move-node', route => {
    calls.push(route.request().postData());
    return answer(route, route.request().postDataJSON());
  });
  await page.goto(`/documents/${doc}`);
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#screens button')).toHaveCount(2);
  await page.locator('#screens button').first().click();
  await expect(layer(page, source)).toBeVisible();
  return { calls, reads, source, target, folder, descendant, leaf, existingChild, screen, anotherScreen, children, move, ack,
    answer: fn => { answer = fn; } };
}

const layer = (page, id) => page.locator(`#layers [data-id="${id}"]`);
const moveStatus = page => page.locator('#node-order-status');
const retry = page => page.getByRole('button', { name: 'Повторить перемещение слоя' });

async function selectLayer(page, id) {
  await layer(page, id).press('Enter');
  await expect(layer(page, id)).toHaveAttribute('aria-selected', 'true');
}

async function openFolder(page, fixture) {
  if (await layer(page, fixture.folder).getAttribute('aria-expanded') === 'false')
    await layer(page, fixture.folder).locator(':scope > .layer-label').click();
  await expect(layer(page, fixture.target)).toBeAttached();
}

async function submit(page, fixture, target = fixture.target) {
  if (target === fixture.screen) await dragLayer(page, fixture.source, fixture.leaf, 'after');
  else {
    await openFolder(page, fixture);
    await dragLayer(page, fixture.source, target);
  }
}

test('drag opens a collapsed paginated folder and moves a subtree back to the screen root', async ({ page, request }) => {
  const f = await setup(page, request, { role: 'Editor', paged: true });
  await selectLayer(page, f.source);
  await expect(layer(page, f.target)).toHaveCount(0);
  await startLayerDrag(page, f.source);
  await hoverLayer(page, f.folder);
  await expect(layer(page, f.folder)).toHaveAttribute('aria-expanded', 'true');
  await expect(layer(page, f.target)).toBeAttached();
  await hoverLayer(page, f.target);
  await expect(layer(page, f.target)).toHaveAttribute('data-layer-drop', 'inside');
  await page.mouse.up();
  await expect(moveStatus(page)).toContainText('Слой перемещён');
  await expect(layer(page, f.target).locator(':scope > [role=group] > [role=treeitem]').last()).toHaveAttribute('data-id', f.source);
  await expect(layer(page, f.source)).toHaveAttribute('aria-selected', 'true');
  const first = JSON.parse(f.calls[0]);
  expect(first).toMatchObject({ nodeId: f.source, expectedParentId: f.screen, targetParentId: f.target, position: 1 });
  expect(f.children.get(f.source)).toEqual([f.descendant]);
  await submit(page, f, f.screen);
  await expect(moveStatus(page)).toContainText('Слой перемещён');
  await expect(page.locator('#layers > [role=treeitem]').last()).toHaveAttribute('data-id', f.source);
  const second = JSON.parse(f.calls[1]);
  expect(second).toMatchObject({ nodeId: f.source, expectedParentId: f.target, targetParentId: f.screen, position: 2 });
  expect(second.commandId).not.toBe(first.commandId);
});

test('refreshes the layer tree after parent conflict and concurrent deletion', async ({ page, request }) => {
  const f = await setup(page, request);
  await selectLayer(page, f.source);
  f.answer(route => {
    f.move(f.source, f.screen, f.folder, 0);
    return route.fulfill({ status: 409, json: { code: 'INVALID_LAYOUT_CONTEXT' } });
  });
  await submit(page, f);
  await expect(moveStatus(page)).toContainText('Родитель слоя изменился. Дерево обновлено.');
  await expect(page.locator(`#layers > [data-id="${f.source}"]`)).toHaveCount(0);
  if (await layer(page, f.folder).getAttribute('aria-expanded') === 'false') await layer(page, f.folder).locator(':scope > .layer-label').click();
  await expect(layer(page, f.source)).toBeVisible();
  await selectLayer(page, f.source);
  f.answer(route => {
    f.children.get(f.folder).splice(0, 1);
    return route.fulfill({ status: 404, json: { code: 'NODE_NOT_FOUND' } });
  });
  await submit(page, f, f.screen);
  await expect(moveStatus(page)).toContainText('Слой уже удалён другим участником. Дерево обновлено.');
  await expect(layer(page, f.source)).toHaveCount(0);
  await expect(retry(page)).toBeHidden();
});

test('cancels an active gesture when a refreshed snapshot removes its source', async ({ page, request }) => {
  const f = await setup(page, request);
  await startLayerDrag(page, f.source);
  await hoverLayer(page, f.folder);
  f.children.get(f.screen).shift();
  // Programmatic refresh avoids ending the physical pointer gesture first.
  await page.getByRole('button', { name: 'Обновить страницы' }).evaluate(button => button.click());
  await expect(layer(page, f.source)).toHaveCount(0);
  await expect(page.locator('.layer-drag-ghost')).toHaveCount(0);
  await page.mouse.up();
  expect(f.calls).toHaveLength(0);
});

test('retries the exact serialized request after losing the response and prevents duplicate submissions', async ({ page, request }) => {
  const f = await setup(page, request);
  const entered = deferred(), release = deferred();
  f.answer(async (route, body) => {
    if (f.calls.length === 1) {
      entered.resolve();
      await release.promise;
      f.move(body.nodeId, body.expectedParentId, body.targetParentId, body.position);
      return route.abort();
    }
    return f.ack(route, body);
  });
  await selectLayer(page, f.source);
  await submit(page, f);
  await entered.promise;
  await expect(page.locator('#layers')).not.toHaveClass(/layer-move-enabled/);
  await layer(page, f.source).press('Control+ArrowDown');
  release.resolve();
  await expect(retry(page)).toBeVisible();
  expect(f.calls).toHaveLength(1);
  await retry(page).click();
  await expect(moveStatus(page)).toContainText('Слой перемещён');
  expect(f.calls).toHaveLength(2);
  expect(f.calls[1]).toBe(f.calls[0]);
});

test('Viewer can select layers but cannot drag or use reorder shortcuts', async ({ page, request }) => {
  const f = await setup(page, request, { role: 'Viewer' });
  await selectLayer(page, f.source);
  const from = await layer(page, f.source).locator(':scope > .layer-label').boundingBox();
  const to = await layer(page, f.folder).locator(':scope > .layer-label').boundingBox();
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 20, to.y + to.height / 2, { steps: 5 });
  await expect(page.locator('.layer-drag-ghost')).toHaveCount(0);
  await page.mouse.up();
  await layer(page, f.source).press('Control+ArrowDown');
  await expect(page.locator('#layers')).not.toHaveClass(/layer-move-enabled/);
  expect(f.calls).toHaveLength(0);
});

test('a rejected move after access loss closes the active document', async ({ page, request }) => {
  const f = await setup(page, request);
  f.answer(route => route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }));
  await submit(page, f);
  await expect(page.locator('#editor-view')).toBeHidden();
  await expect(page.locator('#error')).toContainText('Доступ к документу потерян');
});

for (const exit of ['selection', 'screen', 'document', 'logout']) {
  test(`a late move response is ignored after changing ${exit}`, async ({ page, request }) => {
    const f = await setup(page, request);
    const entered = deferred(), release = deferred();
    f.answer(async route => {
      entered.resolve();
      await release.promise;
      return route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } });
    });
    await selectLayer(page, f.source);
    await submit(page, f);
    await entered.promise;
    if (exit === 'selection') await selectLayer(page, f.leaf);
    if (exit === 'screen') {
      await page.locator('#screens button').nth(1).click();
      await expect(page.locator('#layers')).toContainText('Other screen container');
    }
    if (exit === 'document') await page.getByRole('link', { name: '← Документы' }).click();
    if (exit === 'logout') await page.locator('#editor-signout').click();
    const received = page.waitForResponse(response => response.url().endsWith('/commands/move-node'));
    release.resolve();
    expect((await received).status()).toBe(403);
    if (exit === 'selection') {
      await expect(layer(page, f.leaf)).toHaveAttribute('aria-selected', 'true');
      await expect(retry(page)).toBeVisible();
    }
    if (exit === 'screen') {
      await expect(page.locator('#layers')).toContainText('Other screen container');
      await page.locator('#screens button').first().click();
      await expect(retry(page)).toBeVisible();
    }
    if (exit === 'document') await expect(page.locator('#documents-view')).toBeVisible();
    if (exit === 'logout') await expect(page.locator('#authentication')).toBeVisible();
    await expect(page.locator('#error')).not.toContainText('Доступ к документу потерян');
    await expect(page.locator('.layer-drag-ghost')).toHaveCount(0);
    expect(f.calls).toHaveLength(1);
  });
}
