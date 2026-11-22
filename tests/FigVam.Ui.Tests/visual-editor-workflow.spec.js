const { test, expect, bearer } = require('./fixtures');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DA8J8BAAf/Af8Bf4mnAAAAAElFTkSuQmCC', 'base64');
const number = value => ({ type: 'number', value });
const string = value => ({ type: 'string', value });
const color = (red, green, blue) => ({ type: 'color', red, green, blue, alpha: 255 });
const geometry = (x, y, width, height) => ({ x: number(x), y: number(y), width: number(width), height: number(height) });
const node = id => `[data-visual-node="${id}"]`;
const title = 'Заявка на участие';
const initialInput = 'Анна';
const submitLabel = 'Отправить заявку';

async function signIn(page) {
  await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
}

async function addLayer(page, kind, parent, assetId) {
  if (parent) await page.locator(`#layers [data-id="${parent}"] > .layer-label`).click();
  await page.getByLabel('Вид элемента').selectOption(kind);
  if (assetId) await page.locator('#visual-palette').getByRole('combobox', { name: 'Ассет', exact: true }).selectOption(assetId);
  const added = page.waitForResponse(response => response.url().endsWith('/commands/add-node'));
  await page.getByRole('button', { name: 'Добавить элемент', exact: true }).click();
  const response = await added;
  expect(response.ok(), await response.text()).toBeTruthy();
  const { nodeId } = await response.json();
  await expect(page.locator(`#layers [data-id="${nodeId}"]`)).toHaveAttribute('aria-selected', 'true');
  return nodeId;
}

async function editLayer(page, fields) {
  const inspector = page.locator('#visual-inspector');
  for (const [label, value] of Object.entries(fields)) {
    await inspector.getByLabel(label, { exact: true }).fill(String(value));
  }
  await inspector.getByRole('button', { name: 'Сохранить свойства', exact: true }).click();
  await expect(inspector.getByRole('status')).toHaveText('Свойства сохранены.');
}

function position(x, y, width, height) {
  return { X: x, Y: y, 'Ширина': width, 'Высота': height };
}

async function expectVisuals(root, ids, buttonX) {
  const { frame, text, input, button, image } = ids;
  const actual = () => root.evaluate((screen, ids) => {
    const origin = screen.getBoundingClientRect();
    return [origin.width, origin.height, ...Object.values(ids).map(id => {
      const box = screen.querySelector(`[data-visual-node="${id}"]`)?.getBoundingClientRect();
      return box && [box.x - origin.x, box.y - origin.y, box.width, box.height];
    })];
  }, ids);
  await expect.poll(actual).toEqual([
    800, 600, [40, 60, 520, 380], [64, 84, 300, 38], [64, 140, 270, 44],
    [40 + buttonX, 204, 180, 48], [380, 140, 140, 90]
  ]);
  await expect(root.locator(node(text))).toHaveText(title);
  await expect(root.locator(`${node(text)} > .visual-surface`)).toHaveCSS('color', 'rgb(34, 68, 102)');
  await expect(root.locator(`${node(frame)} > .visual-surface`)).toHaveCSS('background-color', 'rgb(238, 244, 248)');
  await expect(root.locator(node(button))).toHaveText(submitLabel);
  await expect(root.locator(`${node(button)} > .visual-surface`)).toHaveCSS('background-color', 'rgb(36, 102, 154)');
  const picture = root.getByRole('img', { name: 'Цветные полосы', exact: true });
  await expect(picture).toBeVisible();
  await expect(picture).toHaveJSProperty('naturalWidth', 2);
}

test('creates, previews, saves and reopens a visual design after a server restart', async ({ browser, page, request, server }) => {
  await page.setViewportSize({ width: 1700, height: 1100 });
  await page.goto(server.url);
  await signIn(page);
  await page.getByLabel('Имя нового документа').fill(title);
  await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+$/);
  const documentPath = new URL(page.url()).pathname;
  const read = async resource => {
    const response = await request.get(`${server.url}/api/v1${documentPath}/${resource}`, {
      headers: { Authorization: `Bearer ${bearer}` }
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };

  await page.getByRole('button', { name: 'Создать страницу', exact: true }).click();
  await page.getByLabel('Ширина экрана').fill('800');
  await page.getByLabel('Высота экрана').fill('600');
  await page.getByRole('button', { name: 'Создать экран', exact: true }).click();
  const frame = await addLayer(page, 'Frame');
  await editLayer(page, { ...position(40, 60, 520, 380), 'Цвет фона': '#eef4f8', 'Цвет фона — альфа': 255 });
  const text = await addLayer(page, 'Text', frame);
  await editLayer(page, { ...position(24, 24, 300, 38), 'Текст': title, 'Цвет текста': '#224466' });
  const input = await addLayer(page, 'TextInput', frame);
  await editLayer(page, { ...position(24, 80, 270, 44), 'Подсказка': 'Ваше имя', 'Демонстрационное значение': initialInput });
  const button = await addLayer(page, 'Button', frame);
  await editLayer(page, { ...position(24, 144, 180, 48), 'Текст': submitLabel, 'Цвет фона': '#24669a' });

  await page.getByLabel('Изображение PNG').setInputFiles({ name: 'stripes.png', mimeType: 'image/png', buffer: png });
  const upload = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes('/assets/'));
  await page.getByRole('button', { name: 'Загрузить изображение', exact: true }).click();
  const uploaded = await upload;
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const assetId = new URL(uploaded.url()).pathname.split('/').pop();
  await expect(page.locator('#asset-upload-status')).toContainText('Изображение загружено');
  const image = await addLayer(page, 'Image', frame, assetId);
  await editLayer(page, { ...position(340, 80, 140, 90), 'Альтернативное описание': 'Цветные полосы' });

  const ids = { frame, text, input, button, image };
  const design = page.locator('#screen-boundary');
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await expectVisuals(design, ids, 24);
  const buttonBox = await design.locator(node(button)).boundingBox();
  const startX = buttonBox.x + buttonBox.width / 2, startY = buttonBox.y + buttonBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 72, startY, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#canvas-edit-status')).toHaveText('Геометрия сохранена.');
  await expectVisuals(design, ids, 96);

  const beforePreview = await read('document.json');
  const { document } = beforePreview;
  const [screen] = document.screens;
  expect(document.pages).toEqual([expect.objectContaining({ screenIds: [screen.id] })]);
  expect(document.screens).toEqual([expect.objectContaining({ dimensions: { width: 800, height: 600 }, childIds: [frame] })]);
  expect(document.nodes.map(({ id, kind, childIds, properties }) => ({ id, kind, childIds, properties }))).toEqual([
    { id: frame, kind: 'Frame', childIds: [text, input, button, image],
      properties: { ...geometry(40, 60, 520, 380), backgroundColor: color(238, 244, 248) } },
    { id: text, kind: 'Text', childIds: [],
      properties: { ...geometry(24, 24, 300, 38), text: string(title), textColor: color(34, 68, 102) } },
    { id: input, kind: 'TextInput', childIds: [],
      properties: { ...geometry(24, 80, 270, 44), placeholder: string('Ваше имя'), value: string(initialInput) } },
    { id: button, kind: 'Button', childIds: [],
      properties: { ...geometry(96, 144, 180, 48), text: string(submitLabel), backgroundColor: color(36, 102, 154) } },
    { id: image, kind: 'Image', childIds: [],
      properties: { ...geometry(340, 80, 140, 90), altText: string('Цветные полосы'), asset: { type: 'asset', assetId } } }
  ]);
  expect(document.assets).toEqual([expect.objectContaining({ id: assetId, width: 2, height: 1 })]);

  const previewRoot = `#preview-viewport [data-preview-screen="${screen.id}"]`;
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.locator(previewRoot);
  await expectVisuals(preview, ids, 96);
  await expect(design).toBeHidden();
  const textbox = preview.getByRole('textbox');
  await expect(textbox).toHaveValue(initialInput);
  await expect(textbox).toHaveAttribute('placeholder', 'Ваше имя');
  await textbox.fill('Изменение в Preview');
  await expect(textbox).toHaveValue('Изменение в Preview');
  await page.keyboard.press('Tab');
  await expect(preview.getByRole('button', { name: submitLabel })).toBeFocused();
  await page.getByRole('button', { name: 'Вернуться в Design', exact: true }).click();
  expect(await read('document.json')).toEqual(beforePreview);

  const versionName = 'Готовая заявка';
  await page.getByLabel('Имя версии (необязательно)').fill(versionName);
  const saving = page.waitForResponse(response => response.url().endsWith('/commands/save'));
  await page.getByRole('button', { name: 'Создать версию', exact: true }).click();
  const saved = await saving;
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const { versionId, revision: savedRevision } = await saved.json();
  expect(savedRevision).toBe(beforePreview.revision + 1);
  await expect(page.locator('#version-result')).toHaveText(`Версия создана: ${versionId}`);
  await page.close();
  await server.restart();

  const reopened = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
  try {
    await reopened.goto(server.url);
    await signIn(reopened);
    await reopened.getByRole('link', { name: title, exact: true }).click();
    await reopened.locator('#screens button').click();
    await reopened.getByRole('button', { name: '100%', exact: true }).click();
    const reopenedDesign = reopened.locator('#screen-boundary');
    await expectVisuals(reopenedDesign, ids, 96);
    expect(await read('document.json')).toEqual({ ...beforePreview, revision: savedRevision });
    const savedResource = `document.json?versionId=${versionId}`;
    const snapshot = await read(savedResource);
    expect(snapshot).toMatchObject({ revision: savedRevision, document, savedVersion: { id: versionId, name: versionName } });
    await reopened.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(reopened.locator(previewRoot).getByRole('textbox')).toHaveValue(initialInput);
    await reopened.getByRole('button', { name: 'Вернуться в Design', exact: true }).click();

    await reopened.getByRole('button', { name: 'Отменить действие', exact: true }).click();
    await expectVisuals(reopenedDesign, ids, 24);
    const undone = await read('document.json');
    expect(undone.revision).toBe(savedRevision + 1);
    expect(undone.document.nodes.find(item => item.id === button).properties).toMatchObject({ x: number(24), y: number(144) });
    await reopened.getByRole('button', { name: 'Повторить действие', exact: true }).click();
    await expectVisuals(reopenedDesign, ids, 96);
    expect(await read('document.json')).toEqual({ ...beforePreview, revision: savedRevision + 2 });
    expect(await read(savedResource)).toEqual(snapshot);
  } finally {
    await reopened.close();
  }
});
