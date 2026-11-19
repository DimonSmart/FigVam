const { test, expect, bearer } = require('./fixtures');
const { randomUUID } = require('node:crypto');
async function open(page) {
 await page.goto('/'); await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer); await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
 await page.getByLabel('Имя нового документа').fill('Data'); await page.getByRole('button', { name: 'Создать документ', exact: true }).click(); await expect(page.locator('#datasets-status')).toContainText('Датасетов пока нет');
}
test('creates, replaces and confirms deletion', async ({ page }) => {
 await open(page); await page.getByLabel('Имя датасета').fill('People'); await page.getByLabel('Содержимое нового снимка').fill('[{"name":"Ana"}]');
 await page.getByRole('button', { name: 'Создать датасет' }).click(); await expect(page.locator('#dataset-fixture')).toHaveText('[{"name":"Ana"}]');
 await page.getByLabel('Содержимое замены').fill('[2]'); await page.getByRole('button', { name: 'Заменить фикстуру' }).click(); await expect(page.locator('#dataset-fixture')).toHaveText('[2]');
 await page.getByLabel('Формат замены').selectOption('csv'); await page.getByLabel('Содержимое замены').fill('name\nBob'); await page.getByRole('button', { name: 'Заменить фикстуру' }).click(); await expect(page.locator('#dataset-fixture')).toHaveText('[{"name":"Bob"}]');
 page.once('dialog', d => d.dismiss()); await page.getByRole('button', { name: 'Удалить датасет' }).click(); await expect(page.locator('#dataset-title')).toHaveText('People');
 page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Удалить датасет' }).click(); await expect(page.locator('#datasets-status')).toContainText('Датасетов пока нет');
 await page.getByLabel('Имя датасета').fill('CSV'); await page.getByLabel('Формат нового снимка').selectOption('csv'); await page.getByLabel('Содержимое нового снимка').fill('name\nC'); await page.getByRole('button', { name: 'Создать датасет' }).click(); await expect(page.locator('#dataset-fixture')).toHaveText('[{"name":"C"}]');
});
test('retries a lost response with the same command and handles validation', async ({ page }) => {
 await open(page); const bodies = []; await page.route('**/commands/add-dataset', async route => { bodies.push(route.request().postData()); if (bodies.length === 1) { await route.fetch(); await route.abort(); } else await route.continue(); });
 await page.getByLabel('Имя датасета').fill('Once'); await page.getByLabel('Содержимое нового снимка').fill('[]'); await page.getByRole('button', { name: 'Создать датасет' }).click(); await expect(page.locator('#datasets-error')).toContainText('неизвестен');
 await page.getByRole('button', { name: 'Повторить операцию с датасетом' }).click(); await expect(page.locator('#dataset-fixture')).toHaveText('[]'); expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]);
 await page.getByLabel('Имя датасета').fill('Invalid'); await page.getByLabel('Содержимое нового снимка').fill('{'); await page.getByRole('button', { name: 'Создать датасет' }).click(); await expect(page.locator('#datasets-error')).toContainText('Проверьте');
});
test('viewer reads fixture without edit controls', async ({ page, request }) => {
 const id = randomUUID(), datasetId = randomUUID(), headers = { Authorization: `Bearer ${bearer}` };
 expect((await request.post('/api/v1/documents', { headers, data: { documentId: id, name: 'View' } })).ok()).toBeTruthy(); expect((await request.post(`/api/v1/documents/${id}/commands/add-dataset`, { headers, data: { commandId: randomUUID(), datasetId, name: 'Fixture', fixtureJson: '[1]' } })).ok()).toBeTruthy();
 await page.route('**/api/v1/documents?*', async route => { const response = await route.fetch(), body = await response.json(); for (const item of body.items) item.role = 'Viewer'; await route.fulfill({ response, json: body }); });
 await page.goto(`/documents/${id}`); await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer); await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await page.getByRole('button', { name: 'Fixture', exact: true }).click(); await expect(page.locator('#dataset-fixture')).toHaveText('[1]'); await expect(page.locator('#dataset-edit')).toBeHidden();
});

test('shows refusal and refreshes after conflict', async ({ page }) => {
 await open(page); await page.getByLabel('Имя датасета').fill('Fixture'); await page.getByLabel('Содержимое нового снимка').fill('[]');
 await page.route('**/commands/add-dataset', route => route.fulfill({status:403, json:{code:'FORBIDDEN'}})); await page.getByRole('button', {name:'Создать датасет'}).click(); await expect(page.locator('#datasets-error')).toContainText('Нет доступа');
 await page.unroute('**/commands/add-dataset'); await page.getByRole('button', {name:'Создать датасет'}).click(); await expect(page.locator('#dataset-fixture')).toHaveText('[]');
 await page.route('**/commands/replace-dataset-fixture', route => route.fulfill({status:409, json:{code:'REVISION_CONFLICT'}})); await page.getByLabel('Содержимое замены').fill('[1]'); await page.getByRole('button', {name:'Заменить фикстуру'}).click(); await expect(page.locator('#datasets-error')).toContainText('Документ изменился');
 await page.getByRole('button', {name:'Повторить загрузку датасетов'}).click(); await expect(page.locator('#dataset-fixture')).toHaveText('[]');
});
test('paginates and retries list reads', async ({ page }) => {
 await open(page); let fail = true; await page.route('**/datasets?*', async route => { const url = new URL(route.request().url()); if (fail) { fail = false; return route.fulfill({status:403,json:{code:'FORBIDDEN'}}); } const offset = Number(url.searchParams.get('offset')); return route.fulfill({json:{revision:Number(url.searchParams.get('revision')),total:21,items:Array.from({length:offset ? 1 : 20}, (_,i)=>({id:randomUUID(), name:`Dataset ${offset+i+1}`}))}}); });
 await page.getByRole('button', {name:'Обновить страницы'}).click(); await expect(page.locator('#datasets-error')).toContainText('Нет доступа'); await page.getByRole('button', {name:'Повторить загрузку датасетов'}).click(); await expect(page.locator('#datasets-number')).toHaveText('1–20 из 21'); await page.getByRole('button', {name:'Следующие датасеты'}).click(); await expect(page.locator('#datasets-number')).toHaveText('21–21 из 21');
});

