# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: node-reorder.spec.js >> root and nested ordering and boundaries
- Location: node-reorder.spec.js:10:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('[data-id="33333333-3333-3333-3333-333333333333"] > .layer-label')

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - link "К содержимому" [ref=e2] [cursor=pointer]:
    - /url: "#content"
  - banner [ref=e3]:
    - link "FigVam" [ref=e4] [cursor=pointer]:
      - /url: /
    - generic [ref=e5]: Переносимые интерфейсы · начальная версия
    - button "Забыть токен" [ref=e6] [cursor=pointer]
  - main [ref=e7]:
    - generic [ref=e8]:
      - generic "Панель документа" [ref=e9]:
        - link "← Документы" [ref=e10] [cursor=pointer]:
          - /url: /
        - heading "Reorder" [level=1] [ref=e11]
        - generic [ref=e12]: Общий черновик · ревизия 2
        - generic [ref=e13]: Design · каркас редактора
        - generic [ref=e14]:
          - text: Имя документа
          - textbox "Имя документа" [ref=e15]: Reorder
          - button "Переименовать документ" [ref=e16] [cursor=pointer]
          - status
          - alert
        - button "Удалить документ" [ref=e17] [cursor=pointer]
      - region "Управление участниками" [ref=e18]:
        - heading "Управление участниками" [level=2] [ref=e19]
        - paragraph [ref=e20]: Укажите ID участника. Список участников недоступен.
        - generic [ref=e21]:
          - text: ID участника
          - textbox "ID участника" [ref=e22]
          - text: Роль участника
          - combobox "Роль участника" [ref=e23]:
            - option "Owner" [selected]
            - option "Editor"
            - option "Viewer"
          - button "Назначить роль" [ref=e24] [cursor=pointer]
          - button "Удалить участника" [ref=e25] [cursor=pointer]
        - status
        - alert
      - region "Экспорт документа" [ref=e26]:
        - heading "Экспорт документа" [level=2] [ref=e27]
        - paragraph [ref=e28]: Файл содержит показанную ревизию 2. JSON не включает содержимое ассетов; для них используйте контейнер.
        - button "Скачать document.json" [ref=e29] [cursor=pointer]
        - button "Скачать container.figvam" [ref=e30] [cursor=pointer]
        - status
        - alert
      - paragraph [ref=e31]: Подключено · изменения участников получаются автоматически.
      - region "Участники в документе" [ref=e32]:
        - heading "Участники в документе" [level=2] [ref=e33]
        - text: Ваше имя для участников
        - textbox "Ваше имя для участников" [ref=e34]: Участник
        - text: Ваш цвет
        - textbox "Ваш цвет" [ref=e35]: "#2455a4"
        - status [ref=e36]: Присутствующие участники обновлены.
        - list "Присутствующие участники" [ref=e37]:
          - listitem [ref=e38]: "Участник · цвет #2455a4 · экран: c408d679-a330-47be-9d5c-913512c00969 · выбранные ID: 11111111-1111-1111-1111-111111111111 · курсор недоступен"
      - region "История действий" [ref=e39]:
        - button "Отменить действие" [ref=e40] [cursor=pointer]
        - button "Повторить действие" [ref=e41] [cursor=pointer]
        - text: "Сочетания: Ctrl/⌘+Z, Ctrl/⌘+Shift+Z или Ctrl+Y."
        - status
        - alert
      - generic [ref=e42]:
        - text: Имя версии (необязательно)
        - textbox "Имя версии (необязательно)" [ref=e43]
        - button "Создать версию" [ref=e44] [cursor=pointer]
        - status
        - alert
      - region "Сохранённые версии" [ref=e45]:
        - heading "Сохранённые версии" [level=2] [ref=e46]
        - paragraph [ref=e47]: Текущий общий черновик показан в редакторе; сохранённые версии остаются неизменными.
        - button "Обновить историю" [ref=e48] [cursor=pointer]
        - status [ref=e49]: Сохранённых версий нет.
        - alert
        - list "История сохранённых версий"
        - navigation "Навигация по истории версий" [ref=e50]:
          - button "Предыдущие версии" [disabled] [ref=e51]
          - generic [ref=e52]: Страница 1
          - button "Следующие версии" [disabled] [ref=e53]
        - status
        - alert
      - paragraph [ref=e54]: Управление страницами и экранами доступно ниже. Редактирование содержимого экранов и Preview пока недоступны. Экспорт документа доступен выше. Поддержка целевых платформ здесь не заявлена.
      - generic [ref=e55]:
        - complementary "Страницы и слои" [ref=e56]:
          - heading "Страницы и слои" [level=2] [ref=e57]
          - paragraph [ref=e58]: Управление страницами
          - button "Обновить страницы" [ref=e59] [cursor=pointer]
          - list "Страницы документа" [ref=e60]:
            - listitem [ref=e61]:
              - button "Page" [pressed] [ref=e62] [cursor=pointer]
          - navigation "Навигация по страницам документа" [ref=e63]:
            - button "Предыдущие страницы" [disabled] [ref=e64]
            - generic [ref=e65]: Страница списка 1
            - button "Следующие страницы" [disabled] [ref=e66]
          - generic [ref=e67]:
            - button "Создать страницу" [ref=e68] [cursor=pointer]
            - generic [ref=e69]:
              - generic [ref=e70]: Имя выбранной страницы
              - textbox "Имя выбранной страницы" [ref=e71]: Page
              - button "Переименовать страницу" [ref=e72] [cursor=pointer]
            - button "Удалить страницу" [ref=e73] [cursor=pointer]
          - region "Экраны выбранной страницы" [ref=e74]:
            - heading "Экраны выбранной страницы" [level=2] [ref=e75]
            - list "Экраны" [ref=e76]:
              - listitem [ref=e77]:
                - button "Экран c408d679-a330-47be-9d5c-913512c00969 — 800 × 600" [pressed] [ref=e78] [cursor=pointer]
            - navigation "Навигация по экранам" [ref=e79]:
              - button "Предыдущие экраны" [disabled] [ref=e80]
              - generic [ref=e81]: Страница списка 1
              - button "Следующие экраны" [disabled] [ref=e82]
            - generic [ref=e83]:
              - generic [ref=e84]: Ширина экрана
              - spinbutton "Ширина экрана" [ref=e85]: "800"
              - generic [ref=e86]: Высота экрана
              - spinbutton "Высота экрана" [ref=e87]: "600"
              - button "Создать экран" [ref=e88] [cursor=pointer]
          - region "Варианты выбранного экрана" [ref=e89]:
            - heading "Варианты выбранного экрана" [level=2] [ref=e90]
            - paragraph [ref=e91]: Базовое состояние и сохранённые варианты. Отображение вариантов на холсте и в Preview пока недоступно.
            - status [ref=e92]: "Сохранённых вариантов: 0 · ревизия 2"
            - alert
            - list "Варианты экрана" [ref=e93]:
              - listitem [ref=e94]: Базовое состояние
            - navigation "Навигация по вариантам экрана" [ref=e95]:
              - button "Предыдущие варианты" [disabled] [ref=e96]
              - button "Следующие варианты" [disabled] [ref=e97]
            - generic [ref=e98]:
              - text: Имя нового варианта
              - textbox "Имя нового варианта" [ref=e99]
              - button "Создать пустой вариант" [ref=e100] [cursor=pointer]
          - region "Каталог компонентов" [ref=e101]:
            - heading "Каталог компонентов" [level=2] [ref=e102]
            - generic [ref=e103]:
              - text: Поиск компонентов
              - textbox "Поиск компонентов" [ref=e104]
              - button "Найти компоненты" [ref=e105] [cursor=pointer]
            - status [ref=e106]: Компоненты не найдены.
            - alert
            - list "Компоненты документа"
            - navigation "Навигация по компонентам" [ref=e107]:
              - button "Предыдущие компоненты" [disabled] [ref=e108]
              - button "Следующие компоненты" [disabled] [ref=e109]
          - region "Локальные датасеты" [ref=e110]:
            - heading "Локальные датасеты" [level=2] [ref=e111]
            - status [ref=e112]: Датасетов пока нет.
            - alert
            - list "Датасеты документа"
            - navigation "Навигация по датасетам" [ref=e113]:
              - button "Предыдущие датасеты" [disabled] [ref=e114]
              - button "Следующие датасеты" [disabled] [ref=e115]
            - generic [ref=e117]:
              - heading "Новый датасет" [level=3] [ref=e118]
              - text: Имя датасета
              - textbox "Имя датасета" [ref=e119]
              - text: Формат нового снимка
              - combobox "Формат нового снимка" [ref=e120]:
                - option "JSON" [selected]
                - option "CSV"
              - text: Содержимое нового снимка
              - textbox "Содержимое нового снимка" [ref=e121]
              - button "Создать датасет" [ref=e122] [cursor=pointer]
          - region "Слои выбранного экрана" [ref=e123]:
            - heading "Слои выбранного экрана" [level=2] [ref=e124]
            - status [ref=e125]: Стрелки перемещают выбор, Enter выбирает слой.
            - tree "Слои экрана" [ref=e126]:
              - treeitem "• Second — Frame" [ref=e127]
              - treeitem "▸ Parent — Frame" [active] [selected] [ref=e129]
            - generic [ref=e131]:
              - button "Переместить слой раньше" [ref=e132] [cursor=pointer]
              - button "Переместить слой позже" [disabled] [ref=e133]
            - alert
            - alert
        - region "Холст" [ref=e134]:
          - heading "Холст" [level=2] [ref=e135]
          - paragraph [ref=e136]: "Экран: 800 × 600 uiUnit"
          - group "Управление холстом" [ref=e137]:
            - button "Уменьшить" [ref=e138] [cursor=pointer]
            - status "Масштаб" [ref=e139]: 64%
            - button "Увеличить" [ref=e140] [cursor=pointer]
            - button "Вместить экран" [ref=e141] [cursor=pointer]
            - button "100%" [ref=e142] [cursor=pointer]
          - paragraph [ref=e143]: Перетащите холст указателем или используйте стрелки для панорамирования. Колесо мыши меняет масштаб.
          - region "Область холста" [ref=e144]
        - complementary "Инспектор" [ref=e145]:
          - heading "Инспектор" [level=2] [ref=e146]
          - paragraph [ref=e147]: "Слой: Parent · Frame · ID: 11111111-1111-1111-1111-111111111111"
          - button "Удалить слой" [ref=e148] [cursor=pointer]
          - generic [ref=e149]:
            - status
            - alert
            - generic [ref=e150]:
              - generic [ref=e151]:
                - text: Имя слоя
                - textbox "Имя слоя" [ref=e152]: Parent
              - button "Сохранить имя" [ref=e153] [cursor=pointer]
            - generic [ref=e154]:
              - generic [ref=e155]:
                - text: Semantic key
                - textbox "Semantic key" [ref=e156]
              - paragraph [ref=e157]: Пустое значение удаляет semantic key.
              - button "Сохранить semantic key" [ref=e158] [cursor=pointer]
          - region "Сценарии прототипа" [ref=e159]:
            - heading "Сценарии прототипа" [level=2] [ref=e160]
            - paragraph [ref=e161]: Только просмотр сохранённых сценариев выбранного экрана.
            - status [ref=e162]: Сценариев для выбранного экрана нет.
            - alert
            - generic [ref=e163]:
              - paragraph [ref=e164]: "Исходный слой: Parent — Frame"
              - status [ref=e165]: Не удалось загрузить возможности сценария.
              - generic [ref=e166]:
                - text: Событие
                - combobox "Событие" [ref=e167]
              - generic [ref=e168]:
                - text: Действие
                - combobox "Действие" [ref=e169]
              - generic [ref=e170]:
                - generic [ref=e171]:
                  - text: Вариант экрана
                  - combobox "Вариант экрана" [ref=e172]:
                    - option "Базовое состояние" [selected]
                - status
              - generic [ref=e173]:
                - generic [ref=e174]:
                  - text: Датасет
                  - combobox "Датасет" [ref=e175]:
                    - option "Без датасета" [selected]
                - status [ref=e176]: Датасетов пока нет; доступен выбор без датасета.
              - generic [ref=e177]:
                - generic [ref=e178]:
                  - text: Целевой узел (ID)
                  - textbox "Целевой узел (ID)" [ref=e179]
                - button "Использовать выбранный слой как целевой узел" [ref=e180] [cursor=pointer]
                - generic [ref=e181]:
                  - checkbox "Значение null" [checked] [ref=e182]
                  - text: Значение null
                - generic [ref=e183]:
                  - text: Демонстрационное значение
                  - textbox "Демонстрационное значение" [disabled] [ref=e184]
              - button "Создать сценарий" [disabled] [ref=e185]
            - status
            - alert
            - list "Сценарии выбранного экрана"
            - group "Страницы сценариев" [ref=e186]:
              - button "Предыдущие сценарии" [disabled] [ref=e187]
              - button "Следующие сценарии" [disabled] [ref=e188]
          - region "Диагностика экрана" [ref=e189]:
            - heading "Диагностика экрана" [level=2] [ref=e190]
            - status [ref=e191]: Диагностик для выбранного экрана нет.
            - alert
            - list "Диагностика выбранного экрана"
            - group "Страницы диагностики" [ref=e192]:
              - button "Предыдущие диагностики" [disabled] [ref=e193]
              - button "Следующие диагностики" [disabled] [ref=e194]
          - region "Размер экрана" [ref=e195]:
            - heading "Размер экрана" [level=2] [ref=e196]
            - paragraph [ref=e197]: "Подтверждённый размер: 800 × 600 uiUnit"
            - generic [ref=e198]:
              - text: Ширина выбранного экрана
              - spinbutton "Ширина выбранного экрана" [ref=e199]: "800"
              - text: Высота выбранного экрана
              - spinbutton "Высота выбранного экрана" [ref=e200]: "600"
              - button "Изменить размер" [ref=e201] [cursor=pointer]
            - status
            - alert
          - region "Токены дизайна" [ref=e202]:
            - heading "Токены дизайна" [level=2] [ref=e203]
            - paragraph [ref=e204]: "Цвет: #RRGGBB или #RRGGBBAA. Отступ: число."
            - status [ref=e205]: Токенов пока нет.
            - alert
            - list "Токены документа"
            - generic [ref=e206]:
              - heading "Новый токен" [level=3] [ref=e207]
              - text: Имя токена
              - textbox "Имя токена" [ref=e208]
              - text: Тип токена
              - combobox "Тип токена" [ref=e209]:
                - option "Цвет" [selected]
                - option "Отступ"
              - text: Light
              - textbox "Light" [ref=e210]
              - text: Dark
              - textbox "Dark" [ref=e211]
              - button "Создать токен" [ref=e212] [cursor=pointer]
  - generic [ref=e213]:
    - status [ref=e214]: Загрузка…
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
  12 |  await page.locator('.layer-label').first().click();await expect(page.locator('#node-earlier')).toBeDisabled();await page.locator('#node-later').focus();await page.keyboard.press('Enter');await expect(page.locator('#node-earlier')).toBeEnabled();expect(calls[0]).toMatchObject({nodeId:a,expectedParentId:f.screen,targetParentId:f.screen,position:1});
> 13 |  await page.locator('[data-id="'+a+'"] > .layer-label').click(); await page.locator('[data-id="'+c+'"] > .layer-label').click();await expect(page.locator('#node-earlier')).toBeDisabled();await page.locator('#node-later').click();await expect(page.locator('#node-later')).toBeDisabled();expect(calls[1]).toMatchObject({nodeId:c,expectedParentId:a,targetParentId:a,position:1});
     |                                                                                                                         ^ Error: locator.click: Test timeout of 30000ms exceeded.
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