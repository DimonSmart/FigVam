const { test, expect, bearer } = require('./fixtures');
test('node metadata supports confirmation, lost response retry, deletion and viewer', async ({ page }) => {
 await page.goto('/'); await page.getByLabel('Bearer-токен', {exact:true}).fill(bearer); await page.getByRole('button',{name:'Продолжить',exact:true}).click();
 await page.getByLabel('Имя нового документа').fill('Metadata'); await page.getByRole('button',{name:'Создать документ',exact:true}).click();
 await page.getByRole('button',{name:'Создать страницу'}).click(); await page.getByLabel('Ширина экрана').fill('800'); await page.getByLabel('Высота экрана').fill('600'); await page.getByRole('button',{name:'Создать экран'}).click();
 await expect(page.locator('#screens button')).toHaveCount(1);
 const node='11111111-1111-1111-1111-111111111111', values={name:'Original',semanticKey:'old'}; let deleted=false, lost=true, bodies=[];
 await page.route('**/children/**', route=>route.fulfill({json:{items:deleted?[]:[{id:node,name:values.name,kind:'Frame',childCount:0}],total:deleted?0:1}}));
 await page.route(`**/nodes/${node}?*`, route=>route.fulfill({json:{revision:Number(new URL(route.request().url()).searchParams.get('revision')),items:[{id:node,...values}]}}));
 await page.getByRole('button',{name:'Обновить страницы'}).click(); await page.getByRole('treeitem').first().click(); await expect(page.locator('#node-name')).toHaveValue('Original');
 await page.route('**/commands/set-node-*', async route=>{
  const body=route.request().postDataJSON(); bodies.push(body);
  if(deleted) return route.fulfill({status:404,json:{code:'NODE_NOT_FOUND'}});
  if('name' in body) { values.name=body.name; if(lost){lost=false;return route.abort();} } else values.semanticKey=body.semanticKey;
  const documentId=new URL(page.url()).pathname.split('/').at(-1), revision=Number((await page.locator('#revision').textContent()).match(/\d+$/)[0]);
  await route.fulfill({json:{status:'ACCEPTED',documentId,commandId:body.commandId,revision:revision+1}});
 });
 await page.locator('#node-name').fill('Updated'); await page.getByRole('button',{name:'Сохранить имя'}).click(); await expect(page.locator('#node-metadata-error')).toContainText('Результат неизвестен');
 await expect(page.getByRole('treeitem').first()).toContainText('Original'); await page.locator('#node-metadata-retry').click(); await expect(page.locator('#node-name')).toHaveValue('Updated'); expect(bodies[1]).toEqual(bodies[0]);
 await page.locator('#node-key').fill(''); await page.getByRole('button',{name:'Сохранить semantic key'}).click(); await expect.poll(()=>bodies.length).toBe(3); expect(bodies[2].semanticKey).toBeNull();
 await expect(page.locator('#node-key')).toHaveValue(''); await expect(page.locator('#node-name')).toBeEditable(); deleted=true; await page.locator('#node-name').fill('Gone'); await page.getByRole('button',{name:'Сохранить имя'}).click(); await expect(page.locator('#inspector-selection')).toHaveText('Выберите слой.');
 deleted=false; await page.route('**/api/v1/documents?*',async route=>{const response=await route.fetch(), body=await response.json();body.items=body.items.map(item=>({...item,role:'Viewer'}));await route.fulfill({response,json:body});});
 await page.reload(); await page.getByLabel('Bearer-токен',{exact:true}).fill(bearer); await page.getByRole('button',{name:'Продолжить',exact:true}).click(); await page.getByRole('button',{name:/Экран /}).click(); await page.getByRole('treeitem').first().click(); await expect(page.locator('#node-name')).toHaveValue('Updated'); await expect(page.locator('#node-name')).toHaveAttribute('readonly'); await expect(page.getByRole('button',{name:'Сохранить имя'})).toBeHidden();
});

test('late metadata responses cannot affect a new selection and active access refusal closes the document', async ({ page }) => {
 await page.goto('/'); await page.getByLabel('Bearer-токен', {exact:true}).fill(bearer); await page.getByRole('button',{name:'Продолжить',exact:true}).click();
 await page.getByLabel('Имя нового документа').fill('Stale metadata'); await page.getByRole('button',{name:'Создать документ',exact:true}).click();
 await page.getByRole('button',{name:'Создать страницу'}).click(); await page.getByLabel('Ширина экрана').fill('800'); await page.getByLabel('Высота экрана').fill('600'); await page.getByRole('button',{name:'Создать экран'}).click();
 await expect(page.locator('#screens button')).toHaveCount(1);
 const first='11111111-1111-1111-1111-111111111111', second='22222222-2222-2222-2222-222222222222';
 await page.route('**/children/**', route=>route.fulfill({json:{items:[{id:first,name:'First',kind:'Frame',childCount:0},{id:second,name:'Second',kind:'Frame',childCount:0}],total:2}}));
 let release, entered; const waiting = new Promise(resolve => entered=resolve), gate = new Promise(resolve => release=resolve);
 await page.route(`**/nodes/${first}?*`, async route=>{ entered(); await gate; await route.fulfill({status:401,json:{}}); });
 await page.route(`**/nodes/${second}?*`, route=>route.fulfill({json:{revision:Number(new URL(route.request().url()).searchParams.get('revision')),items:[{id:second,name:'Second',semanticKey:null}]}}));
 await page.getByRole('button',{name:'Обновить страницы'}).click(); await page.getByRole('treeitem').first().click(); await waiting;
 await page.getByRole('treeitem').nth(1).click(); await expect(page.locator('#node-name')).toHaveValue('Second'); const late = page.waitForResponse(response => response.url().includes(`/nodes/${first}?`) && response.status() === 401); release(); await late;
 await expect(page.locator('#editor-view')).toBeVisible(); await expect(page.locator('#node-name')).toHaveValue('Second');
 await page.unroute(`**/nodes/${first}?*`); await page.route(`**/nodes/${first}?*`, route=>route.fulfill({status:403,json:{}}));
 await page.getByRole('treeitem').first().click(); await expect(page.locator('#editor-view')).toBeHidden();
});
