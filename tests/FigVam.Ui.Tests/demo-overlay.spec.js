const { test, expect, bearer } = require('./fixtures');
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
  const panel = host.locator('.panel');
  await expect(panel).toHaveCSS('background-color', 'rgba(12, 18, 30, 0.92)');
  await expect(panel).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(host).toHaveCSS('position', 'fixed');
  await expect(host).toBeInViewport();
  const banner = await host.boundingBox();
  expect(banner.y + banner.height).toBeLessThanOrEqual(page.viewportSize().height);
  expect(banner.y).toBeGreaterThan(page.viewportSize().height / 2);
  expect(banner.height).toBeLessThan(110);
  await expect(host.locator('.progress')).toHaveAttribute('style', /width:\s*50%;?/);
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

test('demo panel stays visible in the real FigVam editor after navigating into a document', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();

  const demo = createDemo(page, 2, { enabled: true, stepDelayMs: 0 });
  await demo.step('Создаём документ', 'Демонстрационная панель должна быть видна.');

  const banner = page.locator('#' + HOST_ID);
  await expect(banner).toBeInViewport();
  // A real FigVam response enforces style-src 'self'. The panel must still
  // have a rendered translucent background (not just unstyled text).
  const panel = banner.locator('.panel');
  await expect(panel).toHaveCSS('background-color', 'rgba(12, 18, 30, 0.92)');
  await expect(panel).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(panel).toHaveCSS('border-top-style', 'solid');
  await expect(panel).toHaveCSS('border-top-width', '1px');
  await expect(panel).toHaveCSS('padding-top', '9px');
  await page.getByLabel('Имя нового документа').fill('Demo banner smoke');
  await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);

  await demo.step('Добавляем элементы', 'После навигации панель остаётся на экране.');
  await expect(banner.locator('.title')).toHaveText('Добавляем элементы');
  await expect(banner.locator('.description')).toHaveText('После навигации панель остаётся на экране.');
  await expect(banner).toBeInViewport();
  const coords = await banner.boundingBox();
  const viewport = page.viewportSize();
  expect(coords.y + coords.height).toBeLessThanOrEqual(viewport.height);
  expect(coords.x).toBeGreaterThanOrEqual(0);
  expect(coords.x + coords.width).toBeLessThanOrEqual(viewport.width);
  await page.screenshot({ path: test.info().outputPath('demo-panel.png') });
});

test('demo can use a browser-sized viewport instead of forcing a tall viewport', async ({ browser }) => {
  const page = await browser.newPage({ viewport: null });
  try {
    await page.goto('about:blank');
    const demo = createDemo(page, 1, { enabled: true, stepDelayMs: 0 });
    await demo.step('Нижняя подпись', 'Не должна оказаться ниже видимой области.');
    const host = page.locator('#' + HOST_ID);
    await expect(host).toBeInViewport();
    const rect = await host.boundingBox();
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    expect(rect.y + rect.height).toBeLessThanOrEqual(viewportHeight);
  } finally {
    await page.close();
  }
});
