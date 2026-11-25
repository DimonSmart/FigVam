# FigVam MCP

## Подключение

1. Запустите FigVam и войдите в редактор как Owner или Editor.
2. Откройте документ, меню «MCP-доступ», нажмите «Разрешить».
3. Скопируйте конфигурацию клиента или адрес и токен. Вставляйте токен только в доверенный MCP-клиент; не отправляйте его в чат, репозиторий или журнал.
4. Используйте Streamable HTTP и заголовок Authorization: Bearer. Пример (секрет-заполнитель):

```json
{"mcpServers":{"figvam":{"type":"http","url":"https://figvam.example/mcp","headers":{"Authorization":"Bearer <MCP_TOKEN>"}}}}
```

Локальные режимы Local/Test могут определять endpoint по единственному loopback-адресу Kestrel. Для развертывания укажите доверенный публичный HTTPS endpoint через `Mcp__PublicEndpoint=https://figvam.example/mcp`. Настройте TLS на сервере или на доверенном reverse proxy; внешний HTTP не должен быть доступен. Не используйте Host из входящего запроса для построения конфигурации.

Токен действует только для одного документа и выдавшего его пользователя, пока не отозван, не потеряны права или не перезапущен процесс. Повторная выдача возвращает активное разрешение. Отзыв ожидает завершения уже допущенной операции; последующие операции запрещены. После перезапуска выдайте новый токен. Viewer не может предоставлять доступ. MCP-токен не работает в REST API. Состояние разрешения не реплицируется между процессами; для нескольких экземпляров требуется отдельное решение маршрутизации и отзыва.

## Инструменты

Чтение: `get_document`, `list_pages`, `list_screens`, `get_screen`, `get_node`, `list_children`, `get_screen_tree`, `list_node_types`, `get_node_schema`, `list_tokens`, `list_scenarios`, `get_screen_layout`.

Редактирование: `create_page`, `rename_page`, `create_screen`, `rename_screen`, `resize_screen`, `duplicate_screen`, `create_node`, `rename_node`, `set_node_properties`, `remove_node_properties`, `move_node`, `delete_node`, `create_token`, `set_token_value`, `create_scenario`, `update_scenario`, `delete_scenario`, `save_version`.

Все инструменты доступны через tools/list со схемами и описаниями. documentId не передаётся. Для постраничного чтения используйте offset, limit (1–100), revision; дерево по умолчанию ограничено глубиной 3. Ответ содержит структурированные данные; ошибки содержат status REJECTED и code. Изменения возвращают commandId, revision и идентификаторы результата. Для повторной доставки используйте тот же commandId. Перед операциями с expectedRevision прочитайте актуальную ревизию. При конфликте обновите состояние, а не перезаписывайте данные вслепую.

Свойства определяются профилем (get_node_schema). Передавайте числа, строки, логические значения, цвета #RRGGBB или #RRGGBBAA, ссылки {"tokenId":"UUID"} и тени {"offsetX":0,"offsetY":12,"blurRadius":32,"spreadRadius":0,"color":"#0F172A29"}. create_node и set_node_properties применяют свойства атомарно. move_node использует нулевой индекс и ожидаемого родителя. create_scenario и update_scenario принимают event и список actions, MVP поддерживает navigate со screenId. save_version создаёт именованную неизменяемую версию.

## Проверка

```sh
dotnet restore --locked-mode
dotnet test tests/FigVam.Server.Tests --filter FullyQualifiedName~Mcp
cd tests/FigVam.Ui.Tests
npm ci
npx playwright install chromium
npx playwright test mcp-login-flow.spec.js
```

Перед Playwright соберите решение в Debug. Автоматизированная проверка использует тестовые токены на loopback и официальный .NET MCP-клиент; браузерный тест проверяет протокол и визуальные пиксели из исходного Login Flow, не создавая элементы через REST или UI.

### Воспроизводимый AI smoke test

Подключите MCP-клиент к пустому документу. Включите только FigVam MCP и передайте агенту следующий запрос (без предписанного порядка вызовов):

> Создай прототип Login Flow: экран Login размером 800×600 с фоном #EEF2F7, белой карточкой 360×400, скруглением 16, тонкой рамкой и мягкой тенью. В карточке размести Sign in, пояснение, поля Username и Password, синюю кнопку Login. Используй токен spacing.dialog=32 для правого отступа. Поле Password должно быть нативно маскированным. Дублируй экран как Login Error и добавь красный текст Invalid password. Настрой Click кнопки и Submit поля пароля на переход к Login Error. Сохрани версию Login and invalid password. Используй только MCP FigVam, самостоятельно исследуй профиль свойств и проверяй результаты.

Проверьте появление элементов в открытом редакторе, тени, отступы, порядок, переходы по кнопке и Enter, сохранение версии и отзыв доступа. После перезапуска откройте документ снова, убедитесь, что прототип сохранён, а прежний токен не работает. Для тестирования небольших моделей повторите тот же запрос с выбранной локальной моделью.
