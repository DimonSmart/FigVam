# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: node-reparent.spec.js >> refreshes the tree when the selected layer disappeared before choosing a parent
- Location: node-reparent.spec.js:163:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('#node-order-status')
Expected substring: "Слой больше не находится на этом экране. Дерево обновлено."
Received string:    ""
Timeout: 5000ms

Call log:
  - Expect "toContainText" locator('#node-order-status') with timeout 5000ms
  - waiting for locator('#node-order-status')
    13 × locator resolved to <p role="status" tabindex="-1" id="node-order-status"></p>
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
  - heading "Layers" [level=1]
  - text: Общий черновик · ревизия 3 Design · каркас редактора Имя документа
  - textbox "Имя документа": Layers
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
    - paragraph: Файл содержит показанную ревизию 3. JSON не включает содержимое ассетов; для них используйте контейнер.
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
          - button "Экран 7de0948b-216b-4d0d-895f-81aef6db1cc4 — 600 × 400" [pressed]
        - listitem:
          - button "Экран 30f47a62-2577-4779-925c-04438bbcdb5e — 600 × 400"
      - navigation "Навигация по экранам":
        - button "Предыдущие экраны" [disabled]
        - text: Страница списка 1
        - button "Следующие экраны" [disabled]
      - text: Ширина экрана
      - spinbutton "Ширина экрана"
      - text: Высота экрана
      - spinbutton "Высота экрана"
      - button "Создать экран"
    - region "Варианты выбранного экрана":
      - heading "Варианты выбранного экрана" [level=2]
      - paragraph: Базовое состояние и сохранённые варианты. Отображение вариантов на холсте и в Preview пока недоступно.
      - status: "Сохранённых вариантов: 0 · ревизия 3"
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
        - treeitem "▸ Source — Test container" [selected]
        - treeitem "▸ Folder — Test container"
        - treeitem "• Leaf — Test leaf"
      - button "Переместить слой раньше" [disabled]
      - button "Переместить слой позже"
      - button "Сменить родителя слоя" [expanded]
      - form "Смена родителя слоя":
        - status: Слой больше не находится на этом экране.
        - text: Новый родитель
        - combobox "Новый родитель" [disabled]:
          - option "Выберите родителя" [selected]
        - text: Позиция среди детей
        - spinbutton "Позиция среди детей" [disabled]
        - paragraph
        - button "Переместить к новому родителю" [disabled]
        - button "Отмена"
      - status
      - alert
  - region "Холст":
    - heading "Холст" [level=2]
    - paragraph: "Экран: 600 × 400 uiUnit"
    - group "Управление холстом":
      - button "Уменьшить"
      - status "Масштаб": 96%
      - button "Увеличить"
      - button "Вместить экран"
      - button "100%"
    - paragraph: Перетащите холст указателем или используйте стрелки для панорамирования. Колесо мыши меняет масштаб.
    - region "Область холста"
  - complementary "Инспектор":
    - heading "Инспектор" [level=2]
    - paragraph: "Слой: Source · Test container · ID: 5245a11a-ecd3-40b7-a362-6ed9f81a0d09"
    - button "Удалить слой"
    - status
    - alert
    - text: Имя слоя
    - textbox "Имя слоя": Source
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
      - paragraph: "Исходный слой: Source — Test container"
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
      - paragraph: "Подтверждённый размер: 600 × 400 uiUnit"
      - text: Ширина выбранного экрана
      - spinbutton "Ширина выбранного экрана": "600"
      - text: Высота выбранного экрана
      - spinbutton "Высота выбранного экрана": "400"
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
  68  |     const oldChildren = children.get(expectedParentId);
  69  |     oldChildren.splice(oldChildren.indexOf(nodeId), 1);
  70  |     children.get(targetParentId).splice(position, 0, nodeId);
  71  |   }
  72  |   let answer = (route, body) => { move(body.nodeId, body.expectedParentId, body.targetParentId, body.position); return ack(route, body); };
  73  |   function ack(route, body) {
  74  |     return route.fulfill({ json: { code: 'ACCEPTED', documentId: doc, commandId: body.commandId, revision: 4 } });
  75  |   }
  76  |   await page.route('**/commands/move-node', route => {
  77  |     calls.push(route.request().postData());
  78  |     return answer(route, route.request().postDataJSON());
  79  |   });
  80  |   await page.goto(`/documents/${doc}`);
  81  |   await page.getByLabel('Bearer-токен', { exact: true }).fill(bearer);
  82  |   await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  83  |   await expect(page.locator('#screens button')).toHaveCount(2);
  84  |   await page.locator('#screens button').first().click();
  85  |   await expect(layer(page, source)).toBeVisible();
  86  |   return { calls, reads, source, target, folder, descendant, leaf, existingChild, screen, anotherScreen, children, move, ack,
  87  |     answer: fn => { answer = fn; }, catalogStatus: status => { catalogStatus = status; } };
  88  | }
  89  | 
  90  | const layer = (page, id) => page.locator(`#layers [data-id="${id}"]`);
  91  | const reparent = page => page.getByRole('button', { name: 'Сменить родителя слоя' });
  92  | const targetSelect = page => page.getByLabel('Новый родитель');
  93  | const positionInput = page => page.getByLabel('Позиция среди детей');
  94  | const moveStatus = page => page.locator('#node-order-status');
  95  | const retry = page => page.getByRole('button', { name: 'Повторить перемещение слоя' });
  96  | 
  97  | async function selectLayer(page, id) {
  98  |   await layer(page, id).press('Enter');
  99  |   await expect(layer(page, id)).toHaveAttribute('aria-selected', 'true');
  100 | }
  101 | 
  102 | async function submit(page, fixture, target = fixture.target) {
  103 |   await reparent(page).click();
  104 |   await targetSelect(page).selectOption(target);
  105 |   await page.getByRole('button', { name: 'Переместить к новому родителю' }).click();
  106 | }
  107 | 
  108 | test('keyboard reparenting loads collapsed paginated targets and moves back to the screen root', async ({ page, request }) => {
  109 |   const f = await setup(page, request, { role: 'Editor', paged: true });
  110 |   await selectLayer(page, f.source);
  111 |   await expect(layer(page, f.target)).toHaveCount(0);
  112 |   await page.keyboard.press('Tab');
  113 |   await page.keyboard.press('Tab');
  114 |   await expect(reparent(page)).toBeFocused();
  115 |   await page.keyboard.press('Enter');
  116 |   await expect(targetSelect(page)).toBeFocused();
  117 |   await expect(targetSelect(page).locator('option')).toHaveText(['Выберите родителя', 'Folder', 'Folder / Destination']);
  118 |   expect(f.reads.map(q => [q.get('offset'), q.get('revision'), q.get('screenId')])).toEqual([['0', null, f.screen], ['100', '3', f.screen]]);
  119 |   await page.keyboard.press('End');
  120 |   await expect(targetSelect(page)).toHaveValue(f.target);
  121 |   await page.keyboard.press('Tab');
  122 |   await expect(positionInput(page)).toBeFocused();
  123 |   await expect(positionInput(page)).toHaveValue('2');
  124 |   await page.keyboard.press('ArrowDown');
  125 |   await page.keyboard.press('Tab');
  126 |   await page.keyboard.press('Enter');
  127 |   await expect(moveStatus(page)).toContainText('Слой перемещён');
  128 |   await expect(layer(page, f.target).locator(':scope > [role=group] > [role=treeitem]').first()).toHaveAttribute('data-id', f.source);
  129 |   await expect(layer(page, f.source)).toHaveAttribute('aria-selected', 'true');
  130 |   const first = JSON.parse(f.calls[0]);
  131 |   expect(first).toMatchObject({ nodeId: f.source, expectedParentId: f.screen, targetParentId: f.target, position: 0 });
  132 |   await submit(page, f, f.screen);
  133 |   await expect(moveStatus(page)).toContainText('Слой перемещён');
  134 |   await expect(page.locator('#layers > [role=treeitem]').last()).toHaveAttribute('data-id', f.source);
  135 |   const second = JSON.parse(f.calls[1]);
  136 |   expect(second).toMatchObject({ nodeId: f.source, expectedParentId: f.target, targetParentId: f.screen, position: 2 });
  137 |   expect(second.commandId).not.toBe(first.commandId);
  138 | });
  139 | 
  140 | test('refreshes the layer tree after parent conflict and concurrent deletion', async ({ page, request }) => {
  141 |   const f = await setup(page, request);
  142 |   await selectLayer(page, f.source);
  143 |   f.answer(route => {
  144 |     f.move(f.source, f.screen, f.folder, 0);
  145 |     return route.fulfill({ status: 409, json: { code: 'INVALID_LAYOUT_CONTEXT' } });
  146 |   });
  147 |   await submit(page, f);
  148 |   await expect(moveStatus(page)).toContainText('Родитель слоя изменился. Дерево обновлено.');
  149 |   await expect(page.locator(`#layers > [data-id="${f.source}"]`)).toHaveCount(0);
  150 |   await layer(page, f.folder).locator(':scope > .layer-label').click();
  151 |   await expect(layer(page, f.source)).toBeVisible();
  152 |   await selectLayer(page, f.source);
  153 |   f.answer(route => {
  154 |     f.children.get(f.folder).splice(0, 1);
  155 |     return route.fulfill({ status: 404, json: { code: 'NODE_NOT_FOUND' } });
  156 |   });
  157 |   await submit(page, f, f.screen);
  158 |   await expect(moveStatus(page)).toContainText('Слой уже удалён другим участником. Дерево обновлено.');
  159 |   await expect(layer(page, f.source)).toHaveCount(0);
  160 |   await expect(retry(page)).toBeHidden();
  161 | });
  162 | 
  163 | test('refreshes the tree when the selected layer disappeared before choosing a parent', async ({ page, request }) => {
  164 |   const f = await setup(page, request);
  165 |   await selectLayer(page, f.source);
  166 |   f.children.get(f.screen).shift();
  167 |   await reparent(page).click();
> 168 |   await expect(moveStatus(page)).toContainText('Слой больше не находится на этом экране. Дерево обновлено.');
      |                                  ^ Error: expect(locator).toContainText(expected) failed
  169 |   await expect(layer(page, f.source)).toHaveCount(0);
  170 |   expect(f.calls).toHaveLength(0);
  171 | });
  172 | 
  173 | test('retries the exact serialized request after losing the response and prevents duplicate submissions', async ({ page, request }) => {
  174 |   const f = await setup(page, request);
  175 |   const entered = deferred(), release = deferred();
  176 |   f.answer(async (route, body) => {
  177 |     if (f.calls.length === 1) {
  178 |       entered.resolve();
  179 |       await release.promise;
  180 |       f.move(body.nodeId, body.expectedParentId, body.targetParentId, body.position);
  181 |       return route.abort();
  182 |     }
  183 |     return f.ack(route, body);
  184 |   });
  185 |   await selectLayer(page, f.source);
  186 |   await submit(page, f);
  187 |   await entered.promise;
  188 |   await expect(reparent(page)).toBeDisabled();
  189 |   await page.locator('#node-reparent-form').dispatchEvent('submit');
  190 |   release.resolve();
  191 |   await expect(retry(page)).toBeVisible();
  192 |   expect(f.calls).toHaveLength(1);
  193 |   await retry(page).click();
  194 |   await expect(moveStatus(page)).toContainText('Слой перемещён');
  195 |   expect(f.calls).toHaveLength(2);
  196 |   expect(f.calls[1]).toBe(f.calls[0]);
  197 | });
  198 | 
  199 | test('Viewer can select layers and cannot load reparenting targets or move layers', async ({ page, request }) => {
  200 |   const f = await setup(page, request, { role: 'Viewer' });
  201 |   await selectLayer(page, f.source);
  202 |   await expect(reparent(page)).toBeHidden();
  203 |   await page.locator('#node-reparent').dispatchEvent('click');
  204 |   await expect(page.locator('#node-reparent-form')).toBeHidden();
  205 |   expect(f.reads).toHaveLength(0);
  206 |   expect(f.calls).toHaveLength(0);
  207 | });
  208 | 
  209 | test('target loading is retryable and loss of access closes the document', async ({ page, request }) => {
  210 |   const f = await setup(page, request);
  211 |   await selectLayer(page, f.source);
  212 |   f.catalogStatus(503);
  213 |   await reparent(page).click();
  214 |   await expect(page.locator('#node-reparent-status')).toContainText('Сервер не смог выполнить запрос');
  215 |   await expect(targetSelect(page)).toBeDisabled();
  216 |   f.catalogStatus(403);
  217 |   await page.getByRole('button', { name: 'Повторить загрузку родителей' }).click();
  218 |   await expect(page.locator('#editor-view')).toBeHidden();
  219 |   await expect(page.locator('#error')).toContainText('Доступ к документу потерян');
  220 | });
  221 | 
  222 | for (const exit of ['selection', 'screen', 'document', 'logout']) {
  223 |   test(`a late move response is ignored after changing ${exit}`, async ({ page, request }) => {
  224 |     const f = await setup(page, request);
  225 |     const entered = deferred(), release = deferred();
  226 |     f.answer(async route => {
  227 |       entered.resolve();
  228 |       await release.promise;
  229 |       return route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } });
  230 |     });
  231 |     await selectLayer(page, f.source);
  232 |     await submit(page, f);
  233 |     await entered.promise;
  234 |     if (exit === 'selection') await selectLayer(page, f.leaf);
  235 |     if (exit === 'screen') {
  236 |       await page.locator('#screens button').nth(1).click();
  237 |       await expect(page.locator('#layers')).toContainText('Other screen container');
  238 |     }
  239 |     if (exit === 'document') await page.getByRole('link', { name: '← Документы' }).click();
  240 |     if (exit === 'logout') await page.getByRole('button', { name: 'Забыть токен' }).click();
  241 |     const received = page.waitForResponse(response => response.url().endsWith('/commands/move-node'));
  242 |     release.resolve();
  243 |     expect((await received).status()).toBe(403);
  244 |     if (exit === 'selection') {
  245 |       await expect(layer(page, f.leaf)).toHaveAttribute('aria-selected', 'true');
  246 |       await expect(retry(page)).toBeVisible();
  247 |     }
  248 |     if (exit === 'screen') {
  249 |       await expect(page.locator('#layers')).toContainText('Other screen container');
  250 |       await page.locator('#screens button').first().click();
  251 |       await expect(retry(page)).toBeVisible();
  252 |     }
  253 |     if (exit === 'document') await expect(page.locator('#documents-view')).toBeVisible();
  254 |     if (exit === 'logout') await expect(page.locator('#authentication')).toBeVisible();
  255 |     await expect(page.locator('#error')).not.toContainText('Доступ к документу потерян');
  256 |     await expect(page.locator('#node-reparent-form')).toBeHidden();
  257 |     expect(f.calls).toHaveLength(1);
  258 |   });
  259 | }
  260 | 
```