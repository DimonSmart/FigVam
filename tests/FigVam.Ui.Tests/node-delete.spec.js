const { test, expect, bearer } = require('./fixtures');
async function setup(page) {
 await page.goto('/'); await page.getByLabel('Bearer-токен',{exact:true}).fill(bearer); await page.getByRole('button',{name:'Продолжить',exact:true}).click();
 await page.getByLabel('Имя нового документа').fill('Delete layer'); await page.getByRole('button',{name:'Создать документ',exact:true}).click(); await page.getByRole('button',{name:'Создать страницу'}).click(); await page.getByLabel('Ширина экрана').fill('800'); await page.getByLabel('Высота экрана').fill('600'); await page.getByRole('button',{name:'Создать экран'}).click();
 await expect(page.locator('#screens button')).toHaveCount(1);
 const id='11111111-1111-1111-1111-111111111111'; let exists=true;
 await page.route('**/children/**', route=>route.fulfill({json:{items:exists?[{id,name:'Parent',kind:'Frame',childCount:0}]:[],total:exists?1:0}}));
 await page.route(`**/nodes/${id}?*`, route=>route.fulfill({json:{revision:Number(new URL(route.request().url()).searchParams.get('revision')),items:[{id,name:'Parent',semanticKey:null}]}}));
 await page.getByRole('button',{name:'Обновить страницы'}).click(); await page.getByRole('treeitem').first().click(); return {remove:()=>{exists=false;}};
}
test('keyboard cancel, confirmation and retry after lost response', async ({page})=>{
 const fixture=await setup(page); let calls=[];
 await page.route('**/commands/delete-node', async route=>{const body=route.request().postDataJSON(); calls.push(body); if(calls.length===1){fixture.remove(); return route.abort();} await route.fulfill({json:{status:'ACCEPTED',documentId:page.url().split('/').at(-1),commandId:body.commandId,revision:10}});});
 page.once('dialog', async d=>{expect(d.message()).toContain('Parent'); expect(d.message()).toContain('поддерево'); await d.dismiss();}); await page.locator('#node-delete').focus(); await page.keyboard.press('Enter'); expect(calls).toHaveLength(0);
 page.once('dialog', d=>d.accept()); await page.locator('#node-delete').focus(); await page.keyboard.press('Enter'); await expect(page.locator('#node-delete-status')).toContainText('неизвестен'); await page.locator('#node-delete-retry').click(); await expect(page.locator('#inspector-selection')).toHaveText('Выберите слой.'); expect(calls[1]).toEqual(calls[0]); expect(Object.keys(calls[0]).sort()).toEqual(['commandId','nodeId']);
});
test('references and concurrent deletion are explained', async ({page})=>{
 const fixture=await setup(page); let code='SCENARIO_IN_USE'; await page.route('**/commands/delete-node', route=>route.fulfill({status:409,json:{code}})); page.on('dialog', d=>d.accept());
 await page.locator('#node-delete').click(); await expect(page.locator('#node-delete-status')).toContainText('сценариях'); code='SCREEN_VARIANT_IN_USE'; await page.locator('#node-delete').click(); await expect(page.locator('#node-delete-status')).toContainText('вариантах'); code='NODE_NOT_FOUND'; fixture.remove(); await page.locator('#node-delete').click(); await expect(page.locator('#node-delete-status')).toContainText('уже удалён'); await expect(page.locator('#inspector-selection')).toHaveText('Выберите слой.');
});
test('late access refusal cannot affect the document list', async ({page})=>{
 await setup(page); let release, entered; const waiting=new Promise(r=>entered=r), gate=new Promise(r=>release=r); await page.route('**/commands/delete-node', async route=>{entered(); await gate; await route.fulfill({status:403,json:{code:'FORBIDDEN'}});});
 page.once('dialog', d=>d.accept()); await page.locator('#node-delete').click(); await waiting; await page.getByRole('link',{name:'← Документы'}).click(); release(); await expect(page.locator('#documents-view')).toBeVisible();
});


test('viewer cannot delete and active access denial closes the document', async ({page})=>{
 await setup(page); await page.route('**/commands/delete-node', route=>route.fulfill({status:403,json:{code:'FORBIDDEN'}})); page.once('dialog', d=>d.accept()); await page.locator('#node-delete').click(); await expect(page.locator('#editor-view')).toBeHidden();
 await page.route('**/api/v1/documents?*',async route=>{const response=await route.fetch(), body=await response.json(); body.items=body.items.map(item=>({...item,role:'Viewer'})); await route.fulfill({response,json:body});});
 await page.goto('/'); await page.getByLabel('Bearer-токен',{exact:true}).fill(bearer); await page.getByRole('button',{name:'Продолжить',exact:true}).click(); await page.getByRole('link',{name:'Delete layer'}).click(); await page.getByRole('button',{name:/Экран /}).click(); await page.getByRole('treeitem').first().click(); await expect(page.locator('#node-delete')).toBeHidden();
});


