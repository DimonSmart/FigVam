const { test, expect, bearer } = require('./fixtures');
const { randomUUID } = require('node:crypto');
const { show } = require('./ui-panels');

const headers = { Authorization: `Bearer ${bearer}` };
const str = value => ({ type: 'string', value });
const enumValue = value => ({ type: 'enum', value });

test('layer tree derives labels and keeps explicit names separate', async ({ page, request }) => {
  const documentId = randomUUID(), pageId = randomUUID(), screenId = randomUUID();
  const base = `/api/v1/documents/${documentId}`;
  const post = async (url, data) => {
    const response = await request.post(url, { headers, data });
    expect(response.ok(), `${url}: ${await response.text()}`).toBeTruthy();
    return response.json();
  };
  const command = (action, data) => post(`${base}/commands/${action}`, {
    commandId: randomUUID(), ...data
  });
  await post('/api/v1/documents', { documentId, name: 'Layer label captions' });
  await command('add-page', { pageId });
  await command('add-screen', { pageId, screenId, dimensions: { width: 800, height: 600 } });
  const add = async (kind, properties = {}) => {
    const nodeId = randomUUID();
    await command('add-node', { nodeId, parentId: screenId, kind, properties });
    return nodeId;
  };
  const textId = await add('Text', { text: str('Первая строка\nВторая строка') });
  const buttonId = await add('Button', { text: str('Войти') });
  const inputId = await add('TextInput', { placeholder: str('Username') });
  const frameId = await add('Frame');
  const namedId = await add('Text', { text: str('Заголовок документа') });
  await command('set-node-name', { nodeId: namedId, name: 'Моё имя' });
  const passwordId = await add('TextInput', { inputType: enumValue('Password'), value: str('secret-password') });

  await page.goto(`/documents/${documentId}`);
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.locator('#screens .screen-select').first().click();

  const row = id => page.locator(`#layers [role=treeitem][data-id="${id}"]`);
  const caption = id => row(id).locator('.layer-name');
  await expect(caption(textId)).toHaveText('Первая строка');
  await expect(caption(buttonId)).toHaveText('Войти');
  await expect(caption(inputId)).toHaveText('Username');
  await expect(caption(inputId)).toHaveAttribute('data-label-source', 'inferred');
  await expect(caption(inputId)).toHaveCSS('font-style', 'italic');
  await expect(caption(frameId)).toHaveText('Без имени');
  await expect(caption(frameId)).toHaveAttribute('data-label-source', 'missing');
  await expect(caption(namedId)).toHaveText('Моё имя');
  await expect(caption(namedId)).toHaveAttribute('data-label-source', 'explicit');
  await expect(caption(namedId)).toHaveCSS('font-style', 'normal');
  await expect(caption(passwordId)).toHaveText('Без имени');
  await expect(page.locator('#layers')).not.toContainText('secret-password');

  await row(inputId).locator(':scope > .layer-label').click();
  await expect(page.locator('#node-name')).toHaveValue('');
  await show(page, 'design');
  await page.locator('#visual-inspector').getByLabel('Подсказка', { exact: true }).fill('Email address');
  await expect(page.locator('#visual-inspector').getByRole('status')).toHaveText('Свойства сохранены.');
  await expect(caption(inputId)).toHaveText('Email address');
  await expect(caption(inputId)).toHaveAttribute('data-label-source', 'inferred');
  await expect(page.locator('#node-name')).toHaveValue('');
});
