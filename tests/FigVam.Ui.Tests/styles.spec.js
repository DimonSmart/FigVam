const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');

async function open(page) {
  await page.goto('/');
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByLabel('Имя нового документа').fill('Style editor');
  await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await show(page, 'assets');
  await expect(page.getByRole('heading', { name: 'Стили оформления' })).toBeVisible();
}

test('new composite typography and inherited text styles require explicit creation', async ({ page, request }) => {
  await open(page);
  const id = page.url().split('/').pop();
  const headers = { Authorization: `Bearer ${bearer}` };
  await show(page, 'tokens');
  await page.locator('#token-menu-open').click(); await page.locator('#new-token-open').click();
  await page.locator('#new-token-name').fill('Heading');
  await page.locator('#new-token-type').selectOption('Typography');
  await expect(page.locator('#new-token-light-typography')).toBeVisible();
  await page.locator('#new-token-light-fontSize-value').fill('24');
  await page.locator('#new-token-dark-fontSize-value').fill('28');
  await page.getByRole('button', { name: 'Создать токен' }).click();
  await expect(page.locator('#token-detail-title')).toHaveText('Heading');

  await show(page, 'assets');
  await page.locator('#styles-name').fill('text.base');
  await page.locator('input[aria-label="Типографика: переопределить"]').check();
  await page.locator('select[aria-label="Типографика: источник"]').selectOption('alias');
  await page.locator('select[aria-label="Типографика: ссылка на токен"]').selectOption({ label: 'Heading' });
  await page.locator('input[aria-label="Цвет текста: переопределить"]').check();

  // Source selection and keyboard input are local drafts until Save.
  await page.locator('#styles-name').focus();
  await page.keyboard.press('End');
  const uncommitted = await (await request.get(`/api/v1/documents/${id}/styles`, { headers })).json();
  expect(uncommitted.total).toBe(0);
  await page.getByRole('button', { name: 'Создать стиль' }).click();
  await expect(page.locator('#styles-total')).toContainText('1');
  await expect(page.locator('#styles-preview')).toContainText('Light:');

  await page.locator('#styles-list').selectOption('');
  await page.locator('#styles-name').fill('text.heading');
  await page.locator('#styles-based-on').selectOption({ label: 'text.base' });
  await page.locator('input[aria-label="Начертание: переопределить"]').check();
  await page.locator('select[aria-label="Начертание"]').selectOption('Italic');
  await page.getByRole('button', { name: 'Создать стиль' }).click();
  await expect(page.locator('#styles-total')).toContainText('2');
  const persisted = await (await request.get(`/api/v1/documents/${id}/styles`, { headers })).json();
  const base = persisted.items.find(item => item.name === 'text.base');
  const heading = persisted.items.find(item => item.name === 'text.heading');
  expect(base.fields.typography.type).toBe('token');
  expect(heading.basedOnStyleId).toBe(base.id);
  expect(heading.fields.fontStyle.value).toBe('Italic');

  await page.locator('#styles-list').selectOption(heading.id);
  await expect(page.locator('#styles-preview')).toContainText('textColor');
});

test('border style editor supports partial fields and rejects invalid color without saving', async ({ page, request }) => {
  await open(page);
  const id = page.url().split('/').pop();
  const headers = { Authorization: `Bearer ${bearer}` };
  await page.locator('#styles-type').selectOption('BorderStyle');
  await page.locator('#styles-name').fill('border.primary');
  await page.locator('input[aria-label="Радиус углов: переопределить"]').check();
  await page.locator('input[aria-label="Радиус углов: значение"]').fill('8');
  await page.locator('input[aria-label="Цвет рамки: переопределить"]').check();
  await page.locator('input[aria-label="Цвет рамки: значение"]').fill('bad');
  await page.getByRole('button', { name: 'Создать стиль' }).click();
  await expect(page.locator('#styles-error')).toContainText('#RRGGBB');
  expect((await (await request.get(`/api/v1/documents/${id}/styles`, { headers })).json()).total).toBe(0);
  await page.locator('input[aria-label="Цвет рамки: значение"]').fill('#123456');
  await page.getByRole('button', { name: 'Создать стиль' }).click();
  await expect(page.locator('#styles-total')).toContainText('1');
  const persisted = await (await request.get(`/api/v1/documents/${id}/styles`, { headers })).json();
  expect(persisted.items[0].type).toBe(1);
  expect(persisted.items[0].fields.cornerRadius.value).toBe(8);
});

test('DTCG import is visible and imported typography can be applied to a reusable text style', async ({ page, request }) => {
  await open(page);
  const { randomUUID } = require('node:crypto');
  const id = page.url().split('/').pop();
  const headers = { Authorization: `Bearer ${bearer}` };
  const makeTheme = size => ({
    font: { size: { body: {
      $type: 'dimension',
      $value: { value: size, unit: 'px' },
      $extensions: { 'org.figvam': { type: 'Dimension', category: 'FontSize' } }
    } } },
    type: { body: { $type: 'typography',
      $value: {
        fontFamily: 'Arial', fontSize: '{font.size.body}',
        fontWeight: 400, letterSpacing: { value: -0.5, unit: 'px' }, lineHeight: 1.25
      }
    } }
  });
  const imported = await request.post(`/api/v1/documents/${id}/commands/import-design-tokens`, {
    headers,
    data: {
      commandId: randomUUID(), expectedRevision: 0,
      lightJson: JSON.stringify(makeTheme(16)),
      darkJson: JSON.stringify(makeTheme(19)),
      dimensionTypes: {}
    }
  });
  expect(imported.ok(), await imported.text()).toBeTruthy();
  await show(page, 'tokens');
  await expect(page.locator('#tokens-list')).toContainText('type.body');
  await show(page, 'assets');

  await page.locator('#styles-name').fill('text.imported');
  await page.locator('input[aria-label="Типографика: переопределить"]').check();
  await page.locator('select[aria-label="Типографика: источник"]').selectOption('alias');
  await page.locator('select[aria-label="Типографика: ссылка на токен"]').selectOption({ label: 'type.body' });
  await page.getByRole('button', { name: 'Создать стиль' }).click();
  await expect(page.locator('#styles-total')).toContainText('1');
  await expect(page.locator('#styles-preview')).toContainText('Arial');

  const styles = await (await request.get(`/api/v1/documents/${id}/styles`, { headers })).json();
  expect(styles.items[0].fields.typography.type).toBe('token');
  const typography = await (await request.get(`/api/v1/documents/${id}/tokens`, { headers })).json();
  expect(styles.items[0].fields.typography.tokenId)
    .toBe(typography.items.find(t => t.name === 'type.body').id);
});

test('inline typography preview resolves nested font-size aliases independently for Light and Dark', async ({ page }) => {
  await open(page);
  await show(page, 'tokens');
  await page.locator('#token-menu-open').click(); await page.locator('#new-token-open').click();
  await page.getByLabel('Имя токена', { exact: true }).fill('Font Size');
  await page.locator('#new-token-type').selectOption('Dimension');
  await page.locator('#new-token-category').selectOption('FontSize');
  await page.getByLabel('Light', { exact: true }).fill('18');
  await page.getByLabel('Dark', { exact: true }).fill('22');
  await page.getByRole('button', { name: 'Создать токен' }).click();
  await expect(page.locator('#token-detail-title')).toHaveText('Font Size');

  await show(page, 'assets');
  await page.locator('#styles-name').fill('text.inline');
  await page.locator('input[aria-label="Типографика: переопределить"]').check();
  await page.locator('select[aria-label="Размер: источник"]').selectOption('alias');
  await page.locator('select[aria-label="Размер: токен"]').selectOption({ label: 'Font Size' });
  await page.getByRole('button', { name: 'Создать стиль' }).click();
  await expect(page.locator('#styles-total')).toContainText('1');
  const preview = page.locator('#styles-preview');
  await expect(preview).toContainText('Light: typography = Arial · 18 px');
  await expect(preview).toContainText('Dark: typography = Arial · 22 px');
  await expect(preview).not.toContainText('typography = —');
});

test('existing styles apply valid changes automatically and reject invalid intermediate input', async ({ page, request }) => {
  await open(page);
  const id = page.url().split('/').pop();
  const headers = { Authorization: `Bearer ${bearer}` };
  await page.locator('#styles-type').selectOption('BorderStyle');
  await page.locator('#styles-name').fill('border.auto');
  await page.getByLabel('Радиус углов: переопределить').check();
  await page.getByLabel('Радиус углов: значение').fill('8');
  await page.getByRole('button', { name: 'Создать стиль' }).click();
  await expect(page.locator('#styles-total')).toContainText('1');
  await expect(page.locator('#styles-save')).toBeHidden();
  const read = async () => (await (await request.get(`/api/v1/documents/${id}/styles`, { headers })).json()).items[0];
  const radius = page.getByLabel('Радиус углов: значение');
  await radius.fill('bad'); await radius.press('Enter');
  await expect(page.locator('#styles-error')).toContainText('Введите число');
  expect((await read()).fields.cornerRadius.value).toBe(8);
  await radius.fill('12'); await radius.press('Tab');
  await expect.poll(async () => (await read()).fields.cornerRadius.value).toBe(12);
  await expect(page.locator('#styles-status')).toHaveText('Стиль сохранён.');
  await page.locator('#styles-name').fill('border.renamed');
  await page.locator('#styles-name').press('Enter');
  await expect.poll(async () => (await read()).name).toBe('border.renamed');
  await expect(page.locator('#styles-status')).toHaveText('Стиль сохранён.');
  await page.getByLabel('Радиус углов: переопределить').uncheck();
  await expect.poll(async () => (await read()).fields.cornerRadius).toBeUndefined();
});

test('automatic style edits queue newer input during an acknowledgement without replacing another field', async ({ page, request }) => {
  await open(page);
  const id = page.url().split('/').pop();
  const headers = { Authorization: `Bearer ${bearer}` };
  await page.locator('#styles-type').selectOption('BorderStyle');
  await page.locator('#styles-name').fill('border.queue');
  await page.getByLabel('Радиус углов: переопределить').check();
  await page.getByLabel('Толщина рамки: переопределить').check();
  await page.getByRole('button', { name: 'Создать стиль' }).click();
  await expect(page.locator('#styles-save')).toBeHidden();
  await expect(page.locator('#styles-status')).toHaveText('Стиль сохранён.');
  let release, count = 0;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/commands/upsert-style', async route => {
    if (++count === 1) await gate;
    await route.continue();
  });
  const radius = page.getByLabel('Радиус углов: значение');
  const width = page.getByLabel('Толщина рамки: значение');
  await radius.fill('12'); await radius.press('Enter');
  await expect.poll(() => count).toBe(1);
  await radius.fill('16'); await radius.press('Enter');
  await width.fill('3'); await width.press('Enter');
  release();
  const read = async () => (await (await request.get(`/api/v1/documents/${id}/styles`, { headers })).json()).items[0];
  await expect.poll(async () => [(await read()).fields.cornerRadius.value, (await read()).fields.borderWidth.value]).toEqual([16, 3]);
  await expect(page.locator('#styles-status')).toHaveText('Стиль сохранён.');
  await expect(radius).toHaveValue('16');
  await expect(width).toHaveValue('3');
  expect(count).toBe(2);
});
