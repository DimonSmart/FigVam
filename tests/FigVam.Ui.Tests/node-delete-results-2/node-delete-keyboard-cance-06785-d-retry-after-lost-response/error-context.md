# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: node-delete.spec.js >> keyboard cancel, confirmation and retry after lost response
- Location: node-delete.spec.js:11:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('#node-delete-status')
Expected substring: "неизвестен"
Received string:    ""
Timeout: 5000ms

Call log:
  - Expect "toContainText" locator('#node-delete-status') with timeout 5000ms
  - waiting for locator('#node-delete-status')
    13 × locator resolved to <p role="alert" id="node-delete-status"></p>
       - unexpected value ""

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
  - heading "Delete layer" [level=1]
  - text: Общий черновик · ревизия 2 Design · каркас редактора Имя документа
  - textbox "Имя документа": Delete layer
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
          - button "Экран ef6e3f7a-2bdd-4b61-b5bd-1174825c607f — 800 × 600" [pressed]
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
      - status: Maximum call stack size exceeded Обновите страницы.
      - tree "Слои экрана"
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
    - paragraph: Выберите слой.
    - region "Сценарии прототипа":
      - heading "Сценарии прототипа" [level=2]
      - paragraph: Только просмотр сохранённых сценариев выбранного экрана.
      - status: Сценариев для выбранного экрана нет.
      - alert
      - paragraph: На экране нет слоёв для сценария.
      - status: Возможности сценария недоступны.
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
      - button "Использовать выбранный слой как целевой узел" [disabled]
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
  1  | const { test, expect, bearer } = require('./fixtures');
  2  | async function setup(page) {
  3  |  await page.goto('/'); await page.getByLabel('Bearer-токен',{exact:true}).fill(bearer); await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  4  |  await page.getByLabel('Имя нового документа').fill('Delete layer'); await page.getByRole('button',{name:'Создать документ',exact:true}).click(); await page.getByRole('button',{name:'Создать страницу'}).click(); await page.getByLabel('Ширина экрана').fill('800'); await page.getByLabel('Высота экрана').fill('600'); await page.getByRole('button',{name:'Создать экран'}).click();
  5  |  await expect(page.locator('#screens button')).toHaveCount(1);
  6  |  const id='11111111-1111-1111-1111-111111111111'; let exists=true;
  7  |  await page.route('**/children/**', route=>route.fulfill({json:{items:exists?[{id,name:'Parent',kind:'Frame',childCount:1}]:[],total:exists?1:0}}));
  8  |  await page.route(`**/nodes/${id}?*`, route=>route.fulfill({json:{revision:Number(new URL(route.request().url()).searchParams.get('revision')),items:[{id,name:'Parent',semanticKey:null}]}}));
  9  |  await page.getByRole('button',{name:'Обновить страницы'}).click(); await page.getByRole('treeitem').first().click(); return {remove:()=>{exists=false;}};
  10 | }
  11 | test('keyboard cancel, confirmation and retry after lost response', async ({page})=>{
  12 |  const fixture=await setup(page); let calls=[];
  13 |  await page.route('**/commands/delete-node', async route=>{const body=route.request().postDataJSON(); calls.push(body); if(calls.length===1){fixture.remove(); return route.abort();} await route.fulfill({json:{code:'ACCEPTED',documentId:page.url().split('/').at(-1),commandId:body.commandId,revision:10}});});
  14 |  page.once('dialog', async d=>{expect(d.message()).toContain('Parent'); expect(d.message()).toContain('поддерево'); await d.dismiss();}); await page.locator('#node-delete').focus(); await page.keyboard.press('Enter'); expect(calls).toHaveLength(0);
> 15 |  page.once('dialog', d=>d.accept()); await page.keyboard.press('Enter'); await expect(page.locator('#node-delete-status')).toContainText('неизвестен'); await page.locator('#node-delete-retry').click(); await expect(page.locator('#inspector-selection')).toHaveText('Выберите слой.'); expect(calls[1]).toEqual(calls[0]); expect(Object.keys(calls[0]).sort()).toEqual(['commandId','nodeId']);
     |                                                                                                                            ^ Error: expect(locator).toContainText(expected) failed
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
```