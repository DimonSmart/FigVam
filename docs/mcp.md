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

## ChatGPT через OpenAI Secure MCP Tunnel (локальный Aspire)

Один раз создайте приватный туннель в [OpenAI Platform](https://platform.openai.com/settings/organization/tunnels),
разрешите только своё ChatGPT workspace, скачайте актуальный [tunnel-client](https://github.com/openai/tunnel-client/releases/latest)
и создайте Runtime API key с Tunnels Read + Use (не admin key). Не запускайте несколько клиентов с одним Tunnel ID.
AppHost автоматически задаёт `HEALTH_LISTEN_ADDR=127.0.0.1:0`: встроенный HTTP-сервер диагностики tunnel-client получает свободный локальный порт вместо фиксированного 8080.

Из корня репозитория (PowerShell 7):

```powershell
dotnet user-secrets set "McpTunnel:TunnelId" "tunnel_..." --project src/FigVam.AppHost
dotnet user-secrets set "McpTunnel:Executable" "C:\Tools\tunnel-client.exe" --project src/FigVam.AppHost
$apiKey = Read-Host "OpenAI tunnel runtime API key" -MaskInput
dotnet user-secrets set "Parameters:openai-tunnel-api-key" $apiKey --project src/FigVam.AppHost
Remove-Variable apiKey
aspire run
```

Если клиент в PATH, параметр Executable можно опустить. User Secrets — локальное хранилище
разработчика, не защищённое хранилище production-секретов. Не добавляйте ключ в Git или командный файл.
Туннель не регистрируется без TunnelId. В Dashboard появится ресурс **mcp-tunnel** в состоянии
ожидания ручного запуска. Нажмите Start; Stop/Restart и логи доступны там же.
AppHost сам подставляет актуальный HTTP loopback endpoint FigVam с путём /mcp
(оба стандартных launch profile содержат HTTP endpoint); браузер может использовать HTTPS.
Это не отключает проверку TLS для внешнего соединения клиента с OpenAI.
При необходимости прямой доверенный MCP URL переопределяется параметром Mcp:PublicEndpoint в AppHost.
Не публикуйте HTTP endpoint или весь локальный сервер через публичный reverse proxy.

В ChatGPT один раз создайте приватный custom MCP plugin: Connection = Tunnel, выберите
FigVam, Authentication = No authentication, затем установите его. Служебный ключ добавляет сам
tunnel-client, а не ChatGPT; в плагине не надо вводить ни API key, ни ключ документа.
Статические схемы 34 инструментов доступны для регистрации ещё до разрешения документа.
Без разрешения каждый tools/call отклоняется с MCP_TUNNEL_ACCESS_REQUIRED.

В редакторе откройте нужный документ → **MCP-доступ → ChatGPT Tunnel → Разрешить доступ через ChatGPT**.
Теперь агент может читать и редактировать только этот документ от имени предоставившего доступ пользователя.
Прямые MCP-токены по-прежнему работают независимо. Чтобы переключиться на другой документ,
завершите текущую работу агента, отзовите доступ в прежнем документе и разрешите в новом.
Запускать новый клиент, менять его конфигурацию или регистрировать новый плагин не нужно.
Не используйте прежние команды агента после переключения: новые запросы относятся к новой явной привязке.

Единственная привязка хранится в памяти FigVam. Другой пользователь или документ не может
заменить её без отзыва. Отзыв, потеря прав, удаление документа и перезапуск FigVam аннулируют её.
Перезапуск AppHost создаёт новый 256-битный служебный ключ; перезапуск только tunnel-client
не меняет привязку. Остановка tunnel-client прекращает доставку запросов, но сама по себе
не отзывает разрешение: для этого используйте меню FigVam. UI показывает **разрешение на документ**,
а не проверенный статус соединения с OpenAI; состояние процесса смотрите в Dashboard.
Служебный ключ принимается только на локальном MCP transport в Development (Testing используется
только автоматизированными тестами); сам ключ не авторизует REST, не выдаёт разрешения
и не записывается в файлы документов. В Production этот режим не включается.
Доступ к туннелю в OpenAI должен оставаться приватным.

### Проверка локальной интеграции

1. Убедитесь, что без TunnelId AppHost запускается как раньше.
2. Настройте TunnelId и Runtime API key, запустите Aspire, проверьте, что tunnel-client не запущен автоматически.
3. Запустите ресурс вручную, проверьте логи подключения и наличие 34 tools при добавлении плагина.
4. До разрешения вызов get_document должен вернуть MCP_TUNNEL_ACCESS_REQUIRED.
5. Разрешите документ A, создайте экран через ChatGPT и проверьте изменения в редакторе.
6. Попробуйте разрешить B, пока A активен: переключение не должно произойти. Отзовите A, убедитесь,
   что следующий вызов отклонён, затем разрешите B. Без перезапуска клиента get_document возвращает B.
7. Перезапустите server: прежнее разрешение должно исчезнуть, а плагин после нового разрешения
   должен работать без повторной регистрации. При смене AppHost-портов клиент получает новый URL автоматически.
8. Stop и Restart у mcp-tunnel работают независимо от прямого MCP и основного сервера.

## Инструменты

Чтение: `get_document`, `list_pages`, `list_screens`, `get_screen`, `get_node`, `list_children`, `get_screen_tree`, `list_node_types`, `get_node_schema`, `list_token_types`, `get_token_schema`, `list_tokens`, `get_token_usages`, `list_scenarios`, `get_screen_layout`.

Редактирование: `create_page`, `rename_page`, `create_screen`, `rename_screen`, `resize_screen`, `duplicate_screen`, `create_node`, `rename_node`, `set_node_properties`, `remove_node_properties`, `move_node`, `delete_node`, `create_token`, `set_token_value`, `rename_token`, `delete_token`, `create_scenario`, `update_scenario`, `delete_scenario`, `save_version`.

Все инструменты доступны через tools/list со схемами и описаниями. documentId не передаётся. Для постраничного чтения используйте offset, limit (1–100), revision; дерево по умолчанию ограничено глубиной 3. Ответ содержит структурированные данные; ошибки содержат status REJECTED и code. Изменения возвращают commandId, revision и идентификаторы результата. Для повторной доставки используйте тот же commandId. Перед операциями с expectedRevision прочитайте актуальную ревизию. При конфликте обновите состояние, а не перезаписывайте данные вслепую.

Команды create_page, create_screen, create_node и duplicate_screen принимают необязательный параметр name. Имя — метаданные объекта, а не визуальное свойство. Если имя не передано или равно null, сохраняется прежнее поведение; имя проверяется по тем же правилам, что и при переименовании. Создание и именование выполняются одной атомарной операцией.

Свойства определяются профилем (get_node_schema). В описании каждого свойства поле inputSchema содержит JSON Schema именно для входного значения create_node / set_node_properties, включая канонические значения, возвращаемые get_node. Для составных значений схемы генерируются из тех же типизированных DTO, которые десериализует сервер. anyOf описывает альтернативные формы, например литерал цвета и ссылку на токен. Проверки существования и совместимости ссылок по-прежнему выполняются в контексте документа. В восьмизначных HEX-цветах альфа-канал находится в конце. Передавайте числа, строки, логические значения, цвета #RRGGBB или #RRGGBBAA, ссылки {"tokenId":"UUID"} и тени {"offsetX":0,"offsetY":12,"blurRadius":32,"spreadRadius":0,"color":"#0F172A29"}. Канонические формы чисел, строк, логических значений и enum: {"type":"number|string|boolean|enum","value":...} (используйте фактический type). Цвет: {"type":"color","red":37,"green":99,"blue":235,"alpha":255}; внутри тени цвет может быть HEX или RGBA с type=color или без него, у самой тени type=shadow необязателен. Ссылки принимаются с type=token, asset или style и соответствующим tokenId, assetId или styleId, либо без type. Свойства можно смешивать в одном запросе; весь объект properties из get_node можно передать без преобразований совместимому узлу. Ссылки не заменяются вычисленными значениями.

Начните с `list_token_types` и `get_token_schema` (параметр type). Ответ содержит valueSchema, example, category, сведения о темах и ссылках; для Dimension и Number выбирайте обязательную категорию и соответствующую схему valueSchemaByCategory. Схемы являются операциями чтения; проверка наличия ссылок и циклов выполняется по документу. Для create_token и set_token_value доступны компактные значения и выражения из list_tokens: {"expression":"alias","tokenId":"UUID"} и {"expression":"literal","value":{"type":"color","red":37,"green":99,"blue":235,"alpha":255}}. Типизированные значения литералов: color, spacing, geometry (поле radius), dimension, number, fontFamily, fontWeight, shadow, typography и typographyFields (атомарные выражения в полях типографики). Компактный create_token с типом Spacing без category сохраняет прежнее поведение (Dimension/Spacing); канонические выражения с типом Spacing сохраняют legacy-тип. Inline typography узла не является редактируемым типом текущего профиля; свойство typography принимает ссылку на токен. Создание и изменение самих стилей и загрузка ассетов не входят в MCP; существующие ссылки на них копируются. create_node и set_node_properties применяют свойства атомарно. move_node использует нулевой индекс и ожидаемого родителя. create_scenario и update_scenario принимают event и список actions, MVP поддерживает navigate со screenId. save_version создаёт именованную неизменяемую версию.

## Property validation errors

Для create_node, set_node_properties, create_token и set_token_value ошибки сохраняют существующие status, code, message, commandId и revision (если доступны). Дополнительные поля: property — путь во входном запросе, expected — ожидаемый тип, формат или ограничение, actual — фактический тип или краткое описание нарушения. Необязательные поля отсутствуют, если информация недоступна. StructuredContent и TextContent содержат одинаковую диагностику; IsError остаётся true. Возвращается первая ошибка, без частичного применения команды. Содержимое строковых значений не включается в диагностику.

| Некорректный ввод | property | expected | actual |
| --- | --- | --- | --- |
| fontSize: "large" | fontSize | Number (или ссылка на токен) | String |
| Тень без blurRadius | shadow.blurRadius | Number | Missing |
| backgroundColor: "blue" | backgroundColor | #RRGGBB or #RRGGBBAA | Invalid color format |
| inputType: "Email" | inputType | Text, Password | Unsupported enum value |

Для ссылок и сложных свойств путь содержит вложенное поле (например, backgroundColor.tokenId), для create_token — light или dark, для set_token_value — value. Допустимые формы и ограничения узлов доступны через get_node_schema; существование и совместимость ссылок проверяются доменной валидацией. Для синтаксически корректной ссылки ошибки различают отсутствующий и несовместимый ресурс; ограничения значений токенов проверяются доменом (например, диапазон opacity 0–1). Диагностика сохранённых отказов команд воспроизводится при повторе commandId.

## Примеры аргументов tools/call

| Инструмент | Аргументы (UUID — заполнитель) |
| --- | --- |
| get_document | {} |
| list_screens | {"pageId":"UUID","offset":0,"limit":20} |
| get_screen_tree | {"screenId":"UUID","depth":3} |
| create_screen | {"pageId":"UUID","width":800,"height":600,"name":"Login"} |
| create_node | {"parentId":"UUID","kind":"Frame","name":"Authentication card","properties":{"width":360,"height":400,"backgroundColor":"#FFFFFF"}} |
| create_token | {"name":"spacing.dialog","type":"Spacing","light":32,"dark":32} |
| set_node_properties | {"nodeId":"UUID","properties":{"paddingRight":{"tokenId":"UUID"},"shadow":{"offsetX":0,"offsetY":12,"blurRadius":32,"spreadRadius":0,"color":"#0F172A29"}}} |
| create_scenario | {"screenId":"UUID","nodeId":"UUID","event":"Click","actions":[{"type":"navigate","screenId":"UUID"}]} |

Для отзыва откройте меню MCP-доступ и нажмите кнопку с корзиной «Отозвать MCP-доступ». Подтверждённый отзыв делает прежний токен недействительным. MVP не предоставляет управление документами, произвольные команды, массовые операции, импорт изображений и OAuth discovery.

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


## Автономный рендеринг экрана

`render_screen` — read-only MCP-инструмент. Обязателен `screenId` (GUID), необязательны `theme` (Light или Dark) и `revision` (текущая ревизия). При отсутствии темы используется выбранная тема Preview, если Preview открыт, иначе Light (тема Design). Например:

```json
{"screenId":"UUID","theme":"Dark"}
```

Предоставьте прямой MCP-доступ или доступ ChatGPT Tunnel в меню основного редактора. Никакого дополнительного разрешения браузера не требуется. Открытый редактор автоматически подключает изолированный рендерер, независимый от выбранной страницы, экрана, Preview и масштаба. Вызов не меняет состояние редактора, историю или документ. Токен ограничен документом; отзыв прекращает в том числе рендеринг.

Используется общий DOM-рендерер Preview с актуальными ресурсами указанной ревизии. Отдельный невидимый DOM-контейнер растеризуется в PNG размером 1:1 (дробные размеры округляются вверх до пикселя). MCP возвращает Image Content (`image/png`) и structured/text метаданные: screenId, theme, revision, width, height. Изображения не сохраняются. Браузерная вкладка редактора должна оставаться открытой; закрытие редактора не отзывает доступ, но без подключённого рендерера возвращается RENDER_UNAVAILABLE. Поддерживаемый браузер — Chromium. Ограничения: 10 с, до 5 MiB PNG, до 4096 px по каждой оси и 4 Mi пикселей.

Коды ошибок: SCREEN_NOT_FOUND, INVALID_THEME, ACCESS_DENIED (отзыв в процессе операции; отозванный токен при новом запросе отклоняется транспортом), RENDER_UNAVAILABLE, RENDER_FAILED, RENDER_TIMEOUT, RENDER_REVISION_MISMATCH, IMAGE_TOO_LARGE. При отсутствии актуальных ресурсов старое изображение не возвращается.

Адресный SSE передаёт только запросы рендеринга. Ответ с PNG привязан к запросу, документу, пользователю, сессии, ревизии, теме и размерам. Не используются захват вкладки, экрана или рабочего стола и дополнительные сервисы.


### Инспекция и симуляция (P2)

- `get_screen_tree`: `includeProperties: true` добавляет исходные свойства всех элементов страницы результата; по умолчанию ответ остаётся прежним. Сохраняются глубина, offset/limit и ревизия.
- `get_node` и `get_screen_tree`: `includeResolvedProperties: true, theme: "Dark"` добавляют отдельные resolvedProperties с эффективными значениями и defaults. Light используется по умолчанию. Параметры дерева независимы. Исходные ссылки на токены и стили не заменяются. Ошибки разрешения возвращаются в resolutionDiagnostics.
- `get_node_schema`: `compact: true` возвращает метаданные профиля, общие форматы сложных значений и правила формирования запроса. По умолчанию сохраняются полные inputSchema.
- `get_token_schema`: новый тип Shadow без категории, значения Light/Dark включают offsetX, offsetY, blurRadius, spreadRadius, color. Создавайте через create_token, привязывайте свойство shadow объектом {"tokenId":"UUID"}, изменяйте через set_token_value.
- `simulate_preview`: передайте screenId, theme и events, например {"screenId":"UUID","theme":"Dark","events":[{"nodeId":"UUID","event":"Change","value":"demo"},{"nodeId":"UUID","event":"Submit"}],"includeImage":true}. Возвращаются initialScreenId, activeScreenId, theme, steps с scenarioIds/executedActions, demoValues и diagnostics. Пароли не возвращаются в текстовой трассе. Каждый вызов независим; операции чтения и симуляции не изменяют документ или редактор.
- Для автономной визуализации установите Chromium/Chrome на сервере и задайте `Mcp__ChromiumExecutable` абсолютным путём к исполняемому файлу. При отсутствии Chromium симуляция без includeImage доступна, запрос изображения возвращает RENDER_UNAVAILABLE. Снимок использует общий с render_screen рендерер в изолированном процессе; пока стек оверлеев не поддерживается для изображения и возвращает диагностику.

### Управление токенами и тематический layout

- `rename_token`: tokenId, name, необязательные expectedRevision и commandId. Ссылки сохраняются по ID.
- `delete_token`: tokenId, обязательный expectedRevision, необязательный commandId. Используемый токен отклоняется с TOKEN_IN_USE; ответ содержит до 20 зависимостей из ревизии отказа и referenceCount.
- `get_token_usages`: tokenId, необязательные revision, offset (0), limit (50, максимум 100). Возвращает прямые и косвенные зависимости обеих тем.
- `get_screen_layout`: необязательный theme (Light по умолчанию, Dark); ответ содержит theme. Недопустимое значение — INVALID_THEME.
- `simulate_preview`: simulationStatus отражает результат событий независимо от render.status (NotRequested, Completed, Failed, Skipped). При ошибке рендеринга общий status остаётся Rejected, а isError — true. При запуске через Aspire настройку Mcp:ChromiumExecutable можно задать в конфигурации AppHost; при прямом запуске — в конфигурации сервера. Укажите абсолютный путь к установленному Chromium.

`get_token_schema(type, compact: true)` использует общие форматы compactAlias, canonicalAlias и canonicalLiteral. literalSchema (либо literalSchemaByCategory) задаёт ограничения непосредственного значения; canonicalTag и payloadField определяют каноническую оболочку скалярного значения. Для Color/Shadow имеется canonicalValueSchema, а для Typography — ограничения плоского литерала и типы, категории, ограничения и обязательность вложенных полей typographyFields. Полная JSON-схема по-прежнему доступна без compact.

Для TextInput доступны paddingTop/paddingRight/paddingBottom/paddingLeft (Dimension/Spacing), placeholderColor и focusBorderColor (Color), focusBorderWidth (Dimension/BorderWidth), в том числе ссылки на токены. lineHeight доступен Text, TextInput и Button. Без явной настройки фокуса и placeholder сохраняется штатное оформление; фокус не записывается в документ.
