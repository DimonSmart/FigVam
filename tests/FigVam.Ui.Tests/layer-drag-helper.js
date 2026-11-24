const { expect } = require('./fixtures');

const layerRow = (page, id) => page.locator(`#layers [role=treeitem][data-id="${id}"]`);
const label = (page, id) => layerRow(page, id).locator(':scope > .layer-label');

async function point(page, id, fraction = .5) {
  const target = label(page, id);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('Layer is not visible: ' + id);
  return { x: box.x + Math.min(45, box.width / 2), y: box.y + box.height * fraction };
}

async function startLayerDrag(page, id) {
  const from = await point(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y, { steps: 2 });
  await expect(page.locator('.layer-drag-ghost')).toBeVisible();
}

async function hoverLayer(page, id, zone = 'inside') {
  const p = await point(page, id, ({ before: .1, inside: .5, after: .9 })[zone]);
  await page.mouse.move(p.x, p.y, { steps: 4 });
}

async function dragLayer(page, source, target, zone = 'inside') {
  await startLayerDrag(page, source);
  await hoverLayer(page, target, zone);
  await expect(layerRow(page, target)).toHaveAttribute('data-layer-drop', zone);
  await page.mouse.up();
  await expect(page.locator('.layer-drag-ghost')).toHaveCount(0);
}

module.exports = { layerRow, label, startLayerDrag, hoverLayer, dragLayer };
