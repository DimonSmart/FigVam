# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: node-metadata.spec.js >> late metadata responses cannot affect a new selection and active access refusal closes the document
- Location: node-metadata.spec.js:26:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('#editor-view')
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" locator('#editor-view') with timeout 5000ms
  - waiting for locator('#editor-view')
    14 × locator resolved to <div hidden="" id="editor-view">…</div>
       - unexpected value "hidden"

```

```yaml
- link "К содержимому":
  - /url: "#content"
- banner:
  - link "FigVam":
    - /url: /
  - text: Переносимые интерфейсы · начальная версия
- region "Открыть рабочее пространство":
  - heading "Открыть рабочее пространство" [level=1]
  - paragraph: Введите уже выданный bearer-токен. Он хранится только в памяти этой вкладки, очищается при выходе или перезагрузке и отправляется только API этого сервера. В production используйте HTTPS.
  - text: Bearer-токен
  - textbox "Bearer-токен"
  - paragraph: Без префикса Bearer. Получение токена находится вне FigVam.
  - button "Продолжить"
- status
- alert: Токен отсутствует, истёк или отклонён. Введите действующий токен.
```

# Test source

```ts
  1  | const { test, expect, bearer } = require('./fixtures');
  2  | test('node metadata supports confirmation, lost response retry, deletion and viewer', async ({ page }) => {
  3  |  await page.goto('/'); await page.getByLabel('Bearer-токен', {exact:true}).fill(bearer); await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  4  |  await page.getByLabel('Имя нового документа').fill('Metadata'); await page.getByRole('button',{name:'Создать документ',exact:true}).click();
  5  |  await page.getByRole('button',{name:'Создать страницу'}).click(); await page.getByLabel('Ширина экрана').fill('800'); await page.getByLabel('Высота экрана').fill('600'); await page.getByRole('button',{name:'Создать экран'}).click();
  6  |  await expect(page.locator('#screens button')).toHaveCount(1);
  7  |  const node='11111111-1111-1111-1111-111111111111', values={name:'Original',semanticKey:'old'}; let deleted=false, lost=true, bodies=[];
  8  |  await page.route('**/children/**', route=>route.fulfill({json:{items:deleted?[]:[{id:node,name:values.name,kind:'Frame',childCount:0}],total:deleted?0:1}}));
  9  |  await page.route(`**/nodes/${node}?*`, route=>route.fulfill({json:{revision:Number(new URL(route.request().url()).searchParams.get('revision')),items:[{id:node,...values}]}}));
  10 |  await page.getByRole('button',{name:'Обновить страницы'}).click(); await page.getByRole('treeitem').first().click(); await expect(page.locator('#node-name')).toHaveValue('Original');
  11 |  await page.route('**/commands/set-node-*', async route=>{
  12 |   const body=route.request().postDataJSON(); bodies.push(body);
  13 |   if(deleted) return route.fulfill({status:404,json:{code:'NODE_NOT_FOUND'}});
  14 |   if('name' in body) { values.name=body.name; if(lost){lost=false;return route.abort();} } else values.semanticKey=body.semanticKey;
  15 |   const documentId=new URL(page.url()).pathname.split('/').at(-1), revision=Number((await page.locator('#revision').textContent()).match(/\d+$/)[0]);
  16 |   await route.fulfill({json:{code:'ACCEPTED',documentId,commandId:body.commandId,revision:revision+1}});
  17 |  });
  18 |  await page.locator('#node-name').fill('Updated'); await page.getByRole('button',{name:'Сохранить имя'}).click(); await expect(page.locator('#node-metadata-error')).toContainText('Результат неизвестен');
  19 |  await expect(page.getByRole('treeitem').first()).toContainText('Original'); await page.locator('#node-metadata-retry').click(); await expect(page.locator('#node-name')).toHaveValue('Updated'); expect(bodies[1]).toEqual(bodies[0]);
  20 |  await page.locator('#node-key').fill(''); await page.getByRole('button',{name:'Сохранить semantic key'}).click(); await expect.poll(()=>bodies.length).toBe(3); expect(bodies[2].semanticKey).toBeNull();
  21 |  await expect(page.locator('#node-key')).toHaveValue(''); deleted=true; await page.locator('#node-name').fill('Gone'); await page.getByRole('button',{name:'Сохранить имя'}).click(); await expect(page.locator('#inspector-selection')).toHaveText('Выберите слой.');
  22 |  deleted=false; await page.route('**/api/v1/documents?*',async route=>{const response=await route.fetch(), body=await response.json();body.items=body.items.map(item=>({...item,role:'Viewer'}));await route.fulfill({response,json:body});});
  23 |  await page.reload(); await page.getByLabel('Bearer-токен',{exact:true}).fill(bearer); await page.getByRole('button',{name:'Продолжить',exact:true}).click(); await page.getByRole('button',{name:/Экран /}).click(); await page.getByRole('treeitem').first().click(); await expect(page.locator('#node-name')).toHaveValue('Updated'); await expect(page.locator('#node-name')).toHaveAttribute('readonly'); await expect(page.getByRole('button',{name:'Сохранить имя'})).toBeHidden();
  24 | });
  25 | 
  26 | test('late metadata responses cannot affect a new selection and active access refusal closes the document', async ({ page }) => {
  27 |  await page.goto('/'); await page.getByLabel('Bearer-токен', {exact:true}).fill(bearer); await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  28 |  await page.getByLabel('Имя нового документа').fill('Stale metadata'); await page.getByRole('button',{name:'Создать документ',exact:true}).click();
  29 |  await page.getByRole('button',{name:'Создать страницу'}).click(); await page.getByLabel('Ширина экрана').fill('800'); await page.getByLabel('Высота экрана').fill('600'); await page.getByRole('button',{name:'Создать экран'}).click();
  30 |  await expect(page.locator('#screens button')).toHaveCount(1);
  31 |  const first='11111111-1111-1111-1111-111111111111', second='22222222-2222-2222-2222-222222222222';
  32 |  await page.route('**/children/**', route=>route.fulfill({json:{items:[{id:first,name:'First',kind:'Frame',childCount:0},{id:second,name:'Second',kind:'Frame',childCount:0}],total:2}}));
  33 |  let release, entered; const waiting = new Promise(resolve => entered=resolve), gate = new Promise(resolve => release=resolve);
  34 |  await page.route(`**/nodes/${first}?*`, async route=>{ entered(); await gate; await route.fulfill({status:401,json:{}}); });
  35 |  await page.route(`**/nodes/${second}?*`, route=>route.fulfill({json:{revision:Number(new URL(route.request().url()).searchParams.get('revision')),items:[{id:second,name:'Second',semanticKey:null}]}}));
  36 |  await page.getByRole('button',{name:'Обновить страницы'}).click(); await page.getByRole('treeitem').first().click(); await waiting;
  37 |  await page.getByRole('treeitem').nth(1).click(); await expect(page.locator('#node-name')).toHaveValue('Second'); const late = page.waitForResponse(response => response.url().includes(`/nodes/${first}?`) && response.status() === 401); release(); await late;
> 38 |  await expect(page.locator('#editor-view')).toBeVisible(); await expect(page.locator('#node-name')).toHaveValue('Second');
     |                                             ^ Error: expect(locator).toBeVisible() failed
  39 |  await page.unroute(`**/nodes/${first}?*`); await page.route(`**/nodes/${first}?*`, route=>route.fulfill({status:403,json:{}}));
  40 |  await page.getByRole('treeitem').first().click(); await expect(page.locator('#editor-view')).toBeHidden();
  41 | });
  42 | 
```