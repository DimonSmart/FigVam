const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');

async function signIn(page) {
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
}

async function createScreen(page, name) {
  await show(page, 'screen');
  await page.getByLabel('Ширина экрана').fill('800');
  await page.getByLabel('Высота экрана').fill('600');
  const posted = page.waitForResponse(response => response.url().endsWith('/commands/add-screen'));
  await page.getByRole('button', { name: 'Создать экран', exact: true }).click();
  const created = await posted;
  expect(created.ok(), await created.text()).toBeTruthy();
  const screenId = (await created.json()).screenId;
  await expect(page.locator(`#screens .screen-select[data-screen-id="${screenId}"]`))
    .toHaveAttribute('aria-pressed', 'true');
  await page.locator('#screens .screen-select[aria-pressed="true"]')
    .locator('..').locator('.screen-rename-action').click();
  await page.locator('#screen-name-input').fill(name);
  await page.locator('#screens .screen-rename-confirm').click();
  await expect(page.locator('#screens .screen-select[aria-pressed="true"]')).toContainText(name);
  return screenId;
}

async function addLayer(page, kind, parentId) {
  await show(page, 'layers');
  if (parentId) await page.locator(`#layers [data-id="${parentId}"] > .layer-label`).click();
  await show(page, 'palette');
  await page.getByLabel('Вид элемента').selectOption(kind);
  const posted = page.waitForResponse(response => response.url().endsWith('/commands/add-node'));
  await page.getByRole('button', { name: 'Добавить элемент', exact: true }).click();
  const response = await posted;
  expect(response.ok(), await response.text()).toBeTruthy();
  const id = (await response.json()).nodeId;
  await expect(page.locator(`#layers [data-id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
  return id;
}

async function selectLayer(page, id) {
  await show(page, 'layers');
  await page.locator(`#layers [data-id="${id}"] > .layer-label`).click();
  await show(page, 'design');
}

async function saveProperties(page, values = {}, toggles = {}, enums = {}) {
  const inspector = page.locator('#visual-inspector');
  for (const [label, value] of Object.entries(values))
    await inspector.getByLabel(label, { exact: true }).fill(String(value));
  for (const [label, checked] of Object.entries(toggles)) {
    const box = inspector.getByRole('checkbox', { name: label });
    if (checked) await box.check(); else await box.uncheck();
  }
  for (const [label, value] of Object.entries(enums))
    await inspector.getByRole('combobox', { name: label }).selectOption(value);
  await inspector.getByRole('button', { name: 'Сохранить свойства', exact: true }).click();
  await expect(inspector.getByRole('status')).toHaveText('Свойства сохранены.');
}

async function addVariant(page, name) {
  await show(page, 'layers');
  await page.getByLabel('Имя нового варианта').fill(name);
  const posted = page.waitForResponse(response => response.url().endsWith('/commands/add-screen-variant'));
  await page.getByRole('button', { name: 'Создать пустой вариант' }).click();
  const response = await posted;
  expect(response.ok(), await response.text()).toBeTruthy();
  const variantId = response.request().postDataJSON().variantId;
  await expect(page.locator(`#screen-variants-list [data-variant-id="${variantId}"]`)).toHaveAttribute('aria-pressed', 'true');
  return variantId;
}

async function useVariant(page, variantId) {
  await show(page, 'layers');
  await page.locator(`#screen-variants-list [data-variant-id="${variantId ?? ''}"]`).click();
  await expect(page.locator(`#screen-variants-list [data-variant-id="${variantId ?? ''}"]`)).toHaveAttribute('aria-pressed', 'true');
}

async function scenario(page, layerId, eventId, action, variantId, targetScreen) {
  await selectLayer(page, layerId);
  await show(page, 'prototype');
  await expect(page.locator('#scenario-create')).toBeVisible();
  await page.locator('#scenario-event').selectOption(String(eventId));
  if (variantId !== undefined) await page.locator('#scenario-variant').selectOption(variantId ?? '');
  if (targetScreen) await page.locator('#scenario-target').selectOption(targetScreen);
  await expect(page.locator(`#scenario-action option[value="${action}"]`)).toHaveCount(1);
  await page.locator('#scenario-action').selectOption(action);
  await expect(page.locator('#scenario-create-submit')).toBeEnabled();
  const posted = page.waitForResponse(response => response.url().endsWith('/commands/create-scenario'));
  await page.locator('#scenario-create-submit').click();
  const response = await posted;
  expect(response.ok(), await response.text()).toBeTruthy();
}

test('designs a login with password, independent variants, scenarios, duplication and reload through UI', async ({ page, request, server, browser }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1700, height: 1100 });
  await page.goto(server.url);
  await signIn(page);
  await page.getByLabel('Имя нового документа').fill('Login Prototype');
  await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  const documentPath = new URL(page.url()).pathname;
  const read = async () => {
    const result = await request.get(`${server.url}/api/v1${documentPath}/document.json`, {
      headers: { Authorization: `Bearer ${bearer}` }
    });
    expect(result.ok(), await result.text()).toBeTruthy();
    return (await result.json()).document;
  };

  await page.getByRole('button', { name: 'Создать страницу' }).click();
  const loginScreen = await createScreen(page, 'Login');
  const frame = await addLayer(page, 'Frame');
  await saveProperties(page, { X: 50, Y: 40, 'Ширина': 450, 'Высота': 370 });
  const title = await addLayer(page, 'Text', frame);
  await saveProperties(page, { X: 20, Y: 20, 'Текст': 'Sign in' });
  const username = await addLayer(page, 'TextInput', frame);
  await saveProperties(page, { X: 20, Y: 85, 'Подсказка': 'Username' });
  const password = await addLayer(page, 'TextInput', frame);
  await saveProperties(page, { X: 20, Y: 145, 'Подсказка': 'Password' }, {}, { 'Тип ввода': 'Password' });
  const loginButton = await addLayer(page, 'Button', frame);
  await saveProperties(page, { X: 20, Y: 205, 'Текст': 'Login' });
  const error = await addLayer(page, 'Text', frame);
  await saveProperties(page, { X: 20, Y: 260, 'Текст': 'Invalid password' }, { 'Видимость': false });
  const locked = await addLayer(page, 'Text', frame);
  await saveProperties(page, { X: 20, Y: 295, 'Текст': 'Account locked' }, { 'Видимость': false });
  const lockedButton = await addLayer(page, 'Button', frame);
  await saveProperties(page, { X: 200, Y: 205, 'Текст': 'Lock account' });
  const successButton = await addLayer(page, 'Button', frame);
  await saveProperties(page, { X: 200, Y: 260, 'Текст': 'Continue' });

  const invalidVariant = await addVariant(page, 'InvalidPassword');
  await selectLayer(page, error);
  await saveProperties(page, {}, { 'Видимость': true });
  const lockedVariant = await addVariant(page, 'AccountLocked');
  await selectLayer(page, locked);
  await saveProperties(page, {}, { 'Видимость': true });
  await selectLayer(page, loginButton);
  await saveProperties(page, {}, { 'Доступность': false });
  await useVariant(page, invalidVariant);
  await selectLayer(page, error);
  await expect(page.locator('#visual-properties [data-variant-override="true"]')).not.toHaveCount(0);
  await useVariant(page, null);
  await selectLayer(page, error);
  await expect(page.locator('#visual-inspector').getByRole('checkbox', { name: 'Видимость' })).not.toBeChecked();
  const baseBefore = await read();

  const successScreen = await createScreen(page, 'Success');
  const successText = await addLayer(page, 'Text');
  await saveProperties(page, { 'Текст': 'Welcome!' });
  await show(page, 'layers');
  await page.locator(`#screens .screen-select`).filter({ hasText: 'Login' }).click();
  await expect(page.locator('#screen-variants-list')).toContainText('AccountLocked');

  await scenario(page, loginButton, 0, 'showVariant', invalidVariant);
  await scenario(page, password, 4, 'showVariant', invalidVariant);
  await scenario(page, lockedButton, 0, 'showVariant', lockedVariant);
  await scenario(page, successButton, 0, 'navigate', undefined, successScreen);

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const loginRoot = page.locator(`#preview-viewport [data-preview-screen="${loginScreen}"]`);
  const secret = loginRoot.locator(`[data-visual-node="${password}"] input`);
  await expect(secret).toHaveAttribute('type', 'password');
  await secret.fill('example-only');
  await secret.press('Enter');
  await expect(loginRoot).toContainText('Invalid password');
  await page.getByRole('button', { name: 'Сбросить Preview' }).click();
  await loginRoot.getByRole('button', { name: 'Lock account' }).click();
  await expect(loginRoot).toContainText('Account locked');
  await page.getByRole('button', { name: 'Сбросить Preview' }).click();
  await loginRoot.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#preview-viewport')).toContainText('Welcome!');
  await page.getByRole('button', { name: 'Назад по сценарию' }).click();
  await expect(loginRoot).toBeVisible();
  await page.getByRole('button', { name: 'Вернуться в Design' }).click();
  expect((await read()).screens.map(s => s.id)).toEqual(baseBefore.screens.map(s => s.id).concat(successScreen));

  await show(page, 'layers');
  await page.locator('#screens .screen-select').filter({ hasText: 'Login' }).click();
  await page.locator('#screens .screen-row').first().locator('.screen-context-menu summary').click();
  const duplication = page.waitForResponse(response => response.url().endsWith('/commands/duplicate-screen'));
  await page.getByRole('button', { name: 'Дублировать экран «Login»' }).click();
  const duplicated = await duplication;
  expect(duplicated.ok(), await duplicated.text()).toBeTruthy();
  const copyScreen = (await duplicated.json()).screenId;
  await expect(page.locator('#screens .screen-select[aria-pressed="true"]')).toContainText('Login (copy)');
  let snapshot = await read();
  const copied = snapshot.screens.find(s => s.id === copyScreen);
  expect(copied.childIds[0]).not.toBe(frame);
  expect(copied.variants).toHaveLength(2);
  expect(copied.variants[0].id).not.toBe(invalidVariant);
  expect(snapshot.scenarios).toHaveLength(4);

  await show(page, 'document');
  await page.getByLabel('Имя версии (необязательно)').fill('Multi-state login');
  const saving = page.waitForResponse(response => response.url().endsWith('/commands/save'));
  await page.getByRole('button', { name: 'Создать версию', exact: true }).click();
  expect((await saving).ok()).toBeTruthy();
  snapshot = await read();
  await page.close();
  await server.restart();
  const reopened = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
  try {
    await reopened.goto(server.url);
    await signIn(reopened);
    await reopened.getByRole('link', { name: 'Login Prototype' }).click();
    await expect(reopened.locator('#screens .screen-select')).toHaveCount(3);
    await reopened.locator('#screens .screen-select').filter({ hasText: 'Login' }).first().click();
    await expect(reopened.locator('#screen-variants-list')).toContainText('InvalidPassword');
    expect(await read()).toEqual(snapshot);
  } finally {
    await reopened.close();
  }
});
