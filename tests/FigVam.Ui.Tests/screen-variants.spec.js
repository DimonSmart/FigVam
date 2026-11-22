const { test, expect, bearer } = require('./fixtures');
const { show } = require('./ui-panels');
const { randomUUID } = require('node:crypto');
async function setup(request) {
 const id=randomUUID(), pageId=randomUUID(), screenId=randomUUID(), headers={Authorization:`Bearer ${bearer}`};
 expect((await request.post('/api/v1/documents',{headers,data:{documentId:id,name:'Variants'}})).ok()).toBeTruthy();
 for(const [name,data] of [['add-page',{pageId}],['add-screen',{pageId,screenId,dimensions:{width:640,height:480}}]]) expect((await request.post(`/api/v1/documents/${id}/commands/${name}`,{headers,data:{commandId:randomUUID(),...data}})).ok()).toBeTruthy();
 return {id,screenId,headers};
}
async function open(page,id) { await page.goto(`/documents/${id}`); await page.getByLabel('Bearer-токен',{exact:true}).fill(bearer); await page.getByRole('button',{name:'Продолжить',exact:true}).click(); await page.locator('#screens button').first().click(); await expect(page.locator('#screen-variants-list')).toContainText('Базовое состояние'); await show(page, 'assets'); }
test('creates and retries the same command after a lost response, then handles refusal',async({page,request})=>{
 const {id}=await setup(request); await open(page,id); const bodies=[];
 await page.route('**/commands/add-screen-variant',async route=>{bodies.push(route.request().postData()); if(bodies.length===1){await route.fetch(); await route.abort();}else await route.continue();});
 await page.getByLabel('Имя нового варианта').fill('Once'); await page.getByRole('button',{name:'Создать пустой вариант'}).click(); await expect(page.locator('#screen-variants-error')).toContainText('неизвестен'); await page.getByRole('button',{name:'Повторить создание варианта'}).click(); await expect(page.locator('#screen-variants-list')).toContainText('Once'); expect(bodies[0]).toBe(bodies[1]);
 await page.unroute('**/commands/add-screen-variant'); await page.route('**/commands/add-screen-variant',route=>route.fulfill({status:403,json:{code:'FORBIDDEN'}})); await page.getByLabel('Имя нового варианта').fill('Denied'); await page.getByRole('button',{name:'Создать пустой вариант'}).click(); await expect(page.locator('#screen-variants-error')).toContainText('Нет доступа');
});
test('Viewer reads saved variants without creation controls',async({page,request})=>{const {id,screenId,headers}=await setup(request); expect((await request.post(`/api/v1/documents/${id}/commands/add-screen-variant`,{headers,data:{commandId:randomUUID(),screenId,variantId:randomUUID(),name:'Saved'}})).ok()).toBeTruthy(); await page.route('**/api/v1/documents?*',async route=>{const response=await route.fetch(),body=await response.json(); for(const item of body.items)item.role='Viewer'; await route.fulfill({response,json:body});}); await open(page,id); await expect(page.locator('#screen-variants-list')).toContainText('Saved'); await expect(page.locator('#screen-variant-create')).toBeHidden();});
test('paginates pinned reads and retries errors',async({page,request})=>{const {id}=await setup(request); await open(page,id); let fail=true; await page.route('**/screens/*/variants?*',route=>{const url=new URL(route.request().url()), offset=Number(url.searchParams.get('offset')); if(fail){fail=false; return route.fulfill({status:403,json:{code:'FORBIDDEN'}});} return route.fulfill({json:{documentId:id,screenId:url.pathname.split('/')[6],revision:Number(url.searchParams.get('revision')),total:21,items:Array.from({length:offset?1:20},(_,i)=>({name:`Variant ${offset+i+1}`}))}});}); await show(page, 'layers'); await page.getByRole('button',{name:'Обновить страницы'}).click(); await show(page, 'assets'); await expect(page.locator('#screen-variants-error')).toContainText('Нет доступа'); await page.getByRole('button',{name:'Повторить загрузку вариантов'}).click(); await expect(page.locator('#screen-variants-number')).toHaveText('1–20 из 21'); await page.getByRole('button',{name:'Следующие варианты'}).click(); await expect(page.locator('#screen-variants-number')).toHaveText('21–21 из 21');});
test('ignores a late response after changing screens',async({page,request})=>{const {id,headers}=await setup(request); const pageId=randomUUID(), screenId=randomUUID(); for(const [name,data] of [['add-page',{pageId}],['add-screen',{pageId,screenId,dimensions:{width:320,height:240}}]]) expect((await request.post(`/api/v1/documents/${id}/commands/${name}`,{headers,data:{commandId:randomUUID(),...data}})).ok()).toBeTruthy(); await open(page,id); let release,entered; const gate=new Promise(r=>release=r),held=new Promise(r=>entered=r); await page.route('**/screens/*/variants?*',async route=>{const response=await route.fetch(); entered(); await gate; await route.fulfill({response,json:{...(await response.json()),items:[{name:'Stale'}],total:1}});},{times:1}); await show(page, 'layers'); await page.getByRole('button',{name:'Обновить страницы'}).click(); await show(page, 'assets'); await held; await show(page, 'layers'); await page.locator('#pages button').nth(1).click(); await expect(page.locator('#screens button').first()).toContainText('320 × 240'); await page.locator('#screens button').first().click(); await expect(page.locator('#screen-variants-list')).toContainText('Базовое состояние'); release(); await expect(page.locator('#screen-variants-list')).not.toContainText('Stale');});


test('retains an uncertain command when changing screens', async ({ page, request }) => {
  const { id, headers } = await setup(request), pageId = randomUUID(), screenId = randomUUID(), bodies = [];
  for (const [name, data] of [['add-page', { pageId }], ['add-screen', { pageId, screenId, dimensions: { width: 320, height: 240 } }]])
    expect((await request.post(`/api/v1/documents/${id}/commands/${name}`, { headers, data: { commandId: randomUUID(), ...data } })).ok()).toBeTruthy();
  await open(page, id);
  await page.route('**/commands/add-screen-variant', async route => {
    bodies.push(route.request().postData());
    if (bodies.length === 1) { await route.fetch(); await route.abort(); } else await route.continue();
  });
  await page.getByLabel('Имя нового варианта').fill('Retained');
  await page.getByRole('button', { name: 'Создать пустой вариант' }).click();
  await expect(page.locator('#screen-variants-error')).toContainText('неизвестен');
  await show(page, 'layers'); await page.locator('#pages button').nth(1).click();
  await expect(page.locator('#screens button').first()).toContainText('320 × 240');
  await page.locator('#screens button').first().click();
  await expect(page.getByRole('button', { name: 'Повторить создание варианта' })).toBeHidden();
  await show(page, 'layers'); await page.locator('#pages button').first().click();
  await expect(page.locator('#screens button').first()).toContainText('640 × 480');
  await page.locator('#screens button').first().click();
  await page.getByRole('button', { name: 'Повторить создание варианта' }).click();
  await expect(page.locator('#screen-variants-list')).toContainText('Retained');
  expect(bodies[0]).toBe(bodies[1]);
});
