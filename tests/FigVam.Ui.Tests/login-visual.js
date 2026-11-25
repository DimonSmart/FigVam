const { test, expect } = require('./fixtures');

// A few stable interior and shadow pixels provide a visual regression without font-dependent baselines.
async function verifyLoginVisual(page, root, name) {
  const png = await root.screenshot({ animations: 'disabled', scale: 'css' });
  await test.info().attach(name, { body: png, contentType: 'image/png' });
  const colors = await page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    return [[10, 10], [235, 300], [270, 414], [214, 300], [270, 440]]
      .map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
  }, [...png]);
  expect(colors.slice(0, 3)).toEqual([[238, 242, 247, 255], [255, 255, 255, 255], [37, 99, 235, 255]]);
  expect(colors[3][0]).toBeLessThan(238);
  expect(colors[4][0]).toBeLessThan(255);
  expect(colors[4][2]).toBeGreaterThan(colors[4][0]);
}

module.exports = { verifyLoginVisual };
