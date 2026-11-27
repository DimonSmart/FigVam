const {test,expect,bearer}=require('./fixtures');
const { fulfillLayerPage } = require('./layer-fixture');
const { waitForLayerMoveReady, layerRow } = require('./layer-drag-helper');
const { show } = require('./ui-panels');
const a='11111111-1111-1111-1111-111111111111',b='22222222-2222-2222-2222-222222222222',c='33333333-3333-3333-3333-333333333333',d='44444444-4444-4444-4444-444444444444';
async function setup(page){
 await page.goto('/'); await page.getByLabel('Bearer-токен',{exact:true}).fill(bearer); await page.getByRole('button',{name:'Продолжить',exact:true}).click(); await page.getByLabel('Имя нового документа').fill('Reorder'); await page.getByRole('button',{name:'Создать документ',exact:true}).click(); await page.getByRole('button',{name:'Создать страницу'}).click(); await show(page, 'screen'); await page.getByLabel('Ширина экрана').fill('800'); await page.getByLabel('Высота экрана').fill('600'); await page.getByRole('button',{name:'Создать экран'}).click();
 const screen=await page.locator('#screens button.screen-select').getAttribute('data-screen-id'); let roots=[a,b],nested=[c,d]; const item=id=>({id,name:id===a?'Parent':id===b?'Second':'Child',kind:'Frame',childCount:id===a?2:0});
 await page.route('**/children/**',route=>{const p=route.request().url().split('/children/')[1].split('?')[0], ids=p===screen?roots:p===a?nested:[]; return fulfillLayerPage(route,ids.map(item));});
 await page.route('**/nodes/*?*',route=>{const id=route.request().url().split('/nodes/')[1].split('?')[0];return route.fulfill({json:{revision:Number(new URL(route.request().url()).searchParams.get('revision')),items:[{id,name:item(id).name,semanticKey:null}]}});});
 await page.getByRole('button',{name:'Обновить страницы'}).click(); return {screen,roots:v=>roots=v,nested:v=>nested=v};
}
test('root and nested ordering and boundaries',async({page})=>{
 const f=await setup(page),calls=[]; await page.route('**/commands/move-node',route=>{const body=route.request().postDataJSON();calls.push(body); if(body.expectedParentId===f.screen)f.roots([b,a]);else f.nested([d,c]);return route.fulfill({json:{status:'ACCEPTED',documentId:page.url().split('/').at(-1),commandId:body.commandId,revision:10, pageId:null, screenId:null, nodeId:body.nodeId, versionId:null, affectedIds:[body.nodeId]}});});
 // Wait for the expanded tree before sending a keyboard command; the tree must have unique IDs.
 await page.locator('[data-id="'+a+'"] > .layer-label').click();
 await expect(page.locator('[data-id="'+c+'"] > .layer-label')).toBeVisible();
 await page.locator('[aria-selected=true][role=treeitem]').press('Control+ArrowUp');
 expect(calls).toHaveLength(0);
 await page.locator('[aria-selected=true][role=treeitem]').press('Control+ArrowDown');
 await expect.poll(()=>calls.length).toBe(1);
 await expect(page.locator('#layers > [role=treeitem]').last()).toHaveAttribute('data-id',a);await waitForLayerMoveReady(page);expect(calls[0]).toMatchObject({nodeId:a,expectedParentId:f.screen,targetParentId:f.screen,position:1});
 await page.locator('[data-id="'+c+'"] > .layer-label').click();await page.locator('[aria-selected=true][role=treeitem]').press('Control+ArrowUp');expect(calls).toHaveLength(1);await page.locator('[aria-selected=true][role=treeitem]').press('Control+ArrowDown');await expect(page.locator('[data-id="'+a+'"] > [role=group] > [role=treeitem]').last()).toHaveAttribute('data-id',c);await waitForLayerMoveReady(page);await page.locator('[aria-selected=true][role=treeitem]').press('Control+ArrowDown');expect(calls).toHaveLength(2);expect(calls[1]).toMatchObject({nodeId:c,expectedParentId:a,targetParentId:a,position:1});
});
test('uncertain retry and concurrent parent refusal',async({page})=>{
 const f=await setup(page),calls=[];let mode='lost';await page.route('**/commands/move-node',route=>{const body=route.request().postDataJSON();calls.push(body);if(mode==='lost'){mode='ack';return route.abort();}if(mode==='refuse')return route.fulfill({status:409,json:{code:'INVALID_LAYOUT_CONTEXT'}});f.roots([b,a]);return route.fulfill({json:{status:'ACCEPTED',documentId:page.url().split('/').at(-1),commandId:body.commandId,revision:10, pageId:null, screenId:null, nodeId:body.nodeId, versionId:null, affectedIds:[body.nodeId]}});});
 await page.locator('.layer-label').first().click();await page.locator('[aria-selected=true][role=treeitem]').press('Control+ArrowDown');await expect(page.locator('#node-order-status')).toContainText('неизвестен');await page.locator('#node-order-retry').click();await expect(page.locator('#layers > [role=treeitem]').last()).toHaveAttribute('data-id',a);expect(calls[1]).toEqual(calls[0]);await waitForLayerMoveReady(page);mode='refuse';await page.locator('[aria-selected=true][role=treeitem]').press('Control+ArrowUp');await expect(page.locator('#node-order-status')).toContainText('Родитель слоя изменился');
});
test('viewer and late access denial',async({page})=>{
 await setup(page);let release,entered;const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);await page.route('**/commands/move-node',async route=>{entered();await gate;await route.fulfill({status:403,json:{code:'FORBIDDEN'}});});await page.locator('.layer-label').first().click();await page.locator('[aria-selected=true][role=treeitem]').press('Control+ArrowDown');await waiting;await page.getByRole('link',{name:'← Документы'}).click();release();await expect(page.locator('#documents-view')).toBeVisible();
 await page.route('**/api/v1/documents?*',async route=>{const response=await route.fetch(),body=await response.json();body.items=body.items.map(i=>({...i,role:'Viewer'}));await route.fulfill({response,json:body});});await page.goto('/');await page.getByLabel('Bearer-токен',{exact:true}).fill(bearer);await page.getByRole('button',{name:'Продолжить',exact:true}).click();await page.getByRole('link',{name:'Reorder'}).click();await page.getByRole('button',{name:/Экран /}).click();await page.locator('.layer-label').first().click();await expect(page.locator('#layers')).not.toHaveClass(/layer-move-enabled/);
});
test('concurrent deletion and active access loss', async ({ page }) => {
  const f = await setup(page), calls = [];
  let code = 'NODE_NOT_FOUND';
  await page.route('**/commands/move-node', route => {
    calls.push(route.request().postDataJSON());
    if (code === 'NODE_NOT_FOUND') f.roots([b]);
    return route.fulfill({ status: code === 'FORBIDDEN' ? 403 : 409, json: { code } });
  });
  await layerRow(page, a).press('Enter');
  await waitForLayerMoveReady(page);
  await layerRow(page, a).press('Control+ArrowDown');
  await expect(page.locator('#node-order-status')).toContainText('уже удалён');
  await expect(layerRow(page, a)).toHaveCount(0);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ nodeId: a, expectedParentId: f.screen, targetParentId: f.screen, position: 1 });

  f.roots([b, a]);
  await page.getByRole('button', { name: 'Обновить страницы' }).click();
  const roots = page.locator('#layers > [role=treeitem]');
  await expect(roots).toHaveCount(2);
  await expect(roots.first()).toHaveAttribute('data-id', b);
  await expect(roots.last()).toHaveAttribute('data-id', a);
  await waitForLayerMoveReady(page);
  await layerRow(page, b).press('Enter');
  await expect(layerRow(page, b)).toHaveAttribute('aria-selected', 'true');
  code = 'FORBIDDEN';
  const denied = page.waitForResponse(response => response.url().endsWith('/commands/move-node'));
  await layerRow(page, b).press('Control+ArrowDown');
  expect((await denied).status()).toBe(403);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({ nodeId: b, expectedParentId: f.screen, targetParentId: f.screen, position: 1 });
  await expect(page.locator('#editor-view')).toBeHidden();
});
test('confirmed move after selection change preserves the new selection',async({page})=>{
 const f=await setup(page);let release,entered;const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);await page.route('**/commands/move-node',async route=>{entered();await gate;const body=route.request().postDataJSON();f.roots([b,a]);await route.fulfill({json:{status:'ACCEPTED',documentId:page.url().split('/').at(-1),commandId:body.commandId,revision:10, pageId:null, screenId:null, nodeId:body.nodeId, versionId:null, affectedIds:[body.nodeId]}});});await page.locator('.layer-label').first().click();await page.locator('[aria-selected=true][role=treeitem]').press('Control+ArrowDown');await waiting;await page.locator('[data-id="'+b+'"] > .layer-label').first().click();release();await expect(page.locator('#layers > [role=treeitem]').last()).toHaveAttribute('data-id',a);await expect(page.locator('#node-order-status')).toContainText('Порядок слоёв изменён');await expect(page.locator('#inspector-selection')).toContainText('Second');await expect(page.locator('#node-order-retry')).toBeHidden();
});
