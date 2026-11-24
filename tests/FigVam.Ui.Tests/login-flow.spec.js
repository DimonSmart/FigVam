const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');
const { createDemo } = require('./demo-overlay');

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

async function saveProperties(page, values = {}, toggles = {}, enums = {}, shadow) {
  await show(page, 'design');
  const inspector = page.locator('#visual-inspector');
  for (const [label, value] of Object.entries(values)) {
    const field = inspector.getByLabel(label, { exact: true });
    await field.fill(String(value));
    if (label.startsWith('Цвет ')) {
      const color = field.locator('..');
      await color.getByRole('button', { name: 'Изменить Alpha' }).click();
      await color.getByLabel(label + ' — альфа', { exact: true }).fill('255');
      await color.getByRole('button', { name: 'Изменить Alpha' }).click();
    }
  }
  for (const [label, checked] of Object.entries(toggles)) {
    const box = inspector.getByRole('checkbox', { name: label });
    if (checked) await box.check(); else await box.uncheck();
  }
  for (const [label, value] of Object.entries(enums))
    await inspector.getByRole('combobox', { name: label }).selectOption(value);
  if (shadow) {
    await inspector.getByRole('button', { name: 'Add drop shadow', exact: true }).click();
    const effects = inspector.locator('.shadow-effects');
    for (const [label, value] of Object.entries(shadow.geometry))
      await effects.getByLabel('Drop shadow ' + label, { exact: true }).fill(String(value));
    await effects.getByLabel('Drop shadow', { exact: true }).fill(shadow.color);
    await effects.getByRole('button', { name: 'Изменить Alpha' }).click();
    await effects.getByLabel('Drop shadow — альфа', { exact: true }).fill(String(shadow.alpha));
  }
  await inspector.getByRole('button', { name: 'Сохранить свойства', exact: true }).click();
  await expect(inspector.getByRole('status')).toHaveText('Свойства сохранены.');
}

async function scenario(page, layerName, eventLabel, targetName, selectOnCanvas = false) {
  if (selectOnCanvas) {
    const canvas = page.locator('#screen-boundary');
    const button = canvas.getByText(layerName, { exact: true });
    await expect(button).toBeVisible();
    await button.click();
  } else {
    await show(page, 'layers');
    await page.getByRole('treeitem', { name: new RegExp('^' + layerName + ', TextInput') }).click();
  }
  await show(page, 'prototype');
  await page.getByRole('button', { name: 'Добавить взаимодействие', exact: true }).click();
  await page.getByLabel('Событие', { exact: true }).selectOption({ label: eventLabel });
  await page.getByLabel('Тип действия 1', { exact: true }).selectOption({ label: 'Перейти на экран' });
  await page.getByLabel('Поиск: Целевой экран', { exact: true }).fill(targetName);
  const picker = page.getByLabel('Целевой экран', { exact: true });
  const option = picker.getByRole('option', { name: new RegExp('/ ' + targetName + '$') });
  await expect(option).toHaveCount(1);
  await picker.selectOption({ label: await option.textContent() });
  const posted = page.waitForResponse(response => response.url().endsWith('/commands/create-scenario'));
  await expect(page.locator('#scenario-edit-submit')).toBeEnabled();
  await page.getByRole('button', { name: 'Сохранить взаимодействие', exact: true }).click();
  const response = await posted;
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(page.locator('#scenario-command-status')).toHaveText('Создание сценария подтверждено.');
  await expect(page.locator('#scenarios-list')).toContainText(targetName);
}

test('designs two linked login screens and previews invalid password through UI', async ({ page, request, server, browser }) => {
  test.setTimeout(process.env.PWDEBUG ? 0 : (process.env.FIGVAM_DEMO === '1' ? 15 * 60_000 : 240_000));
  const demo = createDemo(page, 16);
  if (process.env.FIGVAM_DEMO === '1') console.log('FigVam narrated demo enabled: 16 steps');
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
  await demo.step('Оформляем фон', 'Создаём единственный корневой Background Frame.');
  const background = await addLayer(page, 'Frame');
  await saveProperties(page, { X: 0, Y: 0, 'Ширина': 800, 'Высота': 600,
    'Цвет фона': '#EEF2F7', 'Толщина рамки': 0, 'Радиус углов': 0 });
  await demo.step('Оформляем диалог', 'Белая карточка с тонкой рамкой и скруглением.');
  const frame = await addLayer(page, 'Frame', background);
  await saveProperties(page, { X: 220, Y: 100, 'Ширина': 360, 'Высота': 400,
    'Цвет фона': '#FFFFFF', 'Толщина рамки': 1, 'Цвет рамки': '#E2E8F0', 'Радиус углов': 16 });
  // The dialog uses Free layout: child coordinates below are relative to its padded content.
  await show(page, 'assets');
  await page.getByLabel('Имя токена', { exact: true }).fill('spacing.dialog');
  await page.getByLabel('Тип токена').selectOption('Spacing');
  await page.getByLabel('Light', { exact: true }).fill('32');
  await page.getByLabel('Dark', { exact: true }).fill('32');
  await page.getByRole('button', { name: 'Создать токен' }).click();
  await expect(page.locator('#token-values')).toHaveText('Light: 32; Dark: 32');
  await selectLayer(page, frame);
  const padding = page.locator('#visual-inspector .padding-editor');
  await padding.getByLabel('Отступ сверху', { exact: true }).fill('24');
  await padding.getByLabel('Отступ снизу', { exact: true }).fill('16');
  await padding.getByLabel('Отступ слева', { exact: true }).fill('32');
  const right = padding.locator('[data-side=right].padding-editor-field');
  await right.getByRole('button', { name: 'Привязать токен' }).click();
  await right.getByRole('dialog').getByRole('button', { name: /spacing.dialog/ }).click();
  await saveProperties(page, { 'Между элементами': 12 });
  await expect(right.locator('.token-value-name')).toHaveText('spacing.dialog');
  await demo.step('Effects: тень диалога', 'Добавляем Drop shadow штатным Inspector.');
  const dialogShadow = { geometry: { X: 0, Y: 12, Blur: 32, Spread: 0 }, color: '#0F172A', alpha: 41 };
  await saveProperties(page, {}, {}, {}, dialogShadow);
  await demo.step('Добавляем заголовок и подзаголовок', 'Типографика формирует иерархию карточки.');
  const title = await addLayer(page, 'Text', frame);
  await saveProperties(page, { X: 0, Y: 4, 'Ширина': 296, 'Высота': 36, 'Текст': 'Sign in',
    'Размер шрифта': 26, 'Цвет текста': '#0F172A' }, {}, { 'Толщина шрифта — пресет': 'Bold' });
  await addLayer(page, 'Text', frame);
  await saveProperties(page, { X: 0, Y: 40, 'Ширина': 296, 'Высота': 24,
    'Текст': 'Welcome back to your account.', 'Размер шрифта': 14, 'Цвет текста': '#64748B' });
  await demo.step('Добавляем имя пользователя', 'Label и TextInput без тени.');
  await addLayer(page, 'Text', frame);
  await saveProperties(page, { X: 0, Y: 76, 'Ширина': 296, 'Высота': 24, 'Текст': 'Username',
    'Размер шрифта': 13, 'Цвет текста': '#334155' }, {}, { 'Толщина шрифта — пресет': 'Semibold' });
  const username = await addLayer(page, 'TextInput', frame);
  await saveProperties(page, { X: 0, Y: 106, 'Ширина': 296, 'Высота': 44, 'Подсказка': 'Username',
    'Цвет фона': '#FFFFFF', 'Толщина рамки': 1, 'Цвет рамки': '#CBD5E1', 'Радиус углов': 8, 'Размер шрифта': 14 });
  await demo.step('Добавляем пароль', 'Password TextInput сохраняет нативную маскировку.');
  await addLayer(page, 'Text', frame);
  await saveProperties(page, { X: 0, Y: 164, 'Ширина': 296, 'Высота': 24, 'Текст': 'Password',
    'Размер шрифта': 13, 'Цвет текста': '#334155' }, {}, { 'Толщина шрифта — пресет': 'Semibold' });
  const password = await addLayer(page, 'TextInput', frame);
  await saveProperties(page, { X: 0, Y: 194, 'Ширина': 296, 'Высота': 44, 'Подсказка': 'Password',
    'Цвет фона': '#FFFFFF', 'Толщина рамки': 1, 'Цвет рамки': '#CBD5E1', 'Радиус углов': 8, 'Размер шрифта': 14 }, {}, { 'Тип ввода': 'Password' });
  await demo.step('Оформляем кнопку Login', 'Primary action с собственным цветом и скруглением.');
  const loginButton = await addLayer(page, 'Button', frame);
  await saveProperties(page, { X: 0, Y: 268, 'Ширина': 296, 'Высота': 44, 'Текст': 'Login',
    'Цвет фона': '#2563EB', 'Толщина рамки': 0, 'Радиус углов': 8, 'Размер шрифта': 15,
    'Цвет текста': '#FFFFFF' }, {}, { 'Толщина шрифта — пресет': 'Semibold' });
  await demo.step('Effects: тень кнопки', 'Второй, более лёгкий уровень elevation.');
  await saveProperties(page, {}, {}, {}, { geometry: { X: 0, Y: 4, Blur: 8, Spread: 0 }, color: '#2563EB', alpha: 61 });
  await selectLayer(page, frame);
  await padding.scrollIntoViewIfNeeded();
  await expect(padding).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('login-padding-editor.png'), animations: 'disabled' });
  const original = await read();
  expect(original.screens).toHaveLength(1);
  const property = (id, name) => original.nodes.find(node => node.id === id).properties[name];
  const dialogEffect = { type: 'shadow', offsetX: 0, offsetY: 12, blurRadius: 32, spreadRadius: 0,
    color: { red: 15, green: 23, blue: 42, alpha: 41 } };
  const buttonEffect = { type: 'shadow', offsetX: 0, offsetY: 4, blurRadius: 8, spreadRadius: 0,
    color: { red: 37, green: 99, blue: 235, alpha: 61 } };
  expect(property(frame, 'paddingTop')).toEqual({ type: 'number', value: 24 });
  expect(property(frame, 'paddingRight').type).toBe('token');
  expect(property(frame, 'paddingBottom')).toEqual({ type: 'number', value: 16 });
  expect(property(frame, 'paddingLeft')).toEqual({ type: 'number', value: 32 });
  expect(property(frame, 'gap')).toEqual({ type: 'number', value: 12 });
  expect(property(frame, 'shadow')).toEqual(dialogEffect);
  expect(property(loginButton, 'shadow')).toEqual(buttonEffect);
  expect(property(username, 'shadow')).toBeUndefined();
  expect(property(password, 'shadow')).toBeUndefined();
  expect(original.screens[0].childIds).toEqual([background]);

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
  const duplicatedDocument = await read();
  const copied = duplicatedDocument.screens.find(item => item.id === errorScreen);
  expect(copied.childIds).toHaveLength(1);
  const copiedBackground = copied.childIds[0];
  const copiedFrame = duplicatedDocument.nodes.find(node => node.id === copiedBackground).childIds[0];
  expect(duplicatedDocument.nodes.find(node => node.id === copiedFrame).properties.shadow).toEqual(dialogEffect);
  expect(copiedFrame).not.toBe(frame);
  await errorScreenSelect.locator('..').locator('.screen-rename-action').click();
  await page.locator('#screen-name-input').fill('Login Error');
  await page.locator('#screens .screen-rename-confirm').click();
  await expect(errorScreenSelect).toContainText('Login Error');

  await demo.step('Добавляем текст неправильного пароля', 'Второй экран повторяет форму входа, но дополнительно показывает сообщение об ошибке.');
  const copiedBackgroundRow = page.locator('#layers [data-id="' + copiedBackground + '"]');
  if (await copiedBackgroundRow.getAttribute('aria-expanded') === 'false') await copiedBackgroundRow.locator(':scope > .layer-label').click();
  const error = await addLayer(page, 'Text', copiedFrame);
  await saveProperties(page, { X: 0, Y: 320, 'Ширина': 296, 'Высота': 24, 'Текст': 'Invalid password', 'Размер шрифта': 13, 'Цвет текста': '#B91C1C' });
  const structure = await read();
  expect(structure.screens).toHaveLength(2);
  expect(structure.screens.every(screen => screen.variants.length === 0)).toBe(true);
  expect(structure.nodes.find(node => node.id === frame).childIds).not.toContain(error);
  expect(structure.nodes.find(node => node.id === copiedFrame).childIds).toContain(error);

  await demo.step('Связываем два экрана', 'Login.Click и Password.Submit открывают экран Login Error — это демонстрация перехода, не настоящая проверка пароля.');
  await show(page, 'layers');
  await page.locator('#screens .screen-select[data-screen-id="' + loginScreen + '"]').click();
  const backgroundRow = page.locator('#layers [data-id="' + background + '"]');
  if (await backgroundRow.getAttribute('aria-expanded') === 'false') await backgroundRow.locator(':scope > .layer-label').click();
  const frameRow = page.locator('#layers [data-id="' + frame + '"]');
  await expect(frameRow).toBeVisible();
  if (await frameRow.getAttribute('aria-expanded') === 'false')
    await frameRow.locator(':scope > .layer-label').click();
  await expect(page.locator('#layers [data-id="' + loginButton + '"]')).toBeVisible();
  await scenario(page, 'Login', 'По нажатию', 'Login Error', true);
  await scenario(page, 'Password', 'При отправке', 'Login Error');
  await page.locator('#screens .screen-select[aria-pressed="true"]').click();
  await expect(page.locator('#scenarios-status')).toHaveText('Взаимодействия: 2');
  await expect(page.locator('#scenarios-list')).toContainText('Login · По нажатию');
  await expect(page.locator('#scenarios-list')).toContainText('Password · При отправке');
  await expect(page.locator('#scenarios-list')).not.toContainText(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
  await expect(page.locator('#layers [data-id="' + loginButton + '"] .layer-interaction')).toBeVisible();
  await expect(page.locator('#layers [data-id="' + password + '"] .layer-interaction')).toBeVisible();

  await demo.step('Вводим логин и пароль', 'В Preview вводим данные и нажимаем Enter. Открывается экран с ошибкой.');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const loginRoot = page.locator('#preview-viewport [data-preview-screen="' + loginScreen + '"]');
  await expect(loginRoot.locator('[data-visual-node="' + frame + '"]')).toHaveCSS('box-shadow', /rgba\(15, 23, 42, 0\.16/);
  await expect(loginRoot.locator('[data-visual-node="' + loginButton + '"]')).toHaveCSS('box-shadow', /rgba\(37, 99, 235, 0\.2(?:39|4)/);
  if (process.env.FIGVAM_DEMO !== '1')
    await verifyLoginVisual(page, loginRoot, 'Login Preview');
  await loginRoot.locator('[data-visual-node="' + username + '"] input').fill('demo-user');
  const secret = loginRoot.locator('[data-visual-node="' + password + '"] input');
  await expect(secret).toHaveAttribute('type', 'password');
  await secret.fill('example-only');
  await secret.press('Enter');
  const errorRoot = page.locator('#preview-viewport [data-preview-screen="' + errorScreen + '"]');
  await expect(errorRoot).toBeVisible();
  await expect(errorRoot).toContainText('Invalid password');
  await expect(errorRoot.locator('input')).toHaveCount(2);
  if (process.env.FIGVAM_DEMO !== '1')
    await verifyLoginVisual(page, errorRoot, 'Login Error Preview');

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
  // The portable document JSON format encodes enum names, unlike the numeric command/query API.
  expect(finished.scenarios.map(({ nodeId, event, actions }) => ({ nodeId, event, actions }))).toEqual([
    { nodeId: loginButton, event: 'Click', actions: [{ type: 'navigate', screenId: errorScreen }] },
    { nodeId: password, event: 'Submit', actions: [{ type: 'navigate', screenId: errorScreen }] }
  ]);
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
    await reopened.locator('#screens .screen-select').filter({ hasText: /^Login\b(?! Error)/ }).click();
    await show(reopened, 'prototype');
    await expect(reopened.locator('#scenarios-list')).toContainText('Login · По нажатию');
    await expect(reopened.locator('#scenarios-list')).toContainText('Password · При отправке');
    const restored = reopened.locator('#preview-viewport [data-preview-screen="' + loginScreen + '"]');
    const restoredError = reopened.locator('#preview-viewport [data-preview-screen="' + errorScreen + '"]');
    await reopened.getByRole('button', { name: 'Preview', exact: true }).click();
    await restored.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(restoredError).toContainText('Invalid password');
    await reopened.getByRole('button', { name: 'Назад по сценарию' }).click();
    await restored.locator('[data-visual-node="' + password + '"] input').press('Enter');
    await expect(restoredError).toContainText('Invalid password');
    await reopened.getByRole('button', { name: 'Вернуться в Design' }).click();
  } finally {
    await reopened.close();
  }
});
