const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');
const { createDemo } = require('./demo-overlay');

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
  await show(page, 'assets');
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
  await show(page, 'assets');
  await page.locator(`#screen-variants-list [data-variant-id="${variantId ?? ''}"]`).click();
  await expect(page.locator(`#screen-variants-list [data-variant-id="${variantId ?? ''}"]`)).toHaveAttribute('aria-pressed', 'true');
}

async function scenario(page, layerId, eventId, action, variantId, targetScreen) {
  await selectLayer(page, layerId);
  await show(page, 'prototype');
  await expect(page.locator('#scenario-create')).toBeVisible();
  await page.locator('#scenario-event').selectOption(String(eventId));
  if (variantId !== undefined) await page.locator('#scenario-variant').selectOption(variantId ?? '');
  await expect(page.locator(`#scenario-action option[value="${action}"]`)).toHaveCount(1);
  await page.locator('#scenario-action').selectOption(action);
  // The target selector becomes visible only after choosing Navigate/OpenOverlay.
  if (targetScreen) await page.locator('#scenario-target').selectOption(targetScreen);
  await expect(page.locator('#scenario-action')).toHaveValue(action);
  await expect(page.locator('#scenario-create-submit')).toBeEnabled();
  const posted = page.waitForResponse(response => response.url().endsWith('/commands/create-scenario'));
  await page.locator('#scenario-create-submit').click();
  const response = await posted;
  expect(response.ok(), await response.text()).toBeTruthy();
  // Await the editor's revision reconciliation, not only the HTTP acknowledgement.
  await expect(page.locator('#scenario-command-status')).toHaveText('Создание сценария подтверждено.');
}

test('designs a login with password, independent variants, scenarios, duplication and reload through UI', async ({ page, request, server, browser }) => {
  test.setTimeout(process.env.PWDEBUG ? 0 : (process.env.FIGVAM_DEMO === '1' ? 15 * 60_000 : 180_000));
  const demo = createDemo(page, 19);
  if (process.env.FIGVAM_DEMO === '1') console.log('FigVam narrated demo enabled: 19 steps');
  // In demo mode, use the maximized OS window rather than a potentially off-screen 1700×1100 viewport.
  if (process.env.FIGVAM_DEMO !== '1')
    await page.setViewportSize({ width: 1700, height: 1100 });
  await page.goto(server.url);
  await signIn(page);
  await demo.step('Создаём документ и экран', 'Начинаем отдельный прототип Login Prototype.');
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
  await demo.step('Добавляем контейнер формы', 'Frame задаёт область диалога и размещение дочерних элементов.');
  const frame = await addLayer(page, 'Frame');
  await saveProperties(page, { X: 50, Y: 40, 'Ширина': 450, 'Высота': 370 });
  await demo.step('Добавляем заголовок', 'Создаём текст Sign in внутри контейнера.');
  const title = await addLayer(page, 'Text', frame);
  await saveProperties(page, { X: 20, Y: 20, 'Текст': 'Sign in' });
  await demo.step('Добавляем поле имени пользователя', 'Создаём TextInput с подсказкой Username.');
  const username = await addLayer(page, 'TextInput', frame);
  await saveProperties(page, { X: 20, Y: 85, 'Подсказка': 'Username' });
  await demo.step('Добавляем поле пароля', 'Переключаем TextInput в режим Password с маскировкой ввода.');
  const password = await addLayer(page, 'TextInput', frame);
  await saveProperties(page, { X: 20, Y: 145, 'Подсказка': 'Password' }, {}, { 'Тип ввода': 'Password' });
  await demo.step('Добавляем кнопку входа', 'Создаём кнопку Login и настраиваем её положение.');
  const loginButton = await addLayer(page, 'Button', frame);
  await saveProperties(page, { X: 20, Y: 205, 'Текст': 'Login' });
  await demo.step('Готовим сообщения для разных состояний', 'Добавляем тексты Invalid password и Account locked. По умолчанию оба скрыты.');
  const error = await addLayer(page, 'Text', frame);
  await saveProperties(page, { X: 20, Y: 260, 'Текст': 'Invalid password' }, { 'Видимость': false });
  const locked = await addLayer(page, 'Text', frame);
  await saveProperties(page, { X: 20, Y: 295, 'Текст': 'Account locked' }, { 'Видимость': false });
  await demo.step('Добавляем демонстрационные кнопки', 'Они позволят вручную показать блокировку и успешный вход в Preview.');
  const lockedButton = await addLayer(page, 'Button', frame);
  await saveProperties(page, { X: 200, Y: 205, 'Текст': 'Lock account' });
  const successButton = await addLayer(page, 'Button', frame);
  await saveProperties(page, { X: 200, Y: 260, 'Текст': 'Continue' });

  await demo.step('Создаём вариант InvalidPassword', 'Вариант показывает ошибку и меняет геометрию, не затрагивая Base.');
  const invalidVariant = await addVariant(page, 'InvalidPassword');
  await selectLayer(page, error);
  await saveProperties(page, {}, { 'Видимость': true });
  // Geometry edits on a variant must save an override, not modify the Base node.
  await page.getByRole('button', { name: '100%', exact: true }).click();
  const errorVisual = page.locator(`#screen-boundary [data-visual-node="${error}"]`);
  await expect(errorVisual).toBeVisible();
  const bounds = await errorVisual.boundingBox();
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 24, y, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#canvas-edit-status')).toHaveText('Геометрия сохранена.');
  await useVariant(page, null);
  await selectLayer(page, error);
  await expect(page.locator('#visual-inspector').getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('20');
  await useVariant(page, invalidVariant);
  await selectLayer(page, error);
  await expect(page.locator('#visual-inspector').getByRole('spinbutton', { name: 'X', exact: true })).not.toHaveValue('20');
  await demo.step('Создаём вариант AccountLocked', 'Показываем сообщение о блокировке и отключаем кнопку Login.');
  const lockedVariant = await addVariant(page, 'AccountLocked');
  await selectLayer(page, locked);
  await saveProperties(page, {}, { 'Видимость': true });
  await selectLayer(page, loginButton);
  await demo.step('Проверяем независимость состояний', 'Убеждаемся, что изменения вариантов не повредили базовый экран.');
  await saveProperties(page, {}, { 'Доступность': false });
  await useVariant(page, invalidVariant);
  await selectLayer(page, error);
  await expect(page.locator('#visual-properties [data-variant-override="true"]')).not.toHaveCount(0);
  await useVariant(page, null);
  await selectLayer(page, error);
  await expect(page.locator('#visual-inspector').getByRole('checkbox', { name: 'Видимость' })).not.toBeChecked();
  const baseBefore = await read();

  await demo.step('Создаём экран успешного входа', 'Добавляем отдельный экран Success с сообщением Welcome!');
  const successScreen = await createScreen(page, 'Success');
  const successText = await addLayer(page, 'Text');
  await saveProperties(page, { 'Текст': 'Welcome!' });
  await show(page, 'layers');
  await page.locator(`#screens .screen-select`).filter({ hasText: 'Login' }).click();
  await expect(page.locator('#screen-variants-list')).toContainText('AccountLocked');
  // A screen switch may preserve tree expansion; open the container only if needed.
  const frameRow = page.locator(`#layers [data-id="${frame}"]`);
  await expect(frameRow).toBeVisible();
  if (await frameRow.getAttribute('aria-expanded') === 'false')
    await frameRow.locator(':scope > .layer-label').click();
  await expect(page.locator(`#layers [data-id="${loginButton}"]`)).toBeVisible();

  await demo.step('Настраиваем переходы между состояниями', 'Связываем Click и Submit с ShowVariant и Navigate.');
  await scenario(page, loginButton, 0, 'showVariant', invalidVariant);
  await scenario(page, password, 4, 'showVariant', invalidVariant);
  await scenario(page, lockedButton, 0, 'showVariant', lockedVariant);
  await scenario(page, successButton, 0, 'navigate', undefined, successScreen);

  await demo.step('Проверяем неверный пароль', 'В Preview вводим демонстрационный пароль и нажимаем Enter.');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const loginRoot = page.locator(`#preview-viewport [data-preview-screen="${loginScreen}"]`);
  const secret = loginRoot.locator(`[data-visual-node="${password}"] input`);
  await expect(secret).toHaveAttribute('type', 'password');
  await secret.fill('example-only');
  await secret.press('Enter');
  await expect(loginRoot.locator(`[data-visual-node="${error}"]`)).toBeVisible();
  await demo.step('Проверяем состояние блокировки', 'Сбрасываем Preview и демонстрируем вариант AccountLocked.');
  await page.getByRole('button', { name: 'Сбросить Preview' }).click();
  await loginRoot.getByRole('button', { name: 'Lock account' }).click();
  await expect(loginRoot.locator(`[data-visual-node="${locked}"]`)).toBeVisible();
  await demo.step('Проверяем успешный вход', 'Переходим на экран Success и возвращаемся назад по истории Preview.');
  await page.getByRole('button', { name: 'Сбросить Preview' }).click();
  await loginRoot.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#preview-viewport')).toContainText('Welcome!');
  await page.getByRole('button', { name: 'Назад по сценарию' }).click();
  await expect(loginRoot).toBeVisible();
  await page.getByRole('button', { name: 'Вернуться в Design' }).click();
  expect((await read()).screens.map(s => s.id)).toEqual(baseBefore.screens.map(s => s.id).concat(successScreen));

  await demo.step('Дублируем экран логина', 'Копия получает собственные ID узлов и вариантов.');
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

  await demo.step('Сохраняем документ', 'Создаём версию Multi-state login и перезапускаем тестовый сервер.');
  await show(page, 'document');
  await page.getByLabel('Имя версии (необязательно)').fill('Multi-state login');
  const saving = page.waitForResponse(response => response.url().endsWith('/commands/save'));
  await page.getByRole('button', { name: 'Создать версию', exact: true }).click();
  expect((await saving).ok()).toBeTruthy();
  snapshot = await read();
  await page.close();
  await server.restart();
  const reopened = await browser.newPage({ viewport: process.env.FIGVAM_DEMO === '1' ? null : { width: 1700, height: 1100 } });
  try {
    await reopened.goto(server.url);
    await signIn(reopened);
    await reopened.getByRole('link', { name: 'Login Prototype' }).click();
    await demo.step('Проверяем восстановление', 'Все экраны, варианты и сценарии должны сохраниться после перезапуска.', reopened);
    await expect(reopened.locator('#screens .screen-select')).toHaveCount(3);
    await reopened.locator('#screens .screen-select').filter({ hasText: 'Login' }).first().click();
    await expect(reopened.locator('#screen-variants-list')).toContainText('InvalidPassword');
    expect(await read()).toEqual(snapshot);
  } finally {
    await reopened.close();
  }
});
