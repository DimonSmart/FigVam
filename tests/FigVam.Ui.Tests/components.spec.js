const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');
const { randomUUID } = require('node:crypto');

test('catalog searches, pages and reads detail and usages at the editor revision', async ({ page }) => {
  const id = randomUUID(), headers = { Authorization: `Bearer ${bearer}` };
  expect((await page.request.post('/api/v1/documents', { headers, data: { documentId: id, name: 'Catalog' } })).ok()).toBeTruthy();
  const componentId = randomUUID(), revisions = [];
  const component = { id: componentId, name: 'Button', description: '<script>description</script>', parameters: [{ name: 'Label', type: 0, defaultValue: { valueType: 'text', value: 'OK' } }], slots: [{ name: 'Content', containerNodeId: 'container' }], variants: [{ name: 'Hover', kind: 1 }] };
  await page.route('**/api/v1/documents/*/components**', async route => {
    const url = new URL(route.request().url()); revisions.push(url.searchParams.get('revision'));
    const offset = Number(url.searchParams.get('offset') || 0);
    if (url.pathname.endsWith('/usages')) return route.fulfill({ json: { items: Array.from({ length: offset ? 1 : 20 }, (_, i) => ({ nodeId: `node-${offset + i}` })), total: 21 } });
    if (url.pathname.endsWith(componentId)) return route.fulfill({ json: { component } });
    const search = url.searchParams.get('search');
    return route.fulfill({ json: { items: search === 'missing' ? [] : offset ? [{ ...component, name: 'Second page' }] : [component], total: search === 'missing' ? 0 : 21 } });
  });
  await page.goto(`/documents/${id}`); await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer); await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await show(page, 'components');
  await page.getByRole('button', { name: 'Button', exact: true }).click();
  await expect(page.locator('#component-description')).toHaveText('<script>description</script>');
  await expect(page.locator('#component-parameters')).toContainText('Label · Text'); await expect(page.locator('#component-slots')).toContainText('Content'); await expect(page.locator('#component-variants')).toContainText('Hover');
  await expect(page.locator('#component-usages')).toContainText('node-0'); await page.getByRole('button', { name: 'Следующие использования' }).click(); await expect(page.locator('#component-usages')).toContainText('node-20');
  await page.getByRole('button', { name: 'Следующие компоненты' }).click(); await expect(page.locator('#components-list')).toContainText('Second page');
  await page.getByLabel('Поиск компонентов').fill('missing'); await page.getByRole('button', { name: 'Найти компоненты' }).click(); await expect(page.locator('#components-status')).toHaveText('Компоненты не найдены.');
  expect(revisions.length).toBeGreaterThan(3); expect(new Set(revisions).size).toBe(1); expect(revisions[0]).not.toBeNull();
});

test('catalog reports errors and can retry without blocking the editor', async ({ page }) => {
  const id = randomUUID(), headers = { Authorization: `Bearer ${bearer}` };
  expect((await page.request.post('/api/v1/documents', { headers, data: { documentId: id, name: 'Catalog errors' } })).ok()).toBeTruthy();
  let fail = true;
  await page.route('**/api/v1/documents/*/components**', route => fail ? route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }) : route.fulfill({ json: { items: [], total: 0 } }));
  await page.goto(`/documents/${id}`); await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer); await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await show(page, 'components');
  await expect(page.locator('#components-error')).toContainText('Нет доступа'); await expect(page.getByRole('heading', { name: 'Холст' })).toBeVisible();
  fail = false; await page.getByRole('button', { name: 'Повторить загрузку каталога' }).click(); await expect(page.locator('#components-status')).toHaveText('Компоненты не найдены.');
});

test('catalog ignores a late search response', async ({ page }) => {
  const id = randomUUID(), headers = { Authorization: `Bearer ${bearer}` };
  expect((await page.request.post('/api/v1/documents', { headers, data: { documentId: id, name: 'Catalog race' } })).ok()).toBeTruthy();
  let releaseSlow, slowStarted;
  const slow = new Promise(resolve => { releaseSlow = resolve; });
  const started = new Promise(resolve => { slowStarted = resolve; });
  await page.route('**/api/v1/documents/*/components**', async route => {
    const search = new URL(route.request().url()).searchParams.get('search');
    if (search === 'slow') { slowStarted(); await slow; }
    const name = search === 'slow' ? 'Old result' : search === 'fast' ? 'Current result' : 'Initial result';
    await route.fulfill({ json: { items: [{ id: randomUUID(), name }], total: 1 } });
  });
  await page.goto(`/documents/${id}`); await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer); await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await show(page, 'components');
  await expect(page.locator('#components-list')).toContainText('Initial result');
  await page.getByLabel('Поиск компонентов').fill('slow'); await page.getByRole('button', { name: 'Найти компоненты' }).click(); await started;
  await page.getByLabel('Поиск компонентов').fill('fast'); await page.getByRole('button', { name: 'Найти компоненты' }).click();
  await expect(page.locator('#components-list')).toContainText('Current result');
  const oldResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get('search') === 'slow');
  releaseSlow(); await oldResponse;
  await expect(page.locator('#components-list')).toHaveText('Current result');
});
