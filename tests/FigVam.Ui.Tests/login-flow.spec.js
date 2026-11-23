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

test('designs two linked login screens and previews invalid password through UI', async ({ page, request, server, browser }) => {
  test.setTimeout(process.env.PWDEBUG ? 0 : (process.env.FIGVAM_DEMO === '1' ? 15 * 60_000 : 180_000));
  const demo = createDemo(page, 13);
  if (process.env.FIGVAM_DEMO === '1') console.log('FigVam narrated demo enabled: 13 steps');
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
  await saveProperties(page, { X: 50, Y: 40, 'Ширина': 450, 'Высота': 330 });
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
  const original = await read();
  expect(original.screens).toHaveLength(1);

  await demo.step('Создаём экран ошибки', 'У одного действия Login два экрана. Дублируем форму, чтобы сохранить её общие элементы.');
  await show(page, 'layers');
  const sourceScreen = page.locator('#screens .screen-select[data-screen-id="' + loginScreen + '"]');
  await sourceScreen.locator('..').locator('.screen-context-menu summary').click();
  const duplication = page.waitForResponse(response => response.url().endsWith('/commands/duplicate-screen'));
  await page.getByRole('button', { name: 'Дублировать экран «Login»' }).click();
  const duplicated = await duplication;
  expect(duplicated.ok(), await duplicated.text()).toBeTruthy();
  const errorScreen = (await duplicated.json()).screenId;
  const errorScreenSelect = page.locator('#screens .screen-select[data-screen-id="' + errorScreen + '"]');
  await expect(errorScreenSelect).toHaveAttribute('aria-pressed', 'true');
  const copied = (await read()).screens.find(item => item.id === errorScreen);
  expect(copied.childIds).toHaveLength(1);
  const copiedFrame = copied.childIds[0];
  expect(copiedFrame).not.toBe(frame);
  await errorScreenSelect.locator('..').locator('.screen-rename-action').click();
  await page.locator('#screen-name-input').fill('Login Error');
  await page.locator('#screens .screen-rename-confirm').click();
  await expect(errorScreenSelect).toContainText('Login Error');

  await demo.step('Добавляем текст неправильного пароля', 'Второй экран повторяет форму входа, но дополнительно показывает сообщение об ошибке.');
  const error = await addLayer(page, 'Text', copiedFrame);
  await saveProperties(page, { X: 20, Y: 260, 'Текст': 'Invalid password', 'Цвет текста': '#ba2e3e' });
  const structure = await read();
  expect(structure.screens).toHaveLength(2);
  expect(structure.screens.every(screen => screen.variants.length === 0)).toBe(true);
  expect(structure.nodes.find(node => node.id === frame).childIds).not.toContain(error);
  expect(structure.nodes.find(node => node.id === copiedFrame).childIds).toContain(error);

  await demo.step('Связываем два экрана', 'Login.Click и Password.Submit открывают экран Login Error — это демонстрация перехода, не настоящая проверка пароля.');
  await show(page, 'layers');
  await page.locator('#screens .screen-select[data-screen-id="' + loginScreen + '"]').click();
  const frameRow = page.locator('#layers [data-id="' + frame + '"]');
  await expect(frameRow).toBeVisible();
  if (await frameRow.getAttribute('aria-expanded') === 'false')
    await frameRow.locator(':scope > .layer-label').click();
  await expect(page.locator('#layers [data-id="' + loginButton + '"]')).toBeVisible();
  await scenario(page, loginButton, 0, 'navigate', undefined, errorScreen);
  await scenario(page, password, 4, 'navigate', undefined, errorScreen);

  await demo.step('Вводим логин и пароль', 'В Preview вводим данные и нажимаем Enter. Открывается экран с ошибкой.');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const loginRoot = page.locator('#preview-viewport [data-preview-screen="' + loginScreen + '"]');
  await loginRoot.locator('[data-visual-node="' + username + '"] input').fill('demo-user');
  const secret = loginRoot.locator('[data-visual-node="' + password + '"] input');
  await expect(secret).toHaveAttribute('type', 'password');
  await secret.fill('example-only');
  await secret.press('Enter');
  const errorRoot = page.locator('#preview-viewport [data-preview-screen="' + errorScreen + '"]');
  await expect(errorRoot).toBeVisible();
  await expect(errorRoot).toContainText('Invalid password');
  await expect(errorRoot.locator('input')).toHaveCount(2);

  await demo.step('Проверяем кнопку Login', 'Возвращаемся на первый экран. Нажатие Login открывает тот же экран ошибки.');
  await page.getByRole('button', { name: 'Назад по сценарию' }).click();
  await expect(loginRoot).toBeVisible();
  await loginRoot.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(errorRoot).toBeVisible();
  await expect(errorRoot).toContainText('Invalid password');
  await page.getByRole('button', { name: 'Вернуться в Design' }).click();

  await demo.step('Сохраняем два экрана', 'Один login-flow: два экрана и два демонстрационных перехода.');
  const finished = await read();
  expect(finished.screens).toHaveLength(2);
  expect(finished.scenarios).toHaveLength(2);
  expect(finished.screens.every(screen => screen.variants.length === 0)).toBe(true);
  await show(page, 'document');
  await page.getByLabel('Имя версии (необязательно)').fill('Login and invalid password');
  const saving = page.waitForResponse(response => response.url().endsWith('/commands/save'));
  await page.getByRole('button', { name: 'Создать версию', exact: true }).click();
  expect((await saving).ok()).toBeTruthy();
  const snapshot = await read();
  await page.close();
  await server.restart();
  const reopened = await browser.newPage({ viewport: process.env.FIGVAM_DEMO === '1' ? null : { width: 1700, height: 1100 } });
  try {
    await reopened.goto(server.url);
    await signIn(reopened);
    await reopened.getByRole('link', { name: 'Login Prototype' }).click();
    await demo.step('Проверяем восстановление', 'После перезапуска оба экрана доступны: Login и Login Error.', reopened);
    await expect(reopened.locator('#screens .screen-select')).toHaveCount(2);
    await expect(reopened.locator('#screens .screen-select[data-screen-id="' + loginScreen + '"]')).toContainText('Login');
    await expect(reopened.locator('#screens .screen-select[data-screen-id="' + errorScreen + '"]')).toContainText('Login Error');
    expect(await read()).toEqual(snapshot);
  } finally {
    await reopened.close();
  }
});
