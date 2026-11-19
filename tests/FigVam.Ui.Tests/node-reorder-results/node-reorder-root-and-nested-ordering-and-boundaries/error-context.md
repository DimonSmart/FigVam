# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: node-reorder.spec.js >> root and nested ordering and boundaries
- Location: node-reorder.spec.js:10:1

# Error details

```
Error: expect(locator).toBeDisabled() failed

Locator: locator('#node-earlier')
Expected: disabled
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeDisabled" locator('#node-earlier') with timeout 5000ms
  - waiting for locator('#node-earlier')

```

```yaml
- link "К содержимому":
  - /url: "#content"
- banner:
  - link "FigVam":
    - /url: /
  - text: Переносимые интерфейсы · начальная версия
  - button "Забыть токен"
- main:
  - link "← Документы":
    - /url: /
  - heading "Reorder" [level=1]
  - text: Общий черновик · ревизия 2 Design · каркас редактора Имя документа
  - textbox "Имя документа": Reorder
  - button "Переименовать документ"
  - status
  - alert
  - button "Удалить документ"
  - region "Управление участниками":
    - heading "Управление участниками" [level=2]
    - paragraph: Укажите ID участника. Список участников недоступен.
    - text: ID участника
    - textbox "ID участника"
    - text: Роль участника
    - combobox "Роль участника":
      - option "Owner" [selected]
      - option "Editor"
      - option "Viewer"
    - button "Назначить роль"
    - button "Удалить участника"
    - status
    - alert
  - region "Экспорт документа":
    - heading "Экспорт документа" [level=2]
    - paragraph: Файл содержит показанную ревизию 2. JSON не включает содержимое ассетов; для них используйте контейнер.
    - button "Скачать document.json"
    - button "Скачать container.figvam"
    - status
    - alert
  - paragraph: Подключено · изменения участников получаются автоматически.
  - region "Участники в документе":
    - heading "Участники в документе" [level=2]
    - text: Ваше имя для участников
    - textbox "Ваше имя для участников": Участник
    - text: Ваш цвет
    - textbox "Ваш цвет": "#2455a4"
    - status: Присутствующие участники обновлены.
    - list "Присутствующие участники":
      - listitem: "Участник · цвет #2455a4 · экран: не выбран · выбранные ID: нет · курсор недоступен"
  - region "История действий":
    - button "Отменить действие"
    - button "Повторить действие"
    - text: "Сочетания: Ctrl/⌘+Z, Ctrl/⌘+Shift+Z или Ctrl+Y."
    - status
    - alert
  - text: Имя версии (необязательно)
  - textbox "Имя версии (необязательно)"
  - button "Создать версию"
  - status
  - alert
  - region "Сохранённые версии":
    - heading "Сохранённые версии" [level=2]
    - paragraph: Текущий общий черновик показан в редакторе; сохранённые версии остаются неизменными.
    - button "Обновить историю"
    - status: Сохранённых версий нет.
    - alert
    - list "История сохранённых версий"
    - navigation "Навигация по истории версий":
      - button "Предыдущие версии" [disabled]
      - text: Страница 1
      - button "Следующие версии" [disabled]
    - status
    - alert
  - paragraph: Управление страницами и экранами доступно ниже. Редактирование содержимого экранов и Preview пока недоступны. Экспорт документа доступен выше. Поддержка целевых платформ здесь не заявлена.
  - complementary "Страницы и слои":
    - heading "Страницы и слои" [level=2]
    - paragraph: Управление страницами
    - button "Обновить страницы"
    - list "Страницы документа":
      - listitem:
        - button "Page" [pressed]
    - navigation "Навигация по страницам документа":
      - button "Предыдущие страницы" [disabled]
      - text: Страница списка 1
      - button "Следующие страницы" [disabled]
    - button "Создать страницу"
    - text: Имя выбранной страницы
    - textbox "Имя выбранной страницы": Page
    - button "Переименовать страницу"
    - button "Удалить страницу"
    - region "Экраны выбранной страницы":
      - heading "Экраны выбранной страницы" [level=2]
      - list "Экраны":
        - listitem:
          - button "Экран 6565d65c-0e89-4904-abef-04ba98c91a08 — 800 × 600" [pressed]
      - navigation "Навигация по экранам":
        - button "Предыдущие экраны" [disabled]
        - text: Страница списка 1
        - button "Следующие экраны" [disabled]
      - text: Ширина экрана
      - spinbutton "Ширина экрана": "800"
      - text: Высота экрана
      - spinbutton "Высота экрана": "600"
      - button "Создать экран"
    - region "Варианты выбранного экрана":
      - heading "Варианты выбранного экрана" [level=2]
      - paragraph: Базовое состояние и сохранённые варианты. Отображение вариантов на холсте и в Preview пока недоступно.
      - status: "Сохранённых вариантов: 0 · ревизия 2"
      - alert
      - list "Варианты экрана":
        - listitem: Базовое состояние
      - navigation "Навигация по вариантам экрана":
        - button "Предыдущие варианты" [disabled]
        - button "Следующие варианты" [disabled]
      - text: Имя нового варианта
      - textbox "Имя нового варианта"
      - button "Создать пустой вариант"
    - region "Каталог компонентов":
      - heading "Каталог компонентов" [level=2]
      - text: Поиск компонентов
      - textbox "Поиск компонентов"
      - button "Найти компоненты"
      - status: Компоненты не найдены.
      - alert
      - list "Компоненты документа"
      - navigation "Навигация по компонентам":
        - button "Предыдущие компоненты" [disabled]
        - button "Следующие компоненты" [disabled]
    - region "Локальные датасеты":
      - heading "Локальные датасеты" [level=2]
      - status: Датасетов пока нет.
      - alert
      - list "Датасеты документа"
      - navigation "Навигация по датасетам":
        - button "Предыдущие датасеты" [disabled]
        - button "Следующие датасеты" [disabled]
      - heading "Новый датасет" [level=3]
      - text: Имя датасета
      - textbox "Имя датасета"
      - text: Формат нового снимка
      - combobox "Формат нового снимка":
        - option "JSON" [selected]
        - option "CSV"
      - text: Содержимое нового снимка
      - textbox "Содержимое нового снимка"
      - button "Создать датасет"
    - region "Слои выбранного экрана":
      - heading "Слои выбранного экрана" [level=2]
      - status: Стрелки перемещают выбор, Enter выбирает слой.
      - tree "Слои экрана":
        - treeitem "▾ Parent — Frame" [expanded] [selected]:
          - text: ▾ Parent — Frame
          - group:
            - treeitem "• Child — Frame"
            - treeitem "• Second — Frame"
        - treeitem "• Second — Frame"
      - alert
  - region "Холст":
    - heading "Холст" [level=2]
    - paragraph: "Экран: 800 × 600 uiUnit"
    - group "Управление холстом":
      - button "Уменьшить"
      - status "Масштаб": 64%
      - button "Увеличить"
      - button "Вместить экран"
      - button "100%"
    - paragraph: Перетащите холст указателем или используйте стрелки для панорамирования. Колесо мыши меняет масштаб.
    - region "Область холста"
  - complementary "Инспектор":
    - heading "Инспектор" [level=2]
    - paragraph: "Слой: Parent · Frame · ID: 11111111-1111-1111-1111-111111111111"
    - button "Удалить слой"
    - status
    - alert
    - text: Имя слоя
    - textbox "Имя слоя": Parent
    - button "Сохранить имя"
    - text: Semantic key
    - textbox "Semantic key"
    - paragraph: Пустое значение удаляет semantic key.
    - button "Сохранить semantic key"
    - region "Сценарии прототипа":
      - heading "Сценарии прототипа" [level=2]
      - paragraph: Только просмотр сохранённых сценариев выбранного экрана.
      - status: Сценариев для выбранного экрана нет.
      - alert
      - paragraph: "Исходный слой: Parent — Frame"
      - status: Не удалось загрузить возможности сценария.
      - text: Событие
      - combobox "Событие"
      - text: Действие
      - combobox "Действие"
      - text: Вариант экрана
      - combobox "Вариант экрана":
        - option "Базовое состояние" [selected]
      - status
      - text: Датасет
      - combobox "Датасет":
        - option "Без датасета" [selected]
      - status: Датасетов пока нет; доступен выбор без датасета.
      - text: Целевой узел (ID)
      - textbox "Целевой узел (ID)"
      - button "Использовать выбранный слой как целевой узел"
      - checkbox "Значение null" [checked]
      - text: Значение nullДемонстрационное значение
      - textbox "Демонстрационное значение" [disabled]
      - button "Создать сценарий" [disabled]
      - status
      - alert
      - list "Сценарии выбранного экрана"
      - group "Страницы сценариев":
        - button "Предыдущие сценарии" [disabled]
        - button "Следующие сценарии" [disabled]
    - region "Диагностика экрана":
      - heading "Диагностика экрана" [level=2]
      - status: Диагностик для выбранного экрана нет.
      - alert
      - list "Диагностика выбранного экрана"
      - group "Страницы диагностики":
        - button "Предыдущие диагностики" [disabled]
        - button "Следующие диагностики" [disabled]
    - region "Размер экрана":
      - heading "Размер экрана" [level=2]
      - paragraph: "Подтверждённый размер: 800 × 600 uiUnit"
      - text: Ширина выбранного экрана
      - spinbutton "Ширина выбранного экрана": "800"
      - text: Высота выбранного экрана
      - spinbutton "Высота выбранного экрана": "600"
      - button "Изменить размер"
      - status
      - alert
    - region "Токены дизайна":
      - heading "Токены дизайна" [level=2]
      - paragraph: "Цвет: #RRGGBB или #RRGGBBAA. Отступ: число."
      - status: Токенов пока нет.
      - alert
      - list "Токены документа"
      - heading "Новый токен" [level=3]
      - text: Имя токена
      - textbox "Имя токена"
      - text: Тип токена
      - combobox "Тип токена":
        - option "Цвет" [selected]
        - option "Отступ"
      - text: Light
      - textbox "Light"
      - text: Dark
      - textbox "Dark"
      - button "Создать токен"
- status: Страницы обновлены.
- alert
```

# Test source

```ts
  1  | const {test,expect,bearer}=require('./fixtures');
  2  | const a='11111111-1111-1111-1111-111111111111',b='22222222-2222-2222-2222-222222222222',c='33333333-3333-3333-3333-333333333333';
  3  | async function setup(page){
  4  |  await page.goto('/'); await page.getByLabel('Bearer-токен',{exact:true}).fill(bearer); await page.getByRole('button',{name:'Продолжить',exact:true}).click(); await page.getByLabel('Имя нового документа').fill('Reorder'); await page.getByRole('button',{name:'Создать документ',exact:true}).click(); await page.getByRole('button',{name:'Создать страницу'}).click(); await page.getByLabel('Ширина экрана').fill('800'); await page.getByLabel('Высота экрана').fill('600'); await page.getByRole('button',{name:'Создать экран'}).click();
  5  |  const screen=(await page.locator('#screens button').textContent()).match(/[0-9a-f-]{36}/i)[0]; let roots=[a,b],nested=[c,b]; const item=id=>({id,name:id===a?'Parent':id===b?'Second':'Child',kind:'Frame',childCount:id===a?2:0});
  6  |  await page.route('**/children/**',route=>{const p=route.request().url().split('/children/')[1].split('?')[0], ids=p===screen?roots:p===a?nested:[]; return route.fulfill({json:{items:ids.map(item),total:ids.length}});});
  7  |  await page.route('**/nodes/*?*',route=>{const id=route.request().url().split('/nodes/')[1].split('?')[0];return route.fulfill({json:{revision:Number(new URL(route.request().url()).searchParams.get('revision')),items:[{id,name:item(id).name,semanticKey:null}]}});});
  8  |  await page.getByRole('button',{name:'Обновить страницы'}).click(); return {screen,roots:v=>roots=v,nested:v=>nested=v};
  9  | }
  10 | test('root and nested ordering and boundaries',async({page})=>{
  11 |  const f=await setup(page),calls=[]; await page.route('**/commands/move-node',route=>{const body=route.request().postDataJSON();calls.push(body); if(body.expectedParentId===f.screen)f.roots([b,a]);else f.nested([b,c]);return route.fulfill({json:{code:'ACCEPTED',documentId:page.url().split('/').at(-1),commandId:body.commandId,revision:10}});});
> 12 |  await page.locator('.layer-label').first().click();await expect(page.locator('#node-earlier')).toBeDisabled();await page.locator('#node-later').focus();await page.keyboard.press('Enter');await expect(page.locator('#node-earlier')).toBeEnabled();expect(calls[0]).toMatchObject({nodeId:a,expectedParentId:f.screen,targetParentId:f.screen,position:1});
     |                                                                                                 ^ Error: expect(locator).toBeDisabled() failed
  13 |  await page.locator('[data-id="'+a+'"] > .layer-label').click(); await page.locator('[data-id="'+c+'"] > .layer-label').click();await expect(page.locator('#node-earlier')).toBeDisabled();await page.locator('#node-later').click();await expect(page.locator('#node-later')).toBeDisabled();expect(calls[1]).toMatchObject({nodeId:c,expectedParentId:a,targetParentId:a,position:1});
  14 | });
  15 | test('uncertain retry and concurrent parent refusal',async({page})=>{
  16 |  const f=await setup(page),calls=[];let mode='lost';await page.route('**/commands/move-node',route=>{const body=route.request().postDataJSON();calls.push(body);if(mode==='lost'){mode='ack';return route.abort();}if(mode==='refuse')return route.fulfill({status:409,json:{code:'INVALID_LAYOUT_CONTEXT'}});f.roots([b,a]);return route.fulfill({json:{code:'ACCEPTED',documentId:page.url().split('/').at(-1),commandId:body.commandId,revision:10}});});
  17 |  await page.locator('.layer-label').first().click();await page.locator('#node-later').click();await expect(page.locator('#node-order-status')).toContainText('неизвестен');await page.locator('#node-order-retry').click();await expect(page.locator('#node-earlier')).toBeEnabled();expect(calls[1]).toEqual(calls[0]);mode='refuse';await page.locator('#node-earlier').click();await expect(page.locator('#node-order-status')).toContainText('Родитель слоя изменился');
  18 | });
  19 | test('viewer and late access denial',async({page})=>{
  20 |  await setup(page);let release,entered;const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);await page.route('**/commands/move-node',async route=>{entered();await gate;await route.fulfill({status:403,json:{code:'FORBIDDEN'}});});await page.locator('.layer-label').first().click();await page.locator('#node-later').click();await waiting;await page.getByRole('link',{name:'← Документы'}).click();release();await expect(page.locator('#documents-view')).toBeVisible();
  21 |  await page.route('**/api/v1/documents?*',async route=>{const response=await route.fetch(),body=await response.json();body.items=body.items.map(i=>({...i,role:'Viewer'}));await route.fulfill({response,json:body});});await page.goto('/');await page.getByLabel('Bearer-токен',{exact:true}).fill(bearer);await page.getByRole('button',{name:'Продолжить',exact:true}).click();await page.getByRole('link',{name:'Reorder'}).click();await page.getByRole('button',{name:/Экран /}).click();await page.locator('.layer-label').first().click();await expect(page.locator('#node-order')).toBeHidden();
  22 | });
  23 | 
```