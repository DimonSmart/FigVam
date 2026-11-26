const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');
const { randomUUID } = require('node:crypto');
async function open(page) {
  await page.goto('/'); await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByLabel('Имя нового документа').fill('Tokens'); await page.getByRole('button', { name: 'Создать документ', exact: true }).click();
  await show(page, 'tokens');
  await expect(page.getByRole('region', { name: 'Токены', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Дизайн-токены' })).toHaveCount(0);
}
test('creates, renames, updates and follows direct usages', async ({ page, request }) => {
  await open(page); await page.locator('#token-menu-open').click(); await page.locator('#new-token-open').click(); await page.getByLabel('Имя токена', { exact: true }).fill('Space');
  await page.getByLabel('Тип токена').selectOption('Spacing');
  await page.getByLabel('Light', { exact: true }).fill('8'); await page.getByLabel('Dark', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Создать токен' }).click(); await expect(page.locator('#token-light')).toHaveValue('8'); await expect(page.locator('#token-dark')).toHaveValue('12');
  await page.getByRole('button', { name: 'Переименовать токен', exact: true }).click();
  await page.getByLabel('Новое имя токена').fill('Gap'); await page.getByLabel('Новое имя токена').press('Enter');
  await expect(page.locator('#token-detail-title')).toHaveText('Gap');
  await page.getByRole('button', { name: 'Переименовать токен', exact: true }).click();
  await page.locator('#token-name').fill('Discarded'); await page.locator('#token-name').press('Escape');
  await expect(page.locator('#token-detail-title')).toHaveText('Gap');
  await page.locator('#token-dark').fill('24'); await page.locator('#token-dark').press('Enter');
  await expect(page.locator('#tokens-list')).toContainText('24 px'); await expect(page.locator('#token-light')).toHaveValue('8');
  const doc = page.url().split('/').pop(), headers = { Authorization: `Bearer ${bearer}` };
  const tokens = await (await request.get(`/api/v1/documents/${doc}/tokens`, { headers })).json();
  const alias = { expression: 'alias', tokenId: tokens.items[0].id };
  expect((await request.post(`/api/v1/documents/${doc}/commands/add-token`, { headers, data: { commandId: randomUUID(), tokenId: randomUUID(), name: 'Alias', type: 1, values: { Light: alias, Dark: alias } } })).ok()).toBeTruthy();
  await expect(page.locator('#tokens-list')).toContainText('Alias'); await expect(page.locator('#token-usages')).toContainText('Alias');
});
test('validates input and displays authorization errors', async ({ page }) => {
  await open(page); await page.locator('#token-menu-open').click(); await page.locator('#new-token-open').click(); await page.getByLabel('Имя токена', { exact: true }).fill('Color');
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
  await page.getByRole('button', { name: 'Space', exact: true }).click(); await expect(page.locator('#token-light')).toHaveValue('8'); await expect(page.locator('#token-light')).toBeDisabled();
  await expect(page.locator('#token-usages')).toContainText('Использований нет');
  await expect(page.getByRole('button', { name: 'Создать токен' })).toBeHidden(); await expect(page.getByRole('button', { name: 'Переименовать токен' })).toBeHidden();
});

test('creates and updates color values including alpha', async ({ page }) => {
  await open(page); await page.locator('#token-menu-open').click(); await page.locator('#new-token-open').click(); await page.getByLabel('Имя токена', { exact: true }).fill('Ink');
  await page.getByLabel('Light', { exact: true }).fill('#123456'); await page.getByLabel('Dark', { exact: true }).fill('#ABCDEF80');
  await page.getByRole('button', { name: 'Создать токен' }).click();
  await expect(page.locator('#token-light')).toHaveValue('#123456FF'); await expect(page.locator('#token-dark')).toHaveValue('#ABCDEF80');
  await page.locator('#token-light').fill('#01020304'); await page.locator('#token-light').press('Enter');
  await expect(page.locator('#tokens-list')).toContainText('#01020304'); await expect(page.locator('#token-dark')).toHaveValue('#ABCDEF80');
});

test('creates categorized font-size tokens and multi-level theme aliases with the current profile', async ({ page }) => {
  await open(page);
  await page.locator('#token-menu-open').click(); await page.locator('#new-token-open').click(); await page.getByLabel('Имя токена', { exact: true }).fill('Body Size');
  await page.locator('#new-token-type').selectOption('Dimension');
  await page.locator('#new-token-category').selectOption('FontSize');
  await page.getByLabel('Light', { exact: true }).fill('16');
  await page.getByLabel('Dark', { exact: true }).fill('18');
  await page.getByRole('button', { name: 'Создать токен' }).click();
  await expect(page.locator('#token-detail-title')).toHaveText('Body Size');
  await expect(page.locator('#token-light')).toHaveValue('16'); await expect(page.locator('#token-dark')).toHaveValue('18');
  await page.locator('#token-menu-open').click(); await page.locator('#new-token-open').click(); await page.getByLabel('Имя токена', { exact: true }).fill('Semantic Size');
  await page.locator('#new-token-type').selectOption('Dimension');
  await page.locator('#new-token-category').selectOption('FontSize');
  for (const theme of ['Light','Dark']) {
    const row = page.locator('#new-token-values').locator('[data-theme="' + theme + '"]');
    await row.getByRole('button', { name: 'Привязать токен' }).click();
    await row.getByRole('button', { name: /Body Size/ }).click();
  }
  await page.getByRole('button', { name: 'Создать токен' }).click();
  await expect(page.locator('#token-values .token-value-name')).toHaveText(['Body Size','Body Size']);
  await expect(page.locator('#tokens-list')).toContainText('Dimension.FontSize');
  const dark = page.locator('#token-values [data-theme="Dark"]');
  await dark.getByRole('button', { name: 'Изменить привязку токена' }).click();
  await dark.getByRole('button', { name: 'Отвязать токен' }).click();
  await expect(page.locator('#token-dark')).toHaveValue('18');
  await expect(page.locator('#tokens-list tr').filter({hasText:'Semantic Size'})).toContainText('18 px');
  await page.locator('#token-dark').fill('20');
  await page.locator('#token-dark').press('Enter');
  await expect(page.locator('#tokens-list')).toContainText('20 px');
  await expect(page.locator('#token-values [data-theme="Light"] .token-value-name')).toHaveText('Body Size');
  await page.getByRole('button', { name: 'Body Size', exact: true }).click();
  const light = page.locator('#token-values [data-theme="Light"]');
  await light.getByRole('button', { name: 'Привязать токен' }).click();
  await expect(light.getByRole('button', { name: /Semantic Size/ })).toHaveCount(0);
  await expect(light.getByRole('button', { name: /^Body Size/ })).toHaveCount(0);
  await light.getByRole('searchbox').press('Escape');
  const darkBase = page.locator('#token-values [data-theme="Dark"]');
  await darkBase.getByRole('button', { name: 'Привязать токен' }).click();
  await expect(darkBase.getByRole('button', { name: /Semantic Size/ })).toBeVisible();
});

test('group tree, global search, type filter, conflicts and deletion', async ({ page }) => {
  await open(page);
  async function add(name, type, value) {
    await page.locator('#token-menu-open').click(); await page.locator('#new-token-open').click();
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
  await expect(page.getByRole('button', { name: 'Accent', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Раскрыть все группы', exact: true }).click();
  await page.getByRole('button', { name: 'Accent', exact: true }).click();
  const table = page.locator('#tokens-list');
  await expect(table.getByRole('button', {name:'Button',exact:true})).toBeVisible();
  await expect(table.getByRole('button', {name:'Border',exact:true})).toBeVisible();
  await expect(table).not.toContainText('Spacing.Small');
  await page.locator('#token-menu-open').click(); await page.locator('#new-token-open').click();
  await expect(page.locator('#new-token-name')).toHaveValue('Accent.');
  await page.locator('#new-token-name').fill('Hover');
  await page.getByLabel('Light', { exact: true }).fill('#001122');
  await page.getByLabel('Dark', { exact: true }).fill('#223344');
  await page.getByRole('button', {name:'Создать токен'}).click();
  await expect(page.locator('#token-detail-title')).toHaveText('Accent.Hover');
  await page.locator('#token-menu-open').click(); await page.locator('#new-token-open').click();
  await page.locator('#new-token-name').fill('Accent.Button.More');
  await page.getByLabel('Light', {exact:true}).fill('#000000');
  await page.getByLabel('Dark', {exact:true}).fill('#000000');
  await page.getByRole('button', {name:'Создать токен'}).click();
  await expect(page.locator('#tokens-error')).toContainText('Конфликт токена и группы');
  await page.locator('#new-token-cancel').click();
  await page.locator('#token-search').fill('small');
  await expect(table).toContainText('Spacing.Small');
  await page.locator('#token-menu-open').click();
  const menu = page.locator('#token-menu');
  await menu.getByRole('checkbox', {name:'Все типы',exact:true}).uncheck();
  await menu.getByRole('checkbox', {name:'Color',exact:true}).check();
  await expect(table).toContainText('Нет токенов');
  await menu.getByRole('checkbox', {name:'Spacing',exact:true}).check();
  await page.keyboard.press('Escape');
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
  await page.locator('#token-menu-open').click(); await page.locator('#token-import-open').click();
  await page.locator('#token-import-mode').selectOption('pair');
  await page.locator('#token-import-light-file').setInputFiles({name:'light.json',mimeType:'application/json',buffer:Buffer.from(theme(1))});
  await expect(page.locator('#token-import-light')).toHaveValue(theme(1));
  await page.locator('#token-import-dark').fill(theme(0));
  await page.getByRole('button',{name:'Импортировать токены'}).click();
  await expect(page.locator('#tokens-list')).toContainText('Accent.Button');
  await expect(page.locator('#token-import-form')).toBeHidden();
  for (const selected of ['Light','Dark']) {
    await page.locator('#token-menu-open').click();
    const downloaded = page.waitForEvent('download');
    await page.locator('#token-export-' + selected.toLowerCase()).click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe('tokens-' + selected.toLowerCase() + '.json');
    const body = JSON.parse(require('node:fs').readFileSync(await file.path(),'utf8'));
    expect(body.Accent.Button.$value.components[0]).toBe(selected === 'Light' ? 1 : 0);
  }
});

test('token grouping helpers handle mixed separators, hierarchy, relative names and conflicts', async () => {
  const { pathToFileURL } = require('node:url');
  const { resolve } = require('node:path');
  const { tokenSegments, buildTokenGroups, shortTokenName, filteredTokens, tokensInGroup, qualifyTokenName, tokenNameError, tokenNameDiagnostics } =
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
  const filter = (group, search, types) => tokensInGroup(filteredTokens(items, search, new Set(types), typeOf), group);
  expect(filter(['Accent'],'',['Color']).map(t=>t.id).sort()).toEqual(['1','2']);
  expect(filter(['Accent'],'heading.h1',['Typography'])).toEqual([]);
  expect(filter([],'heading.h1',['Typography']).map(t=>t.id)).toEqual(['3']);
  expect(filter([],'',['Spacing']).map(t=>t.id)).toEqual(['4']);
  expect(filter([],'',[])).toEqual([]);
  expect(filter([],'',['Spacing','Color']).map(t=>t.id).sort()).toEqual(['1','2','4']);
  const large = Array.from({length:500},(_,i)=>({id:String(i),name:'Group'+(i%10)+'/Nested.Item'+i,type:'Color'}));
  expect(buildTokenGroups(large).children.size).toBe(10);
  expect(tokensInGroup(filteredTokens(large,'',new Set(['Color']),typeOf),['Group1','Nested'])).toHaveLength(50);
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
  await page.getByRole('button',{name:'Group5',exact:true}).click();
  await expect(page.locator('#tokens-list tr')).toHaveCount(30);
  await page.locator('#token-search').fill('Group7.Item19');
  await expect(page.locator('#tokens-list tr')).toHaveCount(1);
  await page.getByRole('button',{name:'Group7.Item19',exact:true}).click();
  await expect(page.locator('#token-light')).toHaveValue('#000000FF');
  await page.reload();
  await page.getByLabel('Bearer-токен', {exact:true}).fill(bearer);
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await show(page,'tokens');
  await expect(page.locator('#tokens-list tr')).toHaveCount(300);
});

test('commits both theme drafts without losing the second edit during a save', async ({ page }) => {
  await open(page);
  await page.locator('#token-menu-open').click(); await page.locator('#new-token-open').click();
  await page.locator('#new-token-name').fill('Independent');
  await page.locator('#new-token-type').selectOption('Spacing');
  await page.getByLabel('Light', { exact: true }).fill('8');
  await page.getByLabel('Dark', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Создать токен' }).click();
  await expect(page.locator('#token-dark')).toHaveValue('12');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let first = true;
  await page.route('**/commands/set-token-value', async route => {
    if (first) { first = false; await gate; }
    await route.continue();
  });
  try {
    await page.locator('#token-light').fill('16');
    await page.locator('#token-dark').fill('24');
    await page.locator('#token-dark').press('Enter');
    await expect(page.locator('#token-dark')).toHaveValue('24');
  } finally { release(); }
  const row = page.locator('#tokens-list tr').filter({hasText:'Independent'});
  await expect(row).toContainText('16 px');
  await expect(row).toContainText('24 px');
  await expect(page.locator('#token-light')).toHaveValue('16');
  await expect(page.locator('#token-dark')).toHaveValue('24');
});

test('type menu filters tree and table together, retains navigation, and reveals a newly created token', async ({page, request}) => {
  await open(page);
  const doc = page.url().split('/').pop(), headers = {Authorization:'Bearer '+bearer};
  async function add(name, type, value) {
    const data = {commandId:randomUUID(),tokenId:randomUUID(),name,type,values:{Light:{expression:'literal',value},Dark:{expression:'literal',value}}};
    const response = await request.post('/api/v1/documents/'+doc+'/commands/add-token',{headers,data});
    expect(response.ok(),await response.text()).toBeTruthy();
  }
  await add('Mixed.Nested.Ink',0,{type:'color',red:0,green:0,blue:0,alpha:255});
  await add('Mixed.Radius',3,{type:'geometry',radius:8});
  await add('Other.Space',1,{type:'spacing',value:12});
  const tree = page.locator('#token-groups'), table = page.locator('#tokens-list'), trigger = page.locator('#token-menu-open'), menu = page.locator('#token-menu');
  await expect(table.locator('tr')).toHaveCount(3);
  await expect(page.locator('.token-workspace-toolbar')).toHaveCount(0);
  await expect(page.locator('.token-tree-toolbar > input')).toHaveCount(1);
  await expect(page.locator('.token-tree-toolbar > button')).toHaveCount(1);
  await tree.getByRole('button',{name:'Свернуть Mixed',exact:true}).click();
  await tree.getByRole('button',{name:'Other',exact:true}).click();
  await table.getByRole('button',{name:'Space',exact:true}).click();
  await trigger.click();
  const all = menu.getByRole('checkbox',{name:'Все типы',exact:true});
  const check = name => menu.getByRole('checkbox',{name,exact:true});
  await expect(all).toBeChecked();
  await expect(menu.getByRole('checkbox')).toHaveCount(9);
  await all.uncheck();
  await expect(table).toContainText('Не выбраны типы');
  await expect(tree.getByRole('button',{name:'Все токены',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#token-detail')).toBeHidden();
  await expect(trigger).toHaveAttribute('data-filtered','true');
  await check('Geometry').check();
  await expect(all).toHaveJSProperty('indeterminate',true);
  await expect(table).toContainText('Mixed.Radius');
  await expect(tree.getByRole('button',{name:'Other',exact:true})).toHaveCount(0);
  await check('Color').check();
  await expect(table.locator('tr')).toHaveCount(2);
  await expect(tree.getByRole('button',{name:'Раскрыть Mixed',exact:true})).toBeVisible();
  await expect(menu).toBeVisible();
  await all.click();
  await expect(all).toBeChecked();
  await expect(trigger).toHaveAttribute('data-filtered','false');
  await expect(tree.getByRole('button',{name:'Раскрыть Mixed',exact:true})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
  await trigger.click(); await all.uncheck(); await check('Geometry').check();
  await page.locator('#token-search').click(); await expect(menu).toBeHidden();
  await page.locator('#token-search').fill('Radius');
  await expect(table.locator('tr')).toHaveCount(1);
  await tree.getByRole('button',{name:'Mixed',exact:true}).click();
  await expect(page.locator('#token-search')).toHaveValue('Radius');
  await trigger.click(); await menu.locator('#new-token-open').click();
  await page.locator('#new-token-name').fill('New.Ink');
  await page.locator('#new-token-type').selectOption('Color');
  await page.getByLabel('Light',{exact:true}).fill('#123456');
  await page.getByLabel('Dark',{exact:true}).fill('#654321');
  await page.getByRole('button',{name:'Создать токен'}).click();
  await expect(page.locator('#token-detail-title')).toHaveText('New.Ink');
  await expect(page.locator('#token-search')).toHaveValue('');
  await expect(tree.getByRole('button',{name:'New',exact:true})).toHaveAttribute('aria-pressed','true');
  await trigger.click();
  await expect(check('Color')).toBeChecked();
  await expect(check('Geometry')).toBeChecked();
  await expect(check('Spacing')).not.toBeChecked();
  await expect(menu).toBeVisible();
});

test('combined exchange pins both themes, ignores filters and imports atomically', async ({page, request}) => {
  await open(page);
  const doc = page.url().split('/').pop(), headers = {Authorization:'Bearer '+bearer};
  const theme = (red, size) => ({
    Accent: { Ink: {$type:'color',$value:{colorSpace:'srgb',components:[red,0,0],alpha:1}},
      Alias: {$type:'color',$value:'{Accent.Ink}'} },
    Size: {$type:'dimension',$value:{value:size,unit:'px'},$extensions:{'org.figvam':{type:'Dimension',category:'FontSize'}}}
  });
  const bundle = {format:'figvam-tokens',version:1,themes:{Light:theme(1,16),Dark:theme(0,18)}};
  async function importBundle(value) {
    await page.locator('#token-menu-open').click();
    await page.locator('#token-import-open').click();
    await page.locator('#token-import-combined-file').setInputFiles({name:'figvam-tokens.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
    await expect(page.locator('#token-import-combined')).toHaveValue(JSON.stringify(value));
    await page.getByRole('button',{name:'Импортировать токены'}).click();
  }
  await importBundle(bundle);
  await expect(page.locator('#token-import-form')).toBeHidden();
  await expect(page.locator('#tokens-list tr')).toHaveCount(3);
  await page.locator('#token-search').fill('Accent.Alias');
  await expect(page.locator('#tokens-list')).toContainText('Accent.Ink');
  await expect(page.locator('#tokens-list')).toContainText('#FF0000FF');
  const revisions = [];
  await page.route('**/token-export?*',async route => { revisions.push(new URL(route.request().url()).searchParams.get('revision')); await route.continue(); });
  await page.locator('#token-menu-open').click();
  const downloaded = page.waitForEvent('download');
  await page.locator('#token-export').click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('figvam-tokens.json');
  const exported = JSON.parse(require('node:fs').readFileSync(await file.path(),'utf8'));
  expect(revisions).toHaveLength(2); expect(revisions[0]).toBe(revisions[1]);
  expect(exported.format).toBe('figvam-tokens'); expect(exported.version).toBe(1);
  for (const name of ['Light','Dark']) {
    expect(exported.themes[name].Accent.Alias.$value).toBe('{Accent.Ink}');
    expect(exported.themes[name].Size.$extensions['org.figvam'].category).toBe('FontSize');
    expect(exported.themes[name].Size.$value.value).toBe(name==='Light'?16:18);
  }
  const before = await (await request.get('/api/v1/documents/'+doc+'/tokens',{headers})).json();
  const invalid = structuredClone(exported);
  invalid.themes.Dark.Accent.Alias.$value = '{Missing}';
  await importBundle(invalid);
  await expect(page.locator('#tokens-error')).not.toBeEmpty();
  const after = await (await request.get('/api/v1/documents/'+doc+'/tokens',{headers})).json();
  expect(after.revision).toBe(before.revision); expect(after.items).toEqual(before.items);
  const other = randomUUID();
  expect((await request.post('/api/v1/documents',{headers,data:{documentId:other,name:'Round trip'}})).ok()).toBeTruthy();
  await page.goto('/documents/'+other);
  await page.getByLabel('Bearer-токен',{exact:true}).fill(bearer);
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await show(page,'tokens');
  await importBundle(exported);
  await expect(page.locator('#token-import-form')).toBeHidden();
  const roundTrip = await (await request.get('/api/v1/documents/'+other+'/tokens',{headers})).json();
  expect(roundTrip.items).toEqual(before.items);
});

test('token controls use readable theme colors in light and dark editor workspace', async ({page}) => {
  await open(page);
  for (const colorScheme of ['light','dark']) {
    await page.emulateMedia({colorScheme});
    const workspace = page.locator('#token-workspace');
    await expect(workspace).toHaveCSS('background-color',colorScheme==='light'?'rgb(255, 255, 255)':'rgb(32, 40, 54)');
    await page.locator('#token-menu-open').click();
    await expect(page.locator('#token-menu')).toBeVisible();
    await expect(page.locator('#token-menu')).toHaveCSS('background-color',colorScheme==='light'?'rgb(255, 255, 255)':'rgb(32, 40, 54)');
    await page.keyboard.press('Escape');
    await expect(page.locator('#token-menu')).toBeHidden();
  }
});

test('combined envelope preserves raw DTCG validation and rejects ambiguous envelope keys', async () => {
  const {pathToFileURL} = require('node:url'), {resolve} = require('node:path');
  const {splitTokenBundle} = await import(pathToFileURL(resolve(__dirname,'../../src/FigVam.Server/wwwroot/token-exchange.js')).href);
  const raw = '{"format":"figvam-tokens","version":1,"themes":{"Dark":{"a":1,"a":2},"Light":{"x":{"$value":"a, } \\" b"}}}}';
  const parts = splitTokenBundle(raw);
  expect(parts.darkJson).toBe('{"a":1,"a":2}');
  expect(JSON.parse(parts.lightJson).x.$value).toBe('a, } " b');
  expect(() => splitTokenBundle('{"format":"figvam-tokens","version":1,"themes":{"Light":{},"Light":{},"Dark":{}}}')).toThrow('Повторяющееся поле');
  expect(() => splitTokenBundle('{"format":"figvam-tokens","version":2,"themes":{"Light":{},"Dark":{}}}')).toThrow('версии 1');
  expect(() => splitTokenBundle('{"format":"figvam-tokens","version":1,"themes":{"Light":{}}}')).toThrow('обеими темами');
});

test('combined export never downloads a partial bundle when one theme fails', async ({page}) => {
  await open(page);
  await page.route('**/token-export?*',async route => {
    if (new URL(route.request().url()).searchParams.get('theme') === 'Dark')
      await route.fulfill({status:200,json:{tokens:null,diagnostics:[{message:'Dark export failed'}]}});
    else await route.continue();
  });
  let downloads = 0; page.on('download',() => downloads++);
  await page.locator('#token-menu-open').click();
  await page.locator('#token-export').click();
  await expect(page.locator('#tokens-error')).toContainText('Dark export failed');
  expect(downloads).toBe(0);
});

test('filtering away a selected token does not discard queued edits', async ({page, request}) => {
  await open(page);
  await page.locator('#token-menu-open').click(); await page.locator('#new-token-open').click();
  await page.locator('#new-token-name').fill('Queued');
  await page.locator('#new-token-type').selectOption('Spacing');
  await page.getByLabel('Light',{exact:true}).fill('8'); await page.getByLabel('Dark',{exact:true}).fill('12');
  await page.getByRole('button',{name:'Создать токен'}).click();
  await expect(page.locator('#token-dark')).toHaveValue('12');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let first = true;
  await page.route('**/commands/set-token-value', async route => {
    if (first) { first = false; await gate; }
    await route.continue();
  });
  try {
    await page.locator('#token-light').fill('16');
    await page.locator('#token-dark').fill('24');
    await page.locator('#token-dark').press('Enter');
    await page.locator('#token-search').fill('Not found');
    await expect(page.locator('#token-detail')).toBeHidden();
  } finally { release(); }
  await page.locator('#token-search').fill('');
  const row = page.locator('#tokens-list tr').filter({hasText:'Queued'});
  await expect(row).toContainText('16 px');
  await expect(row).toContainText('24 px');
});
