const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');

async function postSuccessfully(request, url, options) {
  const started = performance.now();
  const response = await request.post(url, options);
  expect(response.ok(), `POST ${url}: HTTP ${response.status()} after ${(performance.now() - started).toFixed(1)} ms; body: ${await response.text()}`).toBeTruthy();
  return response;
}

async function login(page, token = bearer) {
  await page.getByLabel('Bearer-токен', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
}

test('creates a named document, renders text safely, opens a stable URL and forgets token on reload', async ({ page }, testInfo) => {
  await page.goto('/');
  await login(page);
  await expect(page.locator('#status')).toContainText('Доступных документов нет');
  await page.getByLabel('Имя нового документа').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('img')).toHaveCount(0);
  for (const name of ['Холст', 'Страницы и слои', 'Инспектор']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('editor.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('editor-mobile.png'), fullPage: true });
  const url = page.url();
  expect(url).not.toContain(bearer);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Открыть рабочее пространство' })).toBeVisible();
  await expect(page.getByLabel('Bearer-токен', { exact: true })).toHaveValue('');
  await login(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('<img src=x onerror=alert(1)>');
  await page.getByRole('link', { name: '← Документы' }).click();
  await expect(page.getByRole('link', { name: '<img src=x onerror=alert(1)>', exact: true })).toHaveAttribute('href', new URL(url).pathname);
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('<img src=x onerror=alert(1)>');
});

test('paginates through authorized HTTP results and supports keyboard login and creation', async ({ page, request }, testInfo) => {
  for (let index = 0; index < 22; index++) {
    const response = await request.post('/api/v1/documents', {
      headers: { Authorization: `Bearer ${bearer}` },
      data: { documentId: require('node:crypto').randomUUID(), name: `Pagination ${index}` }
    });
    expect(response.status()).toBe(201);
  }
  await page.goto('/');
  await page.getByLabel('Bearer-токен', { exact: true }).focus();
  await page.keyboard.type(bearer);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)).toBe('solid');
  await page.keyboard.press('Enter');
  await expect(page.locator('#document-list li')).toHaveCount(20);
  await page.screenshot({ path: testInfo.outputPath('documents.png'), fullPage: true });
  const first = await page.locator('#document-list a').first().getAttribute('href');
  await page.getByRole('button', { name: 'Следующая', exact: true }).click();
  await expect(page.locator('#page-number')).toHaveText('Страница 2');
  await expect(page.getByRole('button', { name: 'Следующая', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Предыдущая', exact: true }).click();
  await expect(page.locator('#document-list a').first()).toHaveAttribute('href', first);
  await page.getByLabel('Имя нового документа').focus();
  await page.keyboard.type('Keyboard document');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Keyboard document');
});

test('shows loading, request errors, retry, forbidden and expired-token states', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/v1/documents?*', async route => {
    await gate;
    await route.fulfill({ status: 500, body: '{}' });
  });
  await page.goto('/');
  await login(page);
  await expect(page.locator('#status')).toHaveText('Загрузка…');
  release();
  await expect(page.locator('#error')).toContainText('Сервер не смог');
  await page.unroute('**/api/v1/documents?*');
  await page.getByRole('button', { name: 'Повторить запрос', exact: true }).click();
  await expect(page.locator('#status')).toContainText(/Документов на странице|Доступных документов нет/);
  await page.route('**/api/v1/documents?*', route => route.abort());
  await page.getByRole('button', { name: 'Обновить список', exact: true }).click();
  await expect(page.locator('#error')).toContainText('Не удалось связаться');
  await page.unroute('**/api/v1/documents?*');
  await page.goto('/documents/00000000-0000-0000-0000-000000000001');
  await login(page);
  await expect(page.locator('#error')).toContainText('Нет доступа');
  await expect(page.locator('#editor-view')).toBeHidden();
  await page.getByRole('button', { name: 'Забыть токен' }).click();
  await login(page, 'invalid-token');
  await expect(page.locator('#error')).toContainText('Сессия завершена. Войдите повторно.');
  await expect(page.getByRole('heading', { name: 'Открыть рабочее пространство' })).toBeVisible();
  await login(page);
  await expect(page.locator('#error')).toContainText('Нет доступа');
});

test('does not retry an ambiguous create automatically and never displays raw errors', async ({ page }) => {
  await page.goto('/');
  await login(page);
  await expect(page.locator('#status')).toContainText(/Документов на странице|Доступных документов нет/);
  let requests = 0;
  await page.route('**/api/v1/documents', route => {
    requests++;
    return route.fulfill({ status: 500, body: '{"detail":"secret raw exception"}' });
  });
  await page.getByLabel('Имя нового документа').fill('Failed create');
  await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await expect(page.locator('#error')).toContainText('Сервер не смог');
  await expect(page.getByRole('button', { name: 'Повторить запрос' })).toBeHidden();
  expect(requests).toBe(1);
  await expect(page.locator('#error')).not.toContainText('secret');
});

test('manages pages with keyboard and confirmation, preserving IDs and revision', async ({ page }) => {
  await page.goto('/'); await login(page);
  await page.getByLabel('Имя нового документа').fill('Pages');
  await page.getByRole('button', { name: 'Создать документ' }).click();
  await expect(page.locator('#editor-view')).toBeVisible();
  await page.getByRole('button', { name: 'Создать страницу' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pages > li > .page-select')).toHaveCount(1);
  const id = await page.evaluate(async () => {
    const result = await fetch(`${location.pathname.replace('/documents/', '/api/v1/documents/')}/pages`, {headers: {Authorization: 'Bearer figvam-ui-test-token-only-at-loopback-5397'}}).then(r => r.json());
    return result.items[0].id;
  });
  await show(page, 'page'); await page.getByLabel('Имя выбранной страницы').fill('Главная');
  await page.getByLabel('Имя выбранной страницы').press('Enter');
  await expect(page.locator('#pages > li > .page-select')).toHaveText('Главная');
  const result = await page.evaluate(async () => fetch(`${location.pathname.replace('/documents/', '/api/v1/documents/')}/pages`, {headers: {Authorization: 'Bearer figvam-ui-test-token-only-at-loopback-5397'}}).then(r => r.json()));
  expect(result.items[0].id).toBe(id);
  await expect(page.locator('#revision')).toHaveText(`Общий черновик · ревизия ${result.revision}`);
  page.once('dialog', dialog => { expect(dialog.message()).toContain('экраны'); dialog.dismiss(); });
  await page.getByRole('button', { name: 'Удалить страницу' }).click();
  await expect(page.locator('#pages > li > .page-select')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Удалить страницу' }).click();
  await expect(page.locator('#pages > li > .page-select')).toHaveCount(0);
});

test('loads all pages into the tree, handles command errors and hides editing for Viewer', async ({ page }) => {
  await page.goto('/'); await login(page);
  await page.getByLabel('Имя нового документа').fill('Paged');
  await page.getByRole('button', { name: 'Создать документ' }).click();
  await expect(page.locator('#editor-view')).toBeVisible();
  const url = page.url();
  for (let i = 0; i < 21; i++) {
    const response = await page.request.post(`${url.replace('/documents/', '/api/v1/documents/')}/commands/add-page`, { headers: { Authorization: `Bearer ${bearer}` }, data: { commandId: require('node:crypto').randomUUID(), pageId: require('node:crypto').randomUUID() } });
    expect(response.ok()).toBeTruthy();
  }
  await page.getByRole('button', { name: 'Обновить страницы' }).click();
  await expect(page.locator('#pages > li > .page-select')).toHaveCount(21);
  await expect(page.locator('#pages-previous')).toHaveCount(0);
  await expect(page.locator('#pages-next')).toHaveCount(0);
  for (const [code, expected] of [['REVISION_CONFLICT', 'Документ изменился'], ['PAGE_IN_USE', 'используется другими объектами'], ['FORBIDDEN', 'Нет доступа']]) {
    await page.route('**/commands/delete-page', route => route.fulfill({ status: code === 'FORBIDDEN' ? 403 : 409, json: { code } }));
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Удалить страницу' }).click();
    await expect(page.locator('#error')).toContainText(expected);
    await page.unroute('**/commands/delete-page');
  }
  await page.route('**/commands/rename-page', route => route.abort());
  await show(page, 'page'); await page.getByLabel('Имя выбранной страницы').fill('Network');
  await page.getByRole('button', { name: 'Переименовать страницу' }).click();
  await expect(page.locator('#error')).toContainText('команда могла выполниться');
  await page.unroute('**/commands/rename-page');
  await page.route('**/api/v1/documents?*', async route => {
    const response = await route.fetch(); const body = await response.json();
    body.items = body.items.map(item => ({ ...item, role: 'Viewer' }));
    await route.fulfill({ response, json: body });
  });
  await page.reload(); await login(page);
  await expect(page.getByText('Только просмотр страниц.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать страницу' })).toBeHidden();
  await expect(page.locator('#pages > li > .page-select').first()).toBeVisible();
});


test('creates and selects all screens in the page tree, validates dimensions and keeps Viewer read-only', async ({ page }) => {
  await page.goto('/'); await login(page);
  await page.getByLabel('Имя нового документа').fill('Screens');
  await page.getByRole('button', { name: 'Создать документ' }).click();
  await page.getByRole('button', { name: 'Создать страницу' }).click();
  await expect(page.locator('#pages > li > .page-select')).toHaveCount(1);
  const width = page.getByLabel('Ширина экрана'), height = page.getByLabel('Высота экрана');
  await width.fill('-1'); await height.fill('600');
  await page.getByRole('button', { name: 'Создать экран' }).click();
  await expect(page.locator('#screens button')).toHaveCount(0);
  await width.fill('800'); await height.fill('600'); await height.press('Enter');
  await expect(page.locator('#screens button')).toHaveCount(1);
  await expect(page.locator('#screens button').first()).toContainText('800 × 600');
  await expect(page.locator('#screens button').first()).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#screens button').first().focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#screens button').first()).toBeFocused();
  for (const [status, code, expected] of [[404, 'PAGE_NOT_FOUND', 'Страница больше не существует'], [403, 'FORBIDDEN', 'Нет доступа']]) {
    await page.route('**/commands/add-screen', route => route.fulfill({ status, json: { code } }));
    await show(page, 'screen');
    await page.getByRole('button', { name: 'Создать экран' }).click();
    await expect(page.locator('#error')).toContainText(expected);
    await page.unroute('**/commands/add-screen');
  }
  await page.route('**/commands/add-screen', route => route.abort());
  await page.getByRole('button', { name: 'Создать экран' }).click();
  await expect(page.locator('#error')).toContainText('команда могла выполниться');
  await page.unroute('**/commands/add-screen');
  const api = page.url().replace('/documents/', '/api/v1/documents/');
  const headers = { Authorization: `Bearer ${bearer}` };
  const pages = await (await page.request.get(`${api}/pages`, { headers })).json();
  await page.getByRole('link', { name: '← Документы' }).click();
  for (let i = 0; i < 20; i++) {
    await postSuccessfully(page.request, `${api}/commands/add-screen`, { headers, data: { commandId: require('node:crypto').randomUUID(), pageId: pages.items[0].id, screenId: require('node:crypto').randomUUID(), dimensions: { width: i, height: 10 } } });
  }
  await page.getByRole('link', { name: 'Screens', exact: true }).click();
  await expect(page.locator('#screens button')).toHaveCount(21);
  await expect(page.locator('#screens-previous')).toHaveCount(0);
  await expect(page.locator('#screens-next')).toHaveCount(0);
  await page.locator('#screens button').last().focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#screens button').last()).toHaveAttribute('aria-pressed', 'true');
  await page.route('**/api/v1/documents?*', async route => { const response = await route.fetch(); const body = await response.json(); body.items = body.items.map(item => ({ ...item, role: 'Viewer' })); await route.fulfill({ response, json: body }); });
  await page.reload(); await login(page);
  await expect(page.getByRole('button', { name: 'Создать экран' })).toBeHidden();
  await expect(page.locator('#screens button')).toHaveCount(21);
});


test('shows selected screen and provides local accessible viewport controls', async ({ page }) => {
  await page.goto('/'); await login(page);
  await page.getByLabel('Имя нового документа').fill('Canvas');
  await page.getByRole('button', { name: 'Создать документ' }).click();
  await page.getByRole('button', { name: 'Создать страницу' }).click();
  await expect(page.getByText('Выберите экран, чтобы показать его на холсте.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Вместить экран' })).toBeDisabled();
  await show(page, 'screen'); await page.getByLabel('Ширина экрана').fill('800'); await page.getByLabel('Высота экрана').fill('600');
  await page.getByRole('button', { name: 'Создать экран' }).click();
  await expect(page.getByText('Экран: 800 × 600 uiUnit')).toBeVisible();
  const boundary = page.locator('#screen-boundary'), area = page.getByRole('region', { name: 'Область холста' });
  await expect(boundary).toBeVisible();
  const revision = await page.locator('#revision').textContent();
  await page.getByRole('button', { name: 'Вместить экран' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '100%', exact: true })).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)).toBe('solid');
  await page.keyboard.press('Enter'); await expect(page.locator('#zoom-level')).toHaveText('100%');
  await expect(area).toHaveCSS('background-size', '20px 20px');
  await page.getByRole('button', { name: 'Увеличить' }).click(); await expect(page.locator('#zoom-level')).toHaveText('125%');
  await expect(area).toHaveCSS('background-size', '25px 25px');
  const before = await boundary.evaluate(el => el.style.transform);
  await area.focus(); await page.keyboard.press('ArrowRight');
  expect(await boundary.evaluate(el => el.style.transform)).not.toBe(before);
  const box = await area.boundingBox();
  await page.mouse.move(box.x + 50, box.y + 50); await page.mouse.down(); await page.mouse.move(box.x + 75, box.y + 75); await page.mouse.up();
  const panned = await boundary.evaluate(el => el.style.transform); expect(panned).not.toBe(before);
  await page.mouse.wheel(0, -100); await expect(page.locator('#zoom-level')).not.toHaveText('125%');
  await page.getByRole('button', { name: 'Вместить экран' }).click();
  expect(await page.locator('#revision').textContent()).toBe(revision);
  await show(page, 'screen'); await page.getByLabel('Ширина экрана').fill('0'); await page.getByLabel('Высота экрана').fill('0');
  await page.getByRole('button', { name: 'Создать экран' }).click();
  await expect(page.getByText('Экран: 0 × 0 uiUnit')).toBeVisible();
  await page.getByRole('button', { name: 'Вместить экран' }).click();
  expect(await boundary.evaluate(el => el.style.transform)).not.toMatch(/NaN|Infinity/);
  await page.locator('#screens button').filter({ hasText: '800 × 600' }).click();
  await expect(page.getByText('Экран: 800 × 600 uiUnit')).toBeVisible();
  await page.getByRole('button', { name: 'Создать страницу' }).click();
  await expect(boundary).toBeHidden();
  await expect(page.locator('#zoom-level')).toHaveText('100%');
  await expect(area).toHaveCSS('background-position', '0px 0px');
});


test('reads paginated nested layers and clears selection on failures and page changes', async ({ page }) => {
  await page.goto('/'); await login(page);
  await page.getByLabel('Имя нового документа').fill('Layers');
  await page.getByRole('button', { name: 'Создать документ' }).click();
  await page.getByRole('button', { name: 'Создать страницу' }).click();
  await show(page, 'screen'); await page.getByLabel('Ширина экрана').fill('800'); await page.getByLabel('Высота экрана').fill('600');
  await page.getByRole('button', { name: 'Создать экран' }).click();
  await expect(page.locator('#screens button')).toHaveCount(1);
  const screenId = await page.locator('#screens button').getAttribute('data-screen-id');
  const root = '11111111-1111-1111-1111-111111111111';
  let mode = 'ok', requests = [];
  await page.route('**/children/**', async route => {
    const url = new URL(route.request().url()), parent = url.pathname.split('/').at(-1), offset = Number(url.searchParams.get('offset'));
    requests.push([parent, offset]);
    if (mode === 'forbidden') return route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } });
    if (mode === 'missing') return route.fulfill({ status: 404, json: { code: 'PARENT_NOT_FOUND' } });
    const all = parent === screenId ? Array.from({ length: 101 }, (_, i) => ({ id: i === 0 ? root : `node-${i}`, name: i === 0 ? '' : `Layer ${i}`, kind: 'Frame', childCount: i === 0 ? 1 : 0 })) : [{ id: 'child', name: 'Nested', kind: 'Text', childCount: 0 }];
    await route.fulfill({ json: { items: all.slice(offset, offset + 100), total: all.length } });
  });
  await page.getByRole('button', { name: 'Обновить страницы' }).click();
  const tree = page.getByRole('tree', { name: 'Слои экрана' });
  await expect(tree.getByRole('treeitem')).toHaveCount(101);
  expect(requests).toContainEqual([screenId, 100]);
  const first = tree.getByRole('treeitem').first();
  await expect(first).toContainText('Без имени');
  await expect(first).toHaveAttribute('aria-label', 'Без имени, Frame');
  await first.focus(); await page.keyboard.press('ArrowRight');
  await expect(tree.getByRole('treeitem')).toHaveCount(102);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.locator('#inspector-selection')).toContainText('Nested · Text · ID: child');
  await expect(tree.locator('[data-id="child"]')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  await expect(tree.getByRole('treeitem')).toHaveCount(101);
  mode = 'missing'; await page.getByRole('button', { name: 'Обновить страницы' }).click();
  await expect(page.locator('#layers-status')).toContainText('больше не существует');
  await expect(page.locator('#inspector-selection')).toHaveText('Выберите слой.');
  await expect(tree.getByRole('treeitem')).toHaveCount(0);
  mode = 'ok'; await page.getByRole('button', { name: 'Обновить страницы' }).click();
  await expect(tree.getByRole('treeitem')).toHaveCount(101);
  await page.getByRole('button', { name: 'Создать страницу' }).click();
  await expect(tree.getByRole('treeitem')).toHaveCount(0);
  await expect(page.locator('#layers-status')).toHaveText('Выберите экран.');
  await page.locator('#pages > li > .page-select').first().click();
  await page.locator('#screens button').first().click();
  await expect(tree.getByRole('treeitem')).toHaveCount(101);
  mode = 'forbidden'; await page.getByRole('button', { name: 'Обновить страницы' }).click();
  await expect(page.locator('#editor-view')).toBeHidden();
  await expect(page.locator('#error')).toContainText('Доступ к документу потерян');
});

test('version success, refusal and safe retry', async ({ page }) => {
  await page.goto('/'); await login(page);
  await page.getByLabel('Имя нового документа').fill('Versions');
  await page.getByRole('button', { name: 'Создать документ' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Versions');
  const name = page.getByLabel('Имя версии (необязательно)');
  await name.fill('Первая'); await name.press('Enter');
  await expect(page.locator('#version-result')).toContainText('Версия создана:');
  await page.route('**/commands/save', route => route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }), { times: 1 });
  await name.fill('Отказ'); await name.press('Enter');
  await expect(page.locator('#version-error')).toContainText('Нет доступа');
  await expect(name).toHaveValue('Отказ');
  const commands = [];
  await page.route('**/commands/save', async route => {
    commands.push(route.request().postDataJSON());
    if (commands.length === 1) { await route.fetch(); await route.abort(); }
    else await route.continue();
  });
  await name.fill('Повтор'); await name.press('Enter');
  await expect(page.locator('#version-error')).toContainText('могла выполниться');
  await expect(name).toHaveValue('Повтор');
  await page.getByRole('button', { name: 'Повторить создание версии' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#version-result')).toContainText('Версия создана:');
  expect(commands).toHaveLength(2); expect(commands[1]).toEqual(commands[0]);
  const history = await page.request.get(`${page.url().replace('/documents/', '/api/v1/documents/')}/versions`, { headers: { Authorization: `Bearer ${bearer}` } });
  expect(history.ok()).toBeTruthy();
  expect((await history.json()).versions.filter(item => item.name === 'Повтор')).toHaveLength(1);
});

test('viewer cannot create a version', async ({ page }) => {
  await page.goto('/'); await login(page);
  await page.getByLabel('Имя нового документа').fill('Viewer');
  await page.getByRole('button', { name: 'Создать документ' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Viewer');
  const url = page.url();
  await page.route('**/api/v1/documents?*', async route => { const response = await route.fetch(); const body = await response.json(); body.items = body.items.map(item => ({ ...item, role: 'Viewer' })); await route.fulfill({ response, json: body }); });
  await page.goto(url); await login(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Viewer');
  await expect(page.getByRole('button', { name: 'Создать версию' })).toBeHidden();
});


test('late version response stays with its document', async ({ page }) => {
  await page.goto('/'); await login(page);
  await page.getByLabel('Имя нового документа').fill('Первый');
  await page.getByRole('button', { name: 'Создать документ' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Первый');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let received;
  const sent = new Promise(resolve => { received = resolve; });
  await page.route('**/commands/save', async route => { const response = await route.fetch(); received(); await gate; await route.fulfill({ response }); });
  await show(page, 'document'); await page.getByLabel('Имя версии (необязательно)').fill('Снимок');
  await show(page, 'document'); await page.getByRole('button', { name: 'Создать версию' }).click();
  await sent;
  await page.getByRole('link', { name: '← Документы' }).click();
  await page.getByLabel('Имя нового документа').fill('Второй');
  await page.getByRole('button', { name: 'Создать документ' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Второй');
  release();
  await expect(page.locator('#version-result')).toBeEmpty();
  await expect(page.getByLabel('Имя версии (необязательно)')).toHaveValue('');
  await page.getByRole('link', { name: '← Документы' }).click();
  await page.getByRole('link', { name: 'Первый', exact: true }).click();
  await expect(page.locator('#version-result')).toContainText('Версия создана:');
});


test('history pagination, viewer access and errors', async ({ page }) => {
  await page.goto('/'); await login(page);
  await page.getByLabel('Имя нового документа').fill('History'); await page.getByRole('button', { name: 'Создать документ' }).click();
  await expect(page.locator('#versions-status')).toContainText('нет');
  await show(page, 'document'); await page.getByLabel('Имя версии (необязательно)').fill('Первая'); await show(page, 'document'); await page.getByRole('button', { name: 'Создать версию' }).click();
  await expect(page.locator('#versions-list')).toContainText('Первая'); await expect(page.locator('#versions-list')).toContainText('Автор:');
  await page.route('**/versions?*', async route => {
    const second = new URL(route.request().url()).searchParams.has('beforeRevision');
    await route.fulfill({ json: { versions: [{ id: '00000000-0000-0000-0000-000000000001', name: second ? 'Старая' : 'Новая', authorId: 'Автор', timestamp: '2025-01-01T00:00:00Z', revision: second ? 1 : 2 }], nextBeforeRevision: second ? null : 2 } });
  });
  await show(page, 'document'); await page.getByRole('button', { name: 'Обновить историю' }).click(); await expect(page.locator('#versions-list')).toContainText('Новая');
  await show(page, 'document'); await page.getByRole('button', { name: 'Следующие версии' }).click(); await expect(page.locator('#versions-list')).toContainText('Старая');
  await show(page, 'document'); await page.getByRole('button', { name: 'Предыдущие версии' }).click(); await expect(page.locator('#versions-list')).toContainText('Новая');
  const url = page.url();
  await page.route('**/api/v1/documents?*', async route => { const response = await route.fetch(); const body = await response.json(); body.items = body.items.map(item => ({ ...item, role: 'Viewer' })); await route.fulfill({ response, json: body }); });
  await page.goto(url); await login(page); await expect(page.locator('#versions-list')).toContainText('Новая'); await expect(page.locator('#versions-list button')).toHaveCount(0);
  await page.route('**/versions?*', route => route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }), { times: 1 });
  await show(page, 'document'); await page.getByRole('button', { name: 'Обновить историю' }).click(); await expect(page.locator('#versions-error')).toContainText('Нет доступа');
});

test('restore confirmation, conflict and idempotent retry', async ({ page }) => {
  await page.goto('/'); await login(page);
  await page.getByLabel('Имя нового документа').fill('Restore'); await page.getByRole('button', { name: 'Создать документ' }).click();
  await show(page, 'document'); await page.getByLabel('Имя версии (необязательно)').fill('Исходная'); await show(page, 'document'); await page.getByRole('button', { name: 'Создать версию' }).click();
  const restore = page.getByRole('button', { name: /Восстановить версию Исходная/ }); await expect(restore).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss()); await restore.click(); await expect(page.locator('#restore-status')).toBeEmpty();
  await page.route('**/commands/restore', route => route.fulfill({ status: 409, json: { code: 'REVISION_CONFLICT' } }), { times: 1 });
  page.once('dialog', dialog => dialog.accept()); await restore.click(); await expect(page.locator('#restore-error')).toContainText('конфликтует');
  await page.route('**/commands/restore', route => route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }), { times: 1 });
  page.once('dialog', dialog => dialog.accept()); await restore.click(); await expect(page.locator('#restore-error')).toContainText('Нет доступа');
  const priorRevision = await page.locator('#revision').textContent();
  const commands = [];
  await page.route('**/commands/restore', async route => { commands.push(route.request().postDataJSON()); if (commands.length === 1) { await route.fetch(); await route.abort(); } else await route.continue(); });
  let confirmation; page.once('dialog', dialog => { confirmation = dialog.message(); return dialog.accept(); }); await restore.click();
  await expect(page.locator('#restore-error')).toContainText('могла выполниться'); expect(confirmation).toContain('новая ревизия'); expect(confirmation).toContain('не удалится');
  await page.getByRole('button', { name: 'Повторить восстановление' }).click(); await expect(page.locator('#restore-status')).toContainText('восстановлена');
  await expect(page.locator('#revision')).toContainText('Общий черновик'); await expect(page.locator('#revision')).not.toHaveText(priorRevision); expect(commands).toHaveLength(2); expect(commands[1]).toEqual(commands[0]);
  await expect(page.locator('#versions-list')).toContainText('Исходная');
});

test('late restore response does not alter another document', async ({ page }) => {
  await page.goto('/'); await login(page);
  await page.getByLabel('Имя нового документа').fill('Первый restore'); await page.getByRole('button', { name: 'Создать документ' }).click();
  await show(page, 'document'); await page.getByLabel('Имя версии (необязательно)').fill('Версия'); await show(page, 'document'); await page.getByRole('button', { name: 'Создать версию' }).click();
  await expect(page.getByRole('button', { name: /Восстановить версию Версия/ })).toBeVisible();
  let release, received; const gate = new Promise(resolve => release = resolve), sent = new Promise(resolve => received = resolve);
  await page.route('**/commands/restore', async route => { const response = await route.fetch(); received(); await gate; await route.fulfill({ response }); });
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: /Восстановить версию Версия/ }).click(); await sent;
  await page.getByRole('link', { name: '← Документы' }).click(); await page.getByLabel('Имя нового документа').fill('Второй restore'); await page.getByRole('button', { name: 'Создать документ' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Второй restore'); release();
  await expect(page.locator('#restore-status')).toBeEmpty(); await expect(page.locator('#versions-status')).toContainText('нет');
  await page.getByRole('link', { name: '← Документы' }).click(); await page.getByRole('link', { name: 'Первый restore' }).click(); await expect(page.locator('#restore-status')).toContainText('восстановлена');
});
