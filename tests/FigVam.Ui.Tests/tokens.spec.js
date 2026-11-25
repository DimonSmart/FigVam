const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');
const { randomUUID } = require('node:crypto');
async function open(page) {
  await page.goto('/'); await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByLabel('Имя нового документа').fill('Tokens'); await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await show(page, 'tokens');
  await expect(page.getByRole('heading', { name: 'Дизайн-токены' })).toBeVisible();
}
test('creates, renames, updates and follows direct usages', async ({ page, request }) => {
  await open(page); await page.locator('#new-token-open').click(); await page.getByLabel('Имя токена', { exact: true }).fill('Space');
  await page.getByLabel('Тип токена').selectOption('Spacing');
  await page.getByLabel('Light', { exact: true }).fill('8'); await page.getByLabel('Dark', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Создать токен' }).click(); await expect(page.locator('#token-values')).toHaveText('Light: 8; Dark: 12');
  await page.getByLabel('Новое имя токена').fill('Gap'); await page.getByRole('button', { name: 'Переименовать токен' }).click();
  await expect(page.locator('#token-detail-title')).toHaveText('Gap');
  await page.getByRole('region', { name: 'Дизайн-токены' }).getByLabel('Тема', { exact: true }).selectOption('Dark'); await page.getByLabel('Новое значение').fill('24');
  await page.getByRole('button', { name: 'Сохранить значение' }).click(); await expect(page.locator('#token-values')).toHaveText('Light: 8; Dark: 24');
  const doc = page.url().split('/').pop(), headers = { Authorization: `Bearer ${bearer}` };
  const tokens = await (await request.get(`/api/v1/documents/${doc}/tokens`, { headers })).json();
  const alias = { expression: 'alias', tokenId: tokens.items[0].id };
  expect((await request.post(`/api/v1/documents/${doc}/commands/add-token`, { headers, data: { commandId: randomUUID(), tokenId: randomUUID(), name: 'Alias', type: 1, values: { Light: alias, Dark: alias } } })).ok()).toBeTruthy();
  await expect(page.locator('#tokens-list')).toContainText('Alias'); await expect(page.locator('#token-usages')).toContainText('Alias');
});
test('validates input and displays authorization errors', async ({ page }) => {
  await open(page); await page.locator('#new-token-open').click(); await page.getByLabel('Имя токена', { exact: true }).fill('Color');
  await page.getByLabel('Light', { exact: true }).fill('bad'); await page.getByLabel('Dark', { exact: true }).fill('#000000');
  await page.getByRole('button', { name: 'Создать токен' }).click(); await expect(page.locator('#tokens-error')).toContainText('#RRGGBB');
  await page.getByLabel('Light', { exact: true }).fill('#ffffff');
  await page.route('**/commands/add-token', route => route.fulfill({ status: 403, contentType: 'application/json', body: '{"code":"FORBIDDEN"}' }));
  await page.getByRole('button', { name: 'Создать токен' }).click(); await expect(page.locator('#tokens-error')).toContainText('Нет доступа');
});
test('viewer inspects tokens without mutation controls', async ({ page }) => {
  await page.route('**/api/v1/documents?*', async route => { const response = await route.fetch(), body = await response.json(); for (const item of body.items) item.role = 'Viewer'; await route.fulfill({ response, json: body }); });
  const id = randomUUID(), headers = { Authorization: `Bearer ${bearer}` };
  expect((await page.request.post('/api/v1/documents', { headers, data: { documentId: id, name: 'Read only' } })).ok()).toBeTruthy();
  const literal = { expression: 'literal', value: { type: 'spacing', value: 8 } };
  expect((await page.request.post(`/api/v1/documents/${id}/commands/add-token`, { headers, data: { commandId: randomUUID(), tokenId: randomUUID(), name: 'Space', type: 1, values: { Light: literal, Dark: literal } } })).ok()).toBeTruthy();
  await page.goto(`/documents/${id}`); await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer); await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await show(page, 'tokens');
  await page.getByRole('button', { name: 'Space', exact: true }).click(); await expect(page.locator('#token-values')).toContainText('Light: 8');
  await expect(page.locator('#token-usages')).toContainText('Использований нет');
  await expect(page.getByRole('button', { name: 'Создать токен' })).toBeHidden(); await expect(page.getByRole('button', { name: 'Переименовать токен' })).toBeHidden();
});

test('creates and updates color values including alpha', async ({ page }) => {
  await open(page); await page.locator('#new-token-open').click(); await page.getByLabel('Имя токена', { exact: true }).fill('Ink');
  await page.getByLabel('Light', { exact: true }).fill('#123456'); await page.getByLabel('Dark', { exact: true }).fill('#ABCDEF80');
  await page.getByRole('button', { name: 'Создать токен' }).click();
  await expect(page.locator('#token-values')).toHaveText('Light: #123456FF; Dark: #ABCDEF80');
  await page.getByLabel('Новое значение').fill('#01020304'); await page.getByRole('button', { name: 'Сохранить значение' }).click();
  await expect(page.locator('#token-values')).toHaveText('Light: #01020304; Dark: #ABCDEF80');
});

test('creates categorized font-size tokens and multi-level theme aliases with the current profile', async ({ page }) => {
  await open(page);
  await page.locator('#new-token-open').click(); await page.getByLabel('Имя токена', { exact: true }).fill('Body Size');
  await page.locator('#new-token-type').selectOption('Dimension');
  await page.locator('#new-token-category').selectOption('FontSize');
  await page.getByLabel('Light', { exact: true }).fill('16');
  await page.getByLabel('Dark', { exact: true }).fill('18');
  await page.getByRole('button', { name: 'Создать токен' }).click();
  await expect(page.locator('#token-detail-title')).toHaveText('Body Size');
  await expect(page.locator('#token-values')).toContainText('Light: 16; Dark: 18');
  await page.locator('#new-token-open').click(); await page.getByLabel('Имя токена', { exact: true }).fill('Semantic Size');
  await page.locator('#new-token-type').selectOption('Dimension');
  await page.locator('#new-token-category').selectOption('FontSize');
  await page.locator('#new-token-light-mode').selectOption('alias');
  await page.locator('#new-token-dark-mode').selectOption('alias');
  await page.locator('#new-token-light-alias').selectOption({ label: 'Body Size' });
  await page.locator('#new-token-dark-alias').selectOption({ label: 'Body Size' });
  await page.getByRole('button', { name: 'Создать токен' }).click();
  await expect(page.locator('#token-values')).toContainText('↳ Body Size');
  await expect(page.locator('#tokens-list')).toContainText('Dimension.FontSize');
  await page.locator('#token-theme').selectOption('Dark');
  await page.locator('#token-mode').selectOption('literal');
  await page.getByLabel('Новое значение').fill('20');
  await page.getByRole('button', { name: 'Сохранить значение' }).click();
  await expect(page.locator('#token-values')).toContainText('Dark: 20');
});

test('group tree, global search, type filter, conflicts and deletion', async ({ page }) => {
  await open(page);
  async function add(name, type, value) {
    await page.locator('#new-token-open').click();
    await page.locator('#new-token-name').fill(name);
    await page.locator('#new-token-type').selectOption(type);
    await page.getByLabel('Light', { exact: true }).fill(value);
    await page.getByLabel('Dark', { exact: true }).fill(value);
    await page.getByRole('button', { name: 'Создать токен' }).click();
    await expect(page.locator('#token-detail-title')).not.toBeEmpty();
    await expect(page.locator('#token-create')).toBeHidden();
  }
  await add('Accent.Button','Color','#FF0000');
  await add('Accent/Border','Color','#000000');
  await add('Spacing.Small','Spacing','8');
  await page.getByRole('button', { name: 'Свернуть все группы', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accent · 2', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Раскрыть все группы', exact: true }).click();
  await page.getByRole('button', { name: 'Accent · 2', exact: true }).click();
  const table = page.locator('#tokens-list');
  await expect(table.getByRole('button', {name:'Button',exact:true})).toBeVisible();
  await expect(table.getByRole('button', {name:'Border',exact:true})).toBeVisible();
  await expect(table).not.toContainText('Spacing.Small');
  await page.locator('#new-token-open').click();
  await expect(page.locator('#new-token-name')).toHaveValue('Accent.');
  await page.locator('#new-token-name').fill('Hover');
  await page.getByLabel('Light', { exact: true }).fill('#001122');
  await page.getByLabel('Dark', { exact: true }).fill('#223344');
  await page.getByRole('button', {name:'Создать токен'}).click();
  await expect(page.locator('#token-detail-title')).toHaveText('Accent.Hover');
  await page.locator('#new-token-open').click();
  await page.locator('#new-token-name').fill('Accent.Button.More');
  await page.getByLabel('Light', {exact:true}).fill('#000000');
  await page.getByLabel('Dark', {exact:true}).fill('#000000');
  await page.getByRole('button', {name:'Создать токен'}).click();
  await expect(page.locator('#tokens-error')).toContainText('Конфликт токена и группы');
  await page.locator('#new-token-cancel').click();
  await page.locator('#token-search').fill('small');
  await expect(table).toContainText('Spacing.Small');
  await page.locator('#token-type-filter').selectOption('Color');
  await expect(table).toContainText('Нет токенов');
  await page.locator('#token-type-filter').selectOption('Spacing');
  await table.getByRole('button',{name:'Spacing.Small',exact:true}).click();
  await expect(page.locator('#token-detail-title')).toHaveText('Spacing.Small');
  await expect(page.locator('#token-usages')).toContainText('Использований нет');
  await page.locator('#document-mode-editor').click();
  await expect(page.locator('.workspace')).toBeVisible();
  await show(page, 'tokens');
  await expect(page.locator('#token-search')).toHaveValue('small');
  await expect(page.locator('#token-detail-title')).toHaveText('Spacing.Small');
  await page.locator('#token-delete').click();
  await expect(table).toContainText('Нет токенов');
  await expect(page.locator('#token-detail')).toBeHidden();
});

test('DTCG import and export through the token workspace', async ({ page }) => {
  await open(page);
  const theme = red => JSON.stringify({ Accent: { Button: { $type:'color', $value:{colorSpace:'srgb',components:[red,0,0],alpha:1} } } });
  await page.locator('#token-import-open').click();
  await page.locator('#token-import-light-file').setInputFiles({name:'light.json',mimeType:'application/json',buffer:Buffer.from(theme(1))});
  await expect(page.locator('#token-import-light')).toHaveValue(theme(1));
  await page.locator('#token-import-dark').fill(theme(0));
  await page.getByRole('button',{name:'Импортировать токены'}).click();
  await expect(page.locator('#tokens-list')).toContainText('Accent.Button');
  await expect(page.locator('#token-import-form')).toBeHidden();
  for (const selected of ['Light','Dark']) {
    await page.locator('#token-export-theme').selectOption(selected);
    const downloaded = page.waitForEvent('download');
    await page.locator('#token-export').click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe('tokens-' + selected.toLowerCase() + '.json');
    const body = JSON.parse(require('node:fs').readFileSync(await file.path(),'utf8'));
    expect(body.Accent.Button.$value.components[0]).toBe(selected === 'Light' ? 1 : 0);
  }
});

test('token grouping helpers handle mixed separators, hierarchy, relative names and conflicts', async () => {
  const { pathToFileURL } = require('node:url');
  const { resolve } = require('node:path');
  const { tokenSegments, buildTokenGroups, shortTokenName, visibleTokens, qualifyTokenName, tokenNameError, tokenNameDiagnostics } =
    await import(pathToFileURL(resolve(__dirname, '../../src/FigVam.Server/wwwroot/token-groups.js')).href);
  const items = [
    { id:'1', name:'Accent.Button', type:'Color' },
    { id:'2', name:'Accent/Border', type:'Color' },
    { id:'3', name:'Typography.Heading/H1', type:'Typography' },
    { id:'4', name:'Standalone', type:'Spacing' }
  ];
  expect(tokenSegments('Color.Accent/Button')).toEqual(['Color','Accent','Button']);
  const root = buildTokenGroups(items);
  expect(root.count).toBe(4);
  expect(root.children.get('Accent').count).toBe(2);
  expect(root.children.get('Typography').children.get('Heading').count).toBe(1);
  expect(shortTokenName('Typography.Heading/H1',['Typography','Heading'])).toBe('H1');
  expect(qualifyTokenName('Hover',['Accent'])).toBe('Accent.Hover');
  expect(qualifyTokenName('Other/Hover',['Accent'])).toBe('Other/Hover');
  expect(tokenNameError('Accent/Button',items)).toContain('Конфликт имени');
  expect(tokenNameError('Accent',items)).toContain('Конфликт токена и группы');
  expect(tokenNameError('Accent.Button.More',items)).toContain('Конфликт токена и группы');
  expect(tokenNameError('Accent..More',items)).toContain('непустые сегменты');
  expect(tokenNameError('Accent.Button',items,'1')).toBe('');
  expect(tokenNameDiagnostics(items).size).toBe(0);
  const conflicts = tokenNameDiagnostics([...items, {id:'5',name:'Accent',type:'Color'}, {id:'6',name:'Accent/Button',type:'Color'}]);
  expect(conflicts.has('1')).toBeTruthy();
  expect(conflicts.has('2')).toBeTruthy();
  expect(conflicts.has('5')).toBeTruthy();
  expect(conflicts.has('6')).toBeTruthy();
  const typeOf = item => item.type;
  expect(visibleTokens(items,['Accent'],'','Color',typeOf).map(t=>t.id).sort()).toEqual(['1','2']);
  expect(visibleTokens(items,['Accent'],'heading.h1','Typography',typeOf).map(t=>t.id)).toEqual(['3']);
  expect(visibleTokens(items,[],'','Spacing',typeOf).map(t=>t.id)).toEqual(['4']);
  const large = Array.from({length:500},(_,i)=>({id:String(i),name:'Group'+(i%10)+'/Nested.Item'+i,type:'Color'}));
  expect(buildTokenGroups(large).children.size).toBe(10);
  expect(visibleTokens(large,['Group1','Nested'],'','Color',typeOf)).toHaveLength(50);
});

test('hundreds of persisted tokens stay navigable without a domain format change', async ({ page, request }) => {
  await open(page);
  const doc = page.url().split('/').pop(), headers = {Authorization: 'Bearer ' + bearer};
  const data = {};
  for (let group = 0; group < 10; group++) {
    data['Group'+group] = {};
    for (let i = 0; i < 30; i++) data['Group'+group]['Item'+i] = {
      $type:'color', $value:{colorSpace:'srgb',components:[0,0,0],alpha:1}
    };
  }
  const imported = await request.post('/api/v1/documents/'+doc+'/commands/import-design-tokens',{
    headers, data:{commandId:randomUUID(),expectedRevision:0,lightJson:JSON.stringify(data),darkJson:JSON.stringify(data),dimensionTypes:{}}
  });
  expect(imported.ok(), await imported.text()).toBeTruthy();
  await expect(page.locator('#tokens-list tr')).toHaveCount(300);
  await page.getByRole('button',{name:'Group5 · 30',exact:true}).click();
  await expect(page.locator('#tokens-list tr')).toHaveCount(30);
  await page.locator('#token-search').fill('Group7.Item19');
  await expect(page.locator('#tokens-list tr')).toHaveCount(1);
  await page.getByRole('button',{name:'Group7.Item19',exact:true}).click();
  await expect(page.locator('#token-values')).toContainText('Light: #000000FF');
  await page.reload();
  await page.getByLabel('Bearer-токен', {exact:true}).fill(bearer);
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await show(page,'tokens');
  await expect(page.locator('#tokens-list tr')).toHaveCount(300);
});
