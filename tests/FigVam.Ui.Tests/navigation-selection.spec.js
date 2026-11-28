const { test, expect, bearer } = require('./fixtures');
const { randomUUID } = require('node:crypto');

test('selects screens automatically, keeps valid selections and confirms targeted deletion', async ({ page, request }) => {
  const documentId = randomUUID(), first = randomUUID(), second = randomUUID();
  const a = randomUUID(), b = randomUUID(), c = randomUUID(), d = randomUUID();
  const headers = { Authorization: `Bearer ${bearer}` };
  const base = `/api/v1/documents/${documentId}`;
  expect((await request.post('/api/v1/documents', {headers, data:{documentId,name:'Navigation selection'}})).ok()).toBeTruthy();
  const command = async (name, data) => {
    const result = await request.post(base + '/commands/' + name, {headers,data:{commandId:randomUUID(),...data}});
    expect(result.ok(), await result.text()).toBeTruthy();
    return result.json();
  };
  const dimensions = {width:640,height:480};
  await command('add-page',{pageId:first,name:'First'});
  await command('add-page',{pageId:second,name:'Second'});
  for (const [pageId,screenId,name] of [[first,a,'A'],[first,b,'B'],[first,c,'C'],[second,d,'D']])
    await command('add-screen',{pageId,screenId,name,dimensions});
  await page.goto('/documents/' + documentId);
  await page.getByLabel('Bearer-токен', {exact:true}).fill(bearer);
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.locator('#editor-view')).toBeVisible();
  const pageButton = id => page.locator(`#pages .page-select[data-page-id="${id}"]`);
  const screenButton = id => page.locator(`#screens .screen-select[data-screen-id="${id}"]`);
  const active = async (pageId,screenId) => {
    await expect(pageButton(pageId)).toHaveAttribute('aria-pressed','true');
    await expect(screenButton(screenId)).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#canvas-empty')).toBeHidden();
  };
  const removeScreen = async (id,name,accept) => {
    const row = page.locator(`#screens .screen-row:has(> [data-screen-id="${id}"])`);
    await row.locator('summary').click();
    await expect(row.locator('.navigator-context-body input')).toHaveCount(3);
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain(name);
      expect(dialog.message()).toContain('варианты');
      if (accept) await dialog.accept(); else await dialog.dismiss();
    });
    await row.getByRole('button',{name:'Удалить экран',exact:true}).click();
  };
  await active(first,a);
  await screenButton(c).click();
  await active(first,c);
  await page.getByRole('button',{name:'Обновить страницы'}).click();
  await active(first,c);
  await removeScreen(b,'B',false);
  await expect(screenButton(b)).toHaveCount(1);
  await active(first,c);
  await removeScreen(b,'B',true);
  await expect(screenButton(b)).toHaveCount(0);
  await active(first,c);
  await removeScreen(c,'C',true);
  await expect(screenButton(c)).toHaveCount(0);
  await active(first,a);

  let release, entered;
  const held = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const pattern = '**/pages/' + second + '/screens?*';
  await page.route(pattern, async route => { entered(); await gate; await route.continue(); });
  await pageButton(second).click();
  await held;
  await expect(page.locator('#canvas-empty')).toBeHidden();
  release();
  await active(second,d);
  await page.unroute(pattern);
  await removeScreen(d,'D',true);
  await expect(screenButton(d)).toHaveCount(0);
  await expect(page.locator('#canvas-empty')).toBeVisible();
  const row = page.locator(`#pages > li:has(> [data-page-id="${second}"])`);
  await row.locator(':scope > details > summary').click();
  page.once('dialog', dialog => dialog.accept());
  await row.getByRole('button',{name:'Удалить страницу',exact:true}).click();
  await expect(pageButton(second)).toHaveCount(0);
  await active(first,a);
});
