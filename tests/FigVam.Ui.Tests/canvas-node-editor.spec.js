const { test, expect, bearer } = require('./fixtures');
const { randomUUID } = require('node:crypto');

const number = value => ({ type: 'number', value });
const option = value => ({ type: 'enum', value });
const geometry = (x, y, width, height) => ({ x: number(x), y: number(y), width: number(width), height: number(height) });
const visual = id => `[data-visual-node="${id}"]`;

async function openCanvas(page, request) {
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
  await page.locator('#screens button').click();
  await expect(page.locator(`#screen-boundary ${visual(child)}`)).toBeVisible();
  await page.locator('#actual-size').click();
  return { frame, child, cover, stack, stackChild, layout, command, path: '**/commands/set-node-properties' };
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
