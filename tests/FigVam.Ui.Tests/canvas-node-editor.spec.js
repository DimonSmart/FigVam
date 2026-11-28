const { test, expect, bearer } = require('./fixtures');
const { randomUUID } = require('node:crypto');

const number = value => ({ type: 'number', value });
const option = value => ({ type: 'enum', value });
const geometry = (x, y, width, height) => ({ x: number(x), y: number(y), width: number(width), height: number(height) });
const visual = id => `[data-visual-node="${id}"]`;

async function openCanvas(page, request, extraNodes = 0) {
  const documentId = randomUUID(), pageId = randomUUID(), screen = randomUUID();
  const base = `/api/v1/documents/${documentId}`, headers = { Authorization: `Bearer ${bearer}` };
  async function post(path, data) {
    const response = await request.post(path, { headers, data });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  const command = (name, data) => post(`${base}/commands/${name}`, { commandId: randomUUID(), ...data });
  async function node(parentId, kind, properties) {
    const nodeId = randomUUID();
    await command('add-node', { nodeId, parentId, kind, properties });
    return nodeId;
  }
  await post('/api/v1/documents', { documentId, name: 'Жесты на холсте' });
  await command('add-page', { pageId });
  await command('add-screen', { pageId, screenId: screen, dimensions: { width: 500, height: 350 } });
  const frame = await node(screen, 'Frame', {
    ...geometry(24, 25, 180, 140), paddingLeft: number(10), paddingTop: number(12), overflow: option('Clip')
  });
  const child = await node(frame, 'Button', geometry(20, 18, 82, 42));
  const cover = await node(frame, 'Text', geometry(20, 18, 16, 14));
  for (let i = 0; i < extraNodes; i++)
    await node(screen, 'Text', geometry(390 + (i % 8) * 12, 110 + Math.floor(i / 8) * 15, 9, 9));
  const stack = await node(screen, 'Frame', { ...geometry(250, 35, 110, 120), layout: option('Vertical') });
  const stackChild = await node(stack, 'Text', geometry(20, 18, 80, 30));
  const layout = async () => {
    const response = await request.get(`${base}/screens/${screen}/layout`, { headers });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  await page.setViewportSize({ width: 1800, height: 1100 });
  await page.goto(`/documents/${documentId}`);
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.locator('#screens button.screen-select').click();
  await expect(page.locator(`#screen-boundary ${visual(child)}`)).toBeVisible();
  await page.locator('#actual-size').click();
  await expect(page.locator('#connection-status')).toContainText('Подключено', { timeout: 15000 });
  return { frame, child, cover, stack, stackChild, layout, command, base, headers, path: '**/commands/set-node-properties' };
}

async function point(locator, fractionX = 0.5, fractionY = 0.5) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width * fractionX, y: box.y + box.height * fractionY };
}

async function startDrag(page, locator, options = {}) {
  const { x, y } = await point(locator);
  await page.mouse.move(x, y);
  await page.mouse.down(options);
  return (dx, dy) => page.mouse.move(x + dx, y + dy, { steps: 4 });
}

const nodeBounds = (layout, id) => layout.boxes.find(box => box.objectId === id).bounds;

test('moves and resizes a nested layer with an atomic command per gesture after zooming', async ({ page, request }) => {
  const { frame, child, cover, layout, path } = await openCanvas(page, request);
  const node = page.locator(visual(child)), original = await layout();
  const commands = [];
  await page.route(path, async route => {
    commands.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.locator('#zoom-in').click();
  await expect(page.locator('#zoom-level')).toHaveText('125%');
  const hit = await point(page.locator(visual(cover)));
  await page.mouse.click(hit.x, hit.y);
  await expect(page.locator(visual(cover))).toHaveAttribute('data-selected', 'true');
  const move = await startDrag(page, node);
  await move(25, 15);
  await expect(node).toHaveCSS('left', '50px');
  await expect(node).toHaveCSS('top', '42px');
  await expect(page.locator(`#layers [data-id="${child}"]`)).toHaveAttribute('aria-selected', 'true');
  expect(commands).toHaveLength(0);
  expect(await layout()).toEqual(original);
  await page.mouse.up();
  await expect(page.locator('#canvas-edit-status')).toHaveText('Геометрия сохранена.');
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    nodeId: child, expectedParentId: frame, expectedRevision: original.revision,
    properties: { x: number(40), y: number(30) }
  });
  const moved = await layout();
  expect(moved.revision).toBe(original.revision + 1);
  expect(nodeBounds(moved, child)).toEqual({ x: 74, y: 67, width: 82, height: 42 });

  const handle = node.locator('.canvas-resize-handle');
  await expect(handle).toBeVisible();
  const resize = await startDrag(page, handle);
  await resize(30, 25);
  await expect(node).toHaveCSS('width', '106px');
  await expect(node).toHaveCSS('height', '62px');
  expect(commands).toHaveLength(1);
  expect(await layout()).toEqual(moved);
  await page.mouse.up();
  await expect(page.locator('#canvas-edit-status')).toHaveText('Геометрия сохранена.');
  expect(commands).toHaveLength(2);
  expect(commands[1]).toMatchObject({
    nodeId: child, expectedParentId: frame, expectedRevision: moved.revision,
    properties: { width: number(106), height: number(62) }
  });
  const resized = await layout();
  expect(resized.revision).toBe(moved.revision + 1);
  expect(nodeBounds(resized, child)).toEqual({ x: 74, y: 67, width: 106, height: 62 });
});

test('clips the local preview and restores it on cancellation or a real server rejection', async ({ page, request }) => {
  const { child, frame, layout, command, path } = await openCanvas(page, request);
  const node = page.locator(visual(child)), original = await layout();
  let sent = 0;
  await page.route(path, async route => {
    sent++;
    await command('set-node-name', { nodeId: child, name: 'Параллельное изменение' });
    await route.continue();
  });
  const move = await startDrag(page, node);
  await move(110, 20);
  await expect(node).toHaveCSS('left', '140px');
  const hits = await page.locator(visual(frame)).evaluate((parent, child) => {
    const box = parent.getBoundingClientRect();
    return [-2, 2].map(dx => document.elementFromPoint(box.right + dx, box.top + 60)
      ?.closest('[data-visual-node]')?.dataset.visualNode === child);
  }, child);
  expect(hits).toEqual([true, false]);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(node).toHaveCSS('left', '30px');
  expect(sent).toBe(0);

  const rejected = await startDrag(page, node);
  await rejected(30, 20);
  await expect(node).toHaveCSS('left', '60px');
  await page.mouse.up();
  await expect(page.locator('#canvas-edit-error')).toContainText(/revision|ревизи/i);
  await expect(node).toHaveCSS('left', '30px');
  expect(sent).toBe(1);
  const latest = await layout();
  expect(latest.revision).toBe(original.revision + 1);
  expect(nodeBounds(latest, child)).toEqual(nodeBounds(original, child));
});

test('pans separately, blocks direct stack geometry edits and supports keyboard geometry', async ({ page, request }) => {
  const { child, stackChild, layout, path } = await openCanvas(page, request);
  const node = page.locator(visual(child)), stackNode = page.locator(visual(stackChild));
  const boundary = page.locator('#screen-boundary'), viewport = page.locator('#viewport');
  const transform = () => boundary.evaluate(item => item.style.transform);
  const original = await layout();
  const commands = [];
  await page.route(path, async route => {
    commands.push(route.request().postDataJSON());
    await route.continue();
  });
  await node.locator('.visual-surface').click();
  const beforePan = await transform();
  await page.keyboard.down('Alt');
  const pan = await startDrag(page, node);
  await pan(28, 20);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  expect(await transform()).not.toBe(beforePan);
  const afterAlt = await transform();
  const middlePan = await startDrag(page, node, { button: 'middle' });
  await middlePan(-15, -10);
  await page.mouse.up({ button: 'middle' });
  expect(await transform()).not.toBe(afterAlt);
  await expect(node).toHaveAttribute('data-selected', 'true');
  await page.locator('#zoom-out').click();
  expect(await layout()).toEqual(original);

  const beforeStackDrag = await transform();
  const stackDrag = await startDrag(page, stackNode);
  await stackDrag(36, 24);
  await page.mouse.up();
  await expect(stackNode).toHaveAttribute('data-selected', 'true');
  await expect(stackNode.locator('.canvas-resize-handle')).toHaveCount(0);
  await expect(page.locator('#canvas-edit-hint')).toContainText('задаёт стек');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  expect(await transform()).toBe(beforeStackDrag);
  expect(commands).toHaveLength(0);
  expect(await layout()).toEqual(original);

  await node.locator('.visual-surface').click();
  await expect(viewport).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#canvas-edit-status')).toHaveText('Геометрия сохранена.');
  await expect(node).toHaveCSS('left', '29px');
  const updated = await layout();
  expect(commands[0].properties).toEqual({ x: number(19) });
  expect(nodeBounds(updated, child).x).toBe(nodeBounds(original, child).x - 1);
  await expect(node.locator('.canvas-resize-handle')).toBeVisible();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.locator('#canvas-edit-status')).toHaveText('Геометрия сохранена.');
  await expect(node).toHaveCSS('height', '43px');
  expect(commands[1].properties).toEqual({ height: number(43) });
  await page.keyboard.press('Alt+ArrowDown');
  expect(await transform()).not.toBe(beforeStackDrag);
  expect((await layout()).revision).toBe(original.revision + 2);

  page.once('dialog', dialog => dialog.accept());
  await page.keyboard.press('Delete');
  await expect(node).toHaveCount(0);
  expect((await layout()).revision).toBe(original.revision + 3);
});

test('keeps canvas nodes, layers and inspector fields alive after an automatic edit and local move', async ({ page, request }) => {
  const { child, cover, path } = await openCanvas(page, request);
  const node = page.locator(visual(child));
  await node.locator('.visual-surface').click();
  const draft = page.locator('#visual-property-text');
  await expect(draft).toBeVisible();
  await draft.fill('Изменённый текст');
  await expect(page.locator('#visual-inspector-status')).toHaveText('Свойства сохранены.');
  await page.evaluate(({ child, cover }) => {
    window.__stableEditor = {
      moved: document.querySelector(`[data-visual-node="${child}"]`),
      neighbor: document.querySelector(`[data-visual-node="${cover}"]`),
      layer: document.querySelector(`#layers [data-id="${child}"]`),
      width: document.querySelector('#visual-property-width'),
      text: document.querySelector('#visual-property-text'),
      boundary: document.querySelector('#screen-boundary')
    };
  }, { child, cover });
  const calls = [];
  await page.route(path, route => { calls.push(route.request().postDataJSON()); return route.continue(); });
  const move = await startDrag(page, node);
  await move(30, 20);
  expect(calls).toHaveLength(0);
  await page.mouse.up();
  await expect(page.locator('#canvas-edit-status')).toHaveText('Геометрия сохранена.');
  expect(calls).toHaveLength(1);
  expect(await page.evaluate(() => {
    const stable = window.__stableEditor;
    return {
      moved: stable.moved.isConnected && stable.moved === document.querySelector(`[data-visual-node="${stable.moved.dataset.visualNode}"]`),
      neighbor: stable.neighbor.isConnected,
      layer: stable.layer.isConnected && stable.layer === document.querySelector(`#layers [data-id="${stable.layer.dataset.id}"]`),
      width: stable.width === document.querySelector('#visual-property-width'),
      text: stable.text === document.querySelector('#visual-property-text'),
      draft: stable.text.value,
      boundary: stable.boundary === document.querySelector('#screen-boundary')
    };
  })).toEqual({
    moved: true, neighbor: true, layer: true, width: true, text: true,
    draft: 'Изменённый текст', boundary: true
  });
});

test('reconciles a remote property change without destroying the active inspector draft', async ({ page, request }) => {
  const { child, cover, command } = await openCanvas(page, request);
  const node = page.locator(visual(child));
  await node.locator('.visual-surface').click();
  const draft = page.locator('#visual-property-text');
  await expect(draft).toBeVisible();
  await draft.fill('Локальное изменение');
  await expect(page.locator('#visual-inspector-status')).toHaveText('Свойства сохранены.');
  await page.evaluate(({ child, cover }) => {
    window.__remoteStable = {
      selected: document.querySelector(`[data-visual-node="${child}"]`),
      neighbor: document.querySelector(`[data-visual-node="${cover}"]`),
      layer: document.querySelector(`#layers [data-id="${child}"]`),
      field: document.querySelector('#visual-property-text'),
      width: document.querySelector('#visual-property-width')
    };
  }, { child, cover });
  const previousRevision = Number((await page.locator('#revision').textContent()).match(/\d+$/)[0]);
  await command('set-node-properties', { nodeId: child, properties: { width: number(95) } });
  await expect(page.locator('#revision')).toContainText(`ревизия ${previousRevision + 1}`);
  await expect(node).toHaveCSS('width', '95px', { timeout: 15000 });
  await expect(page.locator('#visual-property-width')).toHaveValue('95');
  expect(await page.evaluate(() => {
    const stable = window.__remoteStable;
    return {
      selected: stable.selected.isConnected && stable.selected === document.querySelector(`[data-visual-node="${stable.selected.dataset.visualNode}"]`),
      neighbor: stable.neighbor.isConnected,
      layer: stable.layer.isConnected && stable.layer === document.querySelector(`#layers [data-id="${stable.layer.dataset.id}"]`),
      field: stable.field === document.querySelector('#visual-property-text'),
      width: stable.width === document.querySelector('#visual-property-width'),
      draft: stable.field.value
    };
  })).toEqual({
    selected: true, neighbor: true, layer: true, field: true, width: true,
    draft: 'Локальное изменение'
  });
});

test('moving one layer in a populated screen never recreates unrelated nodes', async ({ page, request }) => {
  const { child } = await openCanvas(page, request, 36);
  const node = page.locator(visual(child));
  await node.locator('.visual-surface').click();
  await page.evaluate(() => {
    window.__crowded = [...document.querySelectorAll('#screen-boundary [data-visual-node]')];
  });
  const move = await startDrag(page, node);
  await move(20, 10);
  await page.mouse.up();
  await expect(page.locator('#canvas-edit-status')).toHaveText('Геометрия сохранена.');
  expect(await page.evaluate(() => {
    const elements = window.__crowded;
    return {
      count: elements.length,
      detached: elements.filter(el => !el.isConnected || document.querySelector(
        `#screen-boundary [data-visual-node="${el.dataset.visualNode}"]`) !== el).length
    };
  })).toEqual({ count: 41, detached: 0 });
});

test('atomic node edit batch moves two nodes, rolls back on failure, and supports undo and redo', async ({ page, request }) => {
  const { frame, child, cover, layout, command, base, headers } = await openCanvas(page, request);
  const original = await layout();
  const edits = [
    { action: 'set', nodeId: child, expectedParentId: frame, properties: { x: number(35) } },
    { action: 'set', nodeId: cover, expectedParentId: frame, properties: { x: number(45) } }
  ];
  await command('edit-nodes', { expectedRevision: original.revision, operations: edits });
  const moved = await layout();
  expect(moved.revision).toBe(original.revision + 1);
  expect(nodeBounds(moved, child).x).toBe(nodeBounds(original, child).x + 15);
  expect(nodeBounds(moved, cover).x).toBe(nodeBounds(original, cover).x + 25);
  const rejected = await request.post(base + '/commands/edit-nodes', { headers, data: {
    commandId: randomUUID(), expectedRevision: moved.revision, operations: [
      { ...edits[0], properties: { x: number(99) } },
      { ...edits[1], nodeId: randomUUID() }
    ]
  }});
  expect(rejected.ok()).toBeFalsy();
  expect(await layout()).toEqual(moved);
  await command('undo', {});
  const undone = await layout();
  expect(nodeBounds(undone, child)).toEqual(nodeBounds(original, child));
  expect(nodeBounds(undone, cover)).toEqual(nodeBounds(original, cover));
  await command('redo', {});
  const redone = await layout();
  expect(nodeBounds(redone, child)).toEqual(nodeBounds(moved, child));
  expect(nodeBounds(redone, cover)).toEqual(nodeBounds(moved, cover));
});

test('modifier selection on canvas is mirrored in the layer tree', async ({ page, request }) => {
  const { child, cover } = await openCanvas(page, request);
  const a = await point(page.locator(visual(child)), 0.75, 0.75);
  const b = await point(page.locator(visual(cover)));
  await page.mouse.click(a.x, a.y);
  await page.keyboard.down('Control');
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up('Control');
  for (const id of [child, cover]) {
    await expect(page.locator(visual(id))).toHaveAttribute('data-selected', 'true');
    await expect(page.locator('#layers [data-id="' + id + '"]')).toHaveAttribute('aria-selected', 'true');
  }
});
