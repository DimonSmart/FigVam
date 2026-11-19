# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: node-metadata.spec.js >> late metadata responses cannot affect a new selection and active access refusal closes the document
- Location: node-metadata.spec.js:26:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('treeitem').first()

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
        - heading "Stale metadata" [level=1] [ref=e11]
        - generic [ref=e12]: Общий черновик · ревизия 1
        - generic [ref=e13]: Design · каркас редактора
        - generic [ref=e14]:
          - text: Имя документа
          - textbox "Имя документа" [ref=e15]: Stale metadata
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
        - paragraph [ref=e28]: Файл содержит показанную ревизию 1. JSON не включает содержимое ассетов; для них используйте контейнер.
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
          - listitem [ref=e38]: "Участник · цвет #2455a4 · экран: не выбран · выбранные ID: нет · курсор недоступен"
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
          - button "Обновить страницы" [active] [ref=e59] [cursor=pointer]
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
            - list "Экраны"
            - navigation "Навигация по экранам" [ref=e76]:
              - button "Предыдущие экраны" [disabled] [ref=e77]
              - generic [ref=e78]: Страница списка 1
              - button "Следующие экраны" [disabled] [ref=e79]
            - generic [ref=e80]:
              - generic [ref=e81]: Ширина экрана
              - spinbutton "Ширина экрана" [ref=e82]: "800"
              - generic [ref=e83]: Высота экрана
              - spinbutton "Высота экрана" [ref=e84]: "600"
              - button "Создать экран" [ref=e85] [cursor=pointer]
          - region "Варианты выбранного экрана" [ref=e86]:
            - heading "Варианты выбранного экрана" [level=2] [ref=e87]
            - paragraph [ref=e88]: Базовое состояние и сохранённые варианты. Отображение вариантов на холсте и в Preview пока недоступно.
            - status [ref=e89]: Выберите экран.
            - alert
            - list "Варианты экрана"
            - navigation "Навигация по вариантам экрана" [ref=e90]:
              - button "Предыдущие варианты" [disabled] [ref=e91]
              - button "Следующие варианты" [disabled] [ref=e92]
          - region "Каталог компонентов" [ref=e93]:
            - heading "Каталог компонентов" [level=2] [ref=e94]
            - generic [ref=e95]:
              - text: Поиск компонентов
              - textbox "Поиск компонентов" [ref=e96]
              - button "Найти компоненты" [ref=e97] [cursor=pointer]
            - status [ref=e98]: Компоненты не найдены.
            - alert
            - list "Компоненты документа"
            - navigation "Навигация по компонентам" [ref=e99]:
              - button "Предыдущие компоненты" [disabled] [ref=e100]
              - button "Следующие компоненты" [disabled] [ref=e101]
          - region "Локальные датасеты" [ref=e102]:
            - heading "Локальные датасеты" [level=2] [ref=e103]
            - status [ref=e104]: Датасетов пока нет.
            - alert
            - list "Датасеты документа"
            - navigation "Навигация по датасетам" [ref=e105]:
              - button "Предыдущие датасеты" [disabled] [ref=e106]
              - button "Следующие датасеты" [disabled] [ref=e107]
            - generic [ref=e109]:
              - heading "Новый датасет" [level=3] [ref=e110]
              - text: Имя датасета
              - textbox "Имя датасета" [ref=e111]
              - text: Формат нового снимка
              - combobox "Формат нового снимка" [ref=e112]:
                - option "JSON" [selected]
                - option "CSV"
              - text: Содержимое нового снимка
              - textbox "Содержимое нового снимка" [ref=e113]
              - button "Создать датасет" [ref=e114] [cursor=pointer]
          - region "Слои выбранного экрана" [ref=e115]:
            - heading "Слои выбранного экрана" [level=2] [ref=e116]
            - status [ref=e117]: Выберите экран.
            - tree "Слои экрана"
        - region "Холст" [ref=e118]:
          - heading "Холст" [level=2] [ref=e119]
          - paragraph [ref=e120]: Выберите экран, чтобы показать его на холсте.
          - group "Управление холстом" [ref=e121]:
            - button "Уменьшить" [disabled] [ref=e122]
            - status "Масштаб" [ref=e123]: 100%
            - button "Увеличить" [disabled] [ref=e124]
            - button "Вместить экран" [disabled] [ref=e125]
            - button "100%" [disabled] [ref=e126]
          - paragraph [ref=e127]: Перетащите холст указателем или используйте стрелки для панорамирования. Колесо мыши меняет масштаб.
          - region "Область холста" [ref=e128]
        - complementary "Инспектор" [ref=e129]:
          - heading "Инспектор" [level=2] [ref=e130]
          - paragraph [ref=e131]: Выберите слой.
          - region "Сценарии прототипа" [ref=e132]:
            - heading "Сценарии прототипа" [level=2] [ref=e133]
            - paragraph [ref=e134]: Только просмотр сохранённых сценариев выбранного экрана.
            - status [ref=e135]: Выберите экран.
            - alert
            - status
            - alert
            - list "Сценарии выбранного экрана"
            - group "Страницы сценариев" [ref=e136]:
              - button "Предыдущие сценарии" [disabled] [ref=e137]
              - button "Следующие сценарии" [disabled] [ref=e138]
          - region "Диагностика экрана" [ref=e139]:
            - heading "Диагностика экрана" [level=2] [ref=e140]
            - status [ref=e141]: Выберите экран.
            - alert
            - list "Диагностика выбранного экрана"
            - group "Страницы диагностики" [ref=e142]:
              - button "Предыдущие диагностики" [disabled] [ref=e143]
              - button "Следующие диагностики" [disabled] [ref=e144]
          - region "Размер экрана" [ref=e145]:
            - heading "Размер экрана" [level=2] [ref=e146]
            - paragraph [ref=e147]: Выберите экран.
            - status
            - alert
          - region "Токены дизайна" [ref=e148]:
            - heading "Токены дизайна" [level=2] [ref=e149]
            - paragraph [ref=e150]: "Цвет: #RRGGBB или #RRGGBBAA. Отступ: число."
            - status [ref=e151]: Токенов пока нет.
            - alert
            - list "Токены документа"
            - generic [ref=e152]:
              - heading "Новый токен" [level=3] [ref=e153]
              - text: Имя токена
              - textbox "Имя токена" [ref=e154]
              - text: Тип токена
              - combobox "Тип токена" [ref=e155]:
                - option "Цвет" [selected]
                - option "Отступ"
              - text: Light
              - textbox "Light" [ref=e156]
              - text: Dark
              - textbox "Dark" [ref=e157]
              - button "Создать токен" [ref=e158] [cursor=pointer]
  - generic [ref=e159]:
    - status [ref=e160]: Страницы обновлены.
    - alert
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
  30 |  const first='11111111-1111-1111-1111-111111111111', second='22222222-2222-2222-2222-222222222222';
  31 |  await page.route('**/children/**', route=>route.fulfill({json:{items:[{id:first,name:'First',kind:'Frame',childCount:0},{id:second,name:'Second',kind:'Frame',childCount:0}],total:2}}));
  32 |  let release, entered; const waiting = new Promise(resolve => entered=resolve), gate = new Promise(resolve => release=resolve);
  33 |  await page.route(`**/nodes/${first}?*`, async route=>{ entered(); await gate; await route.fulfill({status:401,json:{}}); });
  34 |  await page.route(`**/nodes/${second}?*`, route=>route.fulfill({json:{revision:Number(new URL(route.request().url()).searchParams.get('revision')),items:[{id:second,name:'Second',semanticKey:null}]}}));
> 35 |  await page.getByRole('button',{name:'Обновить страницы'}).click(); await page.getByRole('treeitem').first().click(); await waiting;
     |                                                                                                              ^ Error: locator.click: Test timeout of 30000ms exceeded.
  36 |  await page.getByRole('treeitem').nth(1).click(); await expect(page.locator('#node-name')).toHaveValue('Second'); release();
  37 |  await expect(page.locator('#editor-view')).toBeVisible(); await expect(page.locator('#node-name')).toHaveValue('Second');
  38 |  await page.unroute(`**/nodes/${first}?*`); await page.route(`**/nodes/${first}?*`, route=>route.fulfill({status:403,json:{}}));
  39 |  await page.getByRole('treeitem').first().click(); await expect(page.locator('#editor-view')).toBeHidden();
  40 | });
  41 | 
```