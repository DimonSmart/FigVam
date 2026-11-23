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

test('composite typography and inherited text styles save only on explicit submit', async ({ page, request }) => {
  await open(page);
  const id = page.url().split('/').pop();
  const headers = { Authorization: `Bearer ${bearer}` };
  await page.locator('#new-token-name').fill('Heading');
  await page.locator('#new-token-type').selectOption('Typography');
  await expect(page.locator('#new-token-light-typography')).toBeVisible();
  await page.locator('#new-token-light-fontSize-value').fill('24');
  await page.locator('#new-token-dark-fontSize-value').fill('28');
  await page.getByRole('button', { name: 'Создать токен' }).click();
  await expect(page.locator('#token-detail-title')).toHaveText('Heading');

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
  await page.getByRole('button', { name: 'Сохранить стиль' }).click();
  await expect(page.locator('#styles-total')).toContainText('1');
  await expect(page.locator('#styles-preview')).toContainText('Light:');

  await page.locator('#styles-list').selectOption('');
  await page.locator('#styles-name').fill('text.heading');
  await page.locator('#styles-based-on').selectOption({ label: 'text.base' });
  await page.locator('input[aria-label="Начертание: переопределить"]').check();
  await page.locator('select[aria-label="Начертание"]').selectOption('Italic');
  await page.getByRole('button', { name: 'Сохранить стиль' }).click();
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
  await page.getByRole('button', { name: 'Сохранить стиль' }).click();
  await expect(page.locator('#styles-error')).toContainText('#RRGGBB');
  expect((await (await request.get(`/api/v1/documents/${id}/styles`, { headers })).json()).total).toBe(0);
  await page.locator('input[aria-label="Цвет рамки: значение"]').fill('#123456');
  await page.getByRole('button', { name: 'Сохранить стиль' }).click();
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
  await expect(page.locator('#tokens-list')).toContainText('type.body');

  await page.locator('#styles-name').fill('text.imported');
  await page.locator('input[aria-label="Типографика: переопределить"]').check();
  await page.locator('select[aria-label="Типографика: источник"]').selectOption('alias');
  await page.locator('select[aria-label="Типографика: ссылка на токен"]').selectOption({ label: 'type.body' });
  await page.getByRole('button', { name: 'Сохранить стиль' }).click();
  await expect(page.locator('#styles-total')).toContainText('1');
  await expect(page.locator('#styles-preview')).toContainText('Arial');

  const styles = await (await request.get(`/api/v1/documents/${id}/styles`, { headers })).json();
  expect(styles.items[0].fields.typography.type).toBe('token');
  const typography = await (await request.get(`/api/v1/documents/${id}/tokens`, { headers })).json();
  expect(styles.items[0].fields.typography.tokenId)
    .toBe(typography.items.find(t => t.name === 'type.body').id);
});
