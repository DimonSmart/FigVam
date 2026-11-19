# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: node-delete.spec.js >> viewer cannot delete and active access denial closes the document
- Location: node-delete.spec.js:27:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: /Delete layer/ })

```

# Page snapshot

```yaml
- generic [ref=f1e1]:
  - link "К содержимому" [ref=f1e2] [cursor=pointer]:
    - /url: "#content"
  - banner [ref=f1e3]:
    - link "FigVam" [ref=f1e4] [cursor=pointer]:
      - /url: /
    - generic [ref=f1e5]: Переносимые интерфейсы · начальная версия
    - button "Забыть токен" [ref=f1e6] [cursor=pointer]
  - main [active] [ref=f1e7]:
    - generic [ref=f1e8]:
      - generic [ref=f1e9]:
        - generic [ref=f1e10]:
          - paragraph [ref=f1e11]: Рабочее пространство
          - heading "Документы" [level=1] [ref=f1e12]
        - button "Обновить список" [ref=f1e13] [cursor=pointer]
      - generic [ref=f1e14]:
        - generic [ref=f1e15]: Имя нового документа
        - textbox "Имя нового документа" [ref=f1e16]
        - button "Создать документ" [ref=f1e17] [cursor=pointer]
      - generic [ref=f1e18]:
        - text: Файл документа (document.json или .figvam)
        - button "Файл документа (document.json или .figvam)" [ref=f1e19]
        - button "Открыть файл как новый документ" [ref=f1e20] [cursor=pointer]
        - status
        - alert
        - list "Диагностика импорта"
      - list "Доступные документы" [ref=f1e21]:
        - listitem [ref=f1e22]:
          - link "Delete layer" [ref=f1e23] [cursor=pointer]:
            - /url: /documents/a816214b-cdb9-4422-a4a7-610163bd0524
          - generic [ref=f1e24]: Просмотр
      - navigation "Страницы списка" [ref=f1e25]:
        - button "Предыдущая" [disabled] [ref=f1e26]
        - generic [ref=f1e27]: Страница 1
        - button "Следующая" [disabled] [ref=f1e28]
  - generic [ref=f1e29]:
    - status [ref=f1e30]: "Документов на странице: 1"
    - alert
```

# Test source

```ts
  1  | const { test, expect, bearer } = require('./fixtures');
  2  | async function setup(page) {
  3  |  await page.goto('/'); await page.getByLabel('Bearer-токен',{exact:true}).fill(bearer); await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  4  |  await page.getByLabel('Имя нового документа').fill('Delete layer'); await page.getByRole('button',{name:'Создать документ',exact:true}).click(); await page.getByRole('button',{name:'Создать страницу'}).click(); await page.getByLabel('Ширина экрана').fill('800'); await page.getByLabel('Высота экрана').fill('600'); await page.getByRole('button',{name:'Создать экран'}).click();
  5  |  await expect(page.locator('#screens button')).toHaveCount(1);
  6  |  const id='11111111-1111-1111-1111-111111111111'; let exists=true;
  7  |  await page.route('**/children/**', route=>route.fulfill({json:{items:exists?[{id,name:'Parent',kind:'Frame',childCount:0}]:[],total:exists?1:0}}));
  8  |  await page.route(`**/nodes/${id}?*`, route=>route.fulfill({json:{revision:Number(new URL(route.request().url()).searchParams.get('revision')),items:[{id,name:'Parent',semanticKey:null}]}}));
  9  |  await page.getByRole('button',{name:'Обновить страницы'}).click(); await page.getByRole('treeitem').first().click(); return {remove:()=>{exists=false;}};
  10 | }
  11 | test('keyboard cancel, confirmation and retry after lost response', async ({page})=>{
  12 |  const fixture=await setup(page); let calls=[];
  13 |  await page.route('**/commands/delete-node', async route=>{const body=route.request().postDataJSON(); calls.push(body); if(calls.length===1){fixture.remove(); return route.abort();} await route.fulfill({json:{code:'ACCEPTED',documentId:page.url().split('/').at(-1),commandId:body.commandId,revision:10}});});
  14 |  page.once('dialog', async d=>{expect(d.message()).toContain('Parent'); expect(d.message()).toContain('поддерево'); await d.dismiss();}); await page.locator('#node-delete').focus(); await page.keyboard.press('Enter'); expect(calls).toHaveLength(0);
  15 |  page.once('dialog', d=>d.accept()); await page.locator('#node-delete').focus(); await page.keyboard.press('Enter'); await expect(page.locator('#node-delete-status')).toContainText('неизвестен'); await page.locator('#node-delete-retry').click(); await expect(page.locator('#inspector-selection')).toHaveText('Выберите слой.'); expect(calls[1]).toEqual(calls[0]); expect(Object.keys(calls[0]).sort()).toEqual(['commandId','nodeId']);
  16 | });
  17 | test('references and concurrent deletion are explained', async ({page})=>{
  18 |  const fixture=await setup(page); let code='SCENARIO_IN_USE'; await page.route('**/commands/delete-node', route=>route.fulfill({status:409,json:{code}})); page.on('dialog', d=>d.accept());
  19 |  await page.locator('#node-delete').click(); await expect(page.locator('#node-delete-status')).toContainText('сценариях'); code='SCREEN_VARIANT_IN_USE'; await page.locator('#node-delete').click(); await expect(page.locator('#node-delete-status')).toContainText('вариантах'); code='NODE_NOT_FOUND'; fixture.remove(); await page.locator('#node-delete').click(); await expect(page.locator('#node-delete-status')).toContainText('уже удалён'); await expect(page.locator('#inspector-selection')).toHaveText('Выберите слой.');
  20 | });
  21 | test('late access refusal cannot affect the document list', async ({page})=>{
  22 |  await setup(page); let release, entered; const waiting=new Promise(r=>entered=r), gate=new Promise(r=>release=r); await page.route('**/commands/delete-node', async route=>{entered(); await gate; await route.fulfill({status:403,json:{code:'FORBIDDEN'}});});
  23 |  page.once('dialog', d=>d.accept()); await page.locator('#node-delete').click(); await waiting; await page.getByRole('link',{name:'← Документы'}).click(); release(); await expect(page.locator('#documents-view')).toBeVisible();
  24 | });
  25 | 
  26 | 
  27 | test('viewer cannot delete and active access denial closes the document', async ({page})=>{
  28 |  await setup(page); await page.route('**/commands/delete-node', route=>route.fulfill({status:403,json:{code:'FORBIDDEN'}})); page.once('dialog', d=>d.accept()); await page.locator('#node-delete').click(); await expect(page.locator('#editor-view')).toBeHidden();
  29 |  await page.route('**/api/v1/documents?*',async route=>{const response=await route.fetch(), body=await response.json(); body.items=body.items.map(item=>({...item,role:'Viewer'})); await route.fulfill({response,json:body});});
> 30 |  await page.goto('/'); await page.getByLabel('Bearer-токен',{exact:true}).fill(bearer); await page.getByRole('button',{name:'Продолжить',exact:true}).click(); await page.getByRole('button',{name:/Delete layer/}).click(); await page.getByRole('button',{name:/Экран /}).click(); await page.getByRole('treeitem').first().click(); await expect(page.locator('#node-delete')).toBeHidden();
     |                                                                                                                                                                                                                     ^ Error: locator.click: Test timeout of 30000ms exceeded.
  31 | });
  32 | 
  33 | 
```