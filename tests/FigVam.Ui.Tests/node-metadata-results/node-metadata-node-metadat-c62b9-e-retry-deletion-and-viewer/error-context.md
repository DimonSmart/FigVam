# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: node-metadata.spec.js >> node metadata supports confirmation, lost response retry, deletion and viewer
- Location: node-metadata.spec.js:2:1

# Error details

```
Error: expect(locator).toHaveValue(expected) failed

Locator: locator('#node-name')
Expected: "Original"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveValue" locator('#node-name') with timeout 5000ms
  - waiting for locator('#node-name')

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
  - heading "Metadata" [level=1]
  - text: Общий черновик · ревизия 2 Design · каркас редактора Имя документа
  - textbox "Имя документа": Metadata
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
          - button "Экран 08a80f42-673c-414d-a041-eaf74969bcae — 800 × 600" [pressed]
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
        - treeitem "• Original — Frame" [selected]
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
    - paragraph: "Слой: Original · Frame · ID: 11111111-1111-1111-1111-111111111111"
    - paragraph: Параметры элементов пока недоступны.
    - region "Сценарии прототипа":
      - heading "Сценарии прототипа" [level=2]
      - paragraph: Только просмотр сохранённых сценариев выбранного экрана.
      - status: Сценариев для выбранного экрана нет.
      - alert
      - paragraph: "Исходный слой: Original — Frame"
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
  1  | const { test, expect, bearer } = require('./fixtures');
  2  | test('node metadata supports confirmation, lost response retry, deletion and viewer', async ({ page }) => {
  3  |  await page.goto('/'); await page.getByLabel('Bearer-токен', {exact:true}).fill(bearer); await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  4  |  await page.getByLabel('Имя нового документа').fill('Metadata'); await page.getByRole('button',{name:'Создать документ',exact:true}).click();
  5  |  await page.getByRole('button',{name:'Создать страницу'}).click(); await page.getByLabel('Ширина экрана').fill('800'); await page.getByLabel('Высота экрана').fill('600'); await page.getByRole('button',{name:'Создать экран'}).click();
  6  |  await expect(page.locator('#screens button')).toHaveCount(1);
  7  |  const node='11111111-1111-1111-1111-111111111111', values={name:'Original',semanticKey:'old'}; let deleted=false, lost=true, bodies=[];
  8  |  await page.route('**/children/**', route=>route.fulfill({json:{items:deleted?[]:[{id:node,name:values.name,kind:'Frame',childCount:0}],total:deleted?0:1}}));
  9  |  await page.route(`**/nodes/${node}?*`, route=>route.fulfill({json:{revision:Number(new URL(route.request().url()).searchParams.get('revision')),items:[{id:node,...values}]}}));
> 10 |  await page.getByRole('button',{name:'Обновить страницы'}).click(); await page.getByRole('treeitem').first().click(); await expect(page.locator('#node-name')).toHaveValue('Original');
     |                                                                                                                                                                ^ Error: expect(locator).toHaveValue(expected) failed
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
```