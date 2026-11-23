const { test, expect } = require('@playwright/test');
const { createDemo, HOST_ID } = require('./demo-overlay');

test('demo banner shows progress and does not block editor controls', async ({ page }) => {
  await page.setContent('<button style="position:fixed;top:18px;left:50%">Editor control</button>');
  const demo = createDemo(page, 2, { enabled: true, stepDelayMs: 0 });

  await demo.step('Добавляем поле ввода имени пользователя', 'Создаём TextInput с подсказкой Username.');
  const host = page.locator('#' + HOST_ID);
  await expect(host.locator('.title')).toHaveText('Добавляем поле ввода имени пользователя');
  await expect(host.locator('.description')).toHaveText('Создаём TextInput с подсказкой Username.');
  await expect(host.locator('.counter')).toHaveText('Шаг 1 из 2');
  await expect(host).toHaveCSS('bottom', '12px');
  await expect(host).toHaveCSS('top', 'auto');
  const banner = await host.boundingBox();
  expect(banner.y).toBeGreaterThan(500);
  expect(banner.height).toBeLessThan(110);
  await expect(host.locator('.progress')).toHaveAttribute('style', 'width: 50%;');
  await page.getByRole('button', { name: 'Editor control' }).click();

  await demo.step('Проверяем результат');
  await expect(host.locator('.title')).toHaveText('Проверяем результат');
  await expect(host.locator('.counter')).toHaveText('Шаг 2 из 2');
  await expect(host.locator('.description')).toBeHidden();
});

test('demo overlay is absent in normal test mode', async ({ page }) => {
  await page.setContent('<main>Editor</main>');
  const demo = createDemo(page, 1, { enabled: false, stepDelayMs: 0 });
  await demo.step('This step must not appear');
  await expect(page.locator('#' + HOST_ID)).toHaveCount(0);
});
