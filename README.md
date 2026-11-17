# FigVam

Серверная основа FigVam, доменная модель и внутренние команды с транзакционным журналом. HTTP API предоставляет создание документа, управление его участниками и доступные типизированные команды. Редактор и полный API дизайна ещё не реализованы.

## Требования

.NET SDK 10.0.204 или более поздний патч в той же SDK feature band и доступ к NuGet для восстановления зависимостей. Для локальной оркестрации используется Aspire AppHost; Aspire Dashboard запускается вместе с ним.

## Сборка и проверка

```sh
dotnet restore FigVam.sln --locked-mode
dotnet build FigVam.sln --no-restore
dotnet test FigVam.sln --no-build --no-restore
```

Тест запускает сервер отдельным процессом в окружении Production и проверяет оба health endpoint.

Классы тестов, запускающие дочерние процессы, входят в общую xUnit-коллекцию `ProcessTestCollection`: холодные старты HTTP-серверов и вложенных crash-writer runner выполняются последовательно, остальные классы сохраняют параллельное выполнение. Это изолирует функциональные проверки с короткими тайм-аутами от конкурирующих стартов процессов; нагрузочное тестирование требует отдельного воспроизводимого сценария. При ошибке запуска или HTTP-запроса тестовый host выводит PID, адрес, время работы, состояние выхода и захваченные stdout/stderr сервера.

Командные тесты проверяют авторизацию, конкурентную запись, идемпотентность, независимость документов и восстановление после принудительного завершения отдельного процесса.

## Внутренние команды и хранение

`IDocumentCommandHandler` принимает типизированные команды и актор, полученный серверным транспортом из проверенной аутентификации. Перед каждым обращением к журналу вызывается `IDocumentAuthorization`. Роли документа хранятся транзакционно; HTTP API использует тот же `IDocumentAccessService`.

`IDocumentReconnectReader` проверяет право чтения при каждом запросе и возвращает подтверждённые события после `lastSeenRevision` по порядку ревизий. Каждое событие содержит documentId, revision, commandId, actorId, тип и типизированную полезную нагрузку. Если нужная последовательность событий недоступна, возвращается актуальный снимок; оба варианта читаются в одной согласованной SQLite-транзакции. Отрицательная ревизия или ревизия из будущего отклоняется. HTTP: `GET /api/v1/documents/{documentId}/reconnect?lastSeenRevision=N`; ответ `ReconnectResponse` содержит `EVENTS` либо `SNAPSHOT`. Более 100 событий или 1 MiB полезной нагрузки также переключают ответ на снимок. Политика удаления истории пока не реализована.

## Подписка на подтверждённые изменения v1

`GET /api/v1/documents/{documentId}/events?lastSeenRevision=N` с заголовком `Authorization: Bearer <token>` возвращает `text/event-stream` (SSE). Необходимо ровно одно поле query `lastSeenRevision`; токены в URL и `Last-Event-ID` не используются. Браузерный клиент может читать поток через `fetch` с bearer-заголовком. OpenAPI описывает endpoint; схема `DocumentSubscriptionMessage` опубликована в `/api/v1/schemas/DocumentSubscriptionMessage.json`.

Каждый SSE frame содержит `event: CODE`, `data: <JSON>` и пустую завершающую строку. JSON имеет `code`, `revision`, `change` (событие журнала либо null). Коды:

| Код | Значение |
| --- | --- |
| `READY` | Поток открыт от запрошенного курсора; это не подтверждение актуального состояния |
| `CHANGE` | Подтверждённое изменение; `change` содержит documentId, revision, commandId, actorId, type, payload; SSE `id` равен revision |
| `HEARTBEAT` | Проверка живости примерно раз в 10 секунд; не меняет состояние клиента |
| `RECONNECT_REQUIRED` | История не помещается в ограниченный ответ либо имеет пропуск; поток закрывается |
| `FORBIDDEN` | Право чтения отозвано; поток закрывается без дальнейших данных документа |

Только `CHANGE` продвигает курсор клиента. Клиент применяет последовательность `lastSeenRevision + 1`, обнаруживает пропуск и при `RECONNECT_REQUIRED`, EOF или сетевой ошибке вызывает reconnect с последней **применённой** ревизией. После применения событий или снимка он подписывается с полученной ревизии. Изменения между reconnect и подключением читаются из журнала; повторно полученные ревизии клиент игнорирует. Поток не является ACK команды и не гарантирует однократную сетевую доставку.

Каждая подписка опрашивает общий транзакционный журнал раз в 100 ms, без процессной очереди событий. Поэтому commit другого серверного процесса виден при той же обязательной конфигурации общего локального каталога. Права проверяются на каждом опросе и непосредственно перед выдачей каждого изменения; уже отправленные байты отозвать невозможно. Долгоживущий поток закрывается не позднее срока bearer-токена либо через час; клиент повторяет аутентификацию при восстановлении.

Ресурсы ограничены 5 подписками на актора и 128 на процесс (HTTP 429 сверх лимита), одной ограниченной порцией журнала на подписку, без накопления очереди. Запись/flush имеет deadline 5 секунд; медленное или отключённое соединение отменяется и освобождает разрешение. Если клиент отстал за пределы порции журнала, он получает `RECONNECT_REQUIRED`. Reverse proxy должен отключать буферизацию SSE. Эти ограничения не являются обещанием задержки доставки под нагрузкой. До начала потока действуют обычные HTTP ошибки: 400 для неправильной ревизии, 401 для отсутствующей аутентификации, 403 для отсутствия чтения, 429 для лимитов. Meter `FigVam.DocumentSubscriptions` публикует число активных подписок и отставание в ревизиях без document/actor labels и полезной нагрузки.

`SqliteDocumentJournal` хранит отдельную SQLite-базу на документ. Транзакция `BEGIN IMMEDIATE` сериализует запись между экземплярами сервера; разные документы используют независимые блокировки. Результат команды, событие и периодический неизменяемый снимок (каждые 32 ревизии) фиксируются одной транзакцией с `synchronous=FULL` до возврата результата. После перезапуска снимок и последующие события восстанавливают модель; результаты повторных commandId сохраняются. Снимки восстановления не являются именованными пользовательскими версиями.

Все серверные экземпляры **обязаны использовать один и тот же абсолютный каталог на локальном диске одного хоста**. Разные каталоги для одного набора документов и файловые сетевые шары не поддерживаются. Несколько хостов потребуют общего транзакционного хранилища перед развёртыванием. `Storage:Directory` (`Storage__Directory` в окружении) задаёт durable каталог. Headless Production должен задавать абсолютный путь явно. Относительный путь разрешается относительно content root сервера; appsettings использует `data/documents`. Aspire передаёт абсолютный путь `src/FigVam.Server/data/documents`; переопределить его можно через `Storage:Directory` AppHost. Каталог не очищается при остановке сервера. `InitializeAsync` остаётся внутренней точкой начального импорта.

Production journal использует `UnverifiedNodeProfile`: виды узлов, контейнерные возможности и свойства пока не разрешены. Исследовательские результаты не означают подтверждённую поддержку профиля. Создание пустого документа доступно; полный профиль и полный API пока не готовы.

## Локальный запуск

```sh
dotnet run --project src/FigVam.AppHost
```

Адрес и ссылка входа в Aspire Dashboard выводятся в консоль. AppHost запускает один серверный процесс.

## Headless для CI

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:Authentication__LocalDevelopment__Enabled = 'true'
$env:Authentication__LocalDevelopment__Token = 'figvam-local-development-bearer-token'
$env:Storage__Directory = 'C:\figvam-data\documents'
dotnet run --project src/FigVam.Server --no-launch-profile --urls http://127.0.0.1:8080
```

`GET /alive` проверяет доступность процесса; `GET /health` проверяет готовность сервера. Пока внешних зависимостей нет, готовность означает успешный запуск процесса. При добавлении обязательных зависимостей их проверки должны входить в readiness. Ответ при исправном состоянии — HTTP 200 и `Healthy`.

Сервер пишет структурированные JSON-логи. Метрики ASP.NET Core и runtime и трассировки ASP.NET Core передаются по OTLP при заданном `OTEL_EXPORTER_OTLP_ENDPOINT`; Aspire настраивает этот адрес при локальном запуске. Тела запросов и содержимое документов не регистрируются. При независимом запуске без OTLP endpoint внешний экспорт отключён.

## Аутентификация сервера

По умолчанию сервер требует подписанный JWT bearer-токен. Перед запуском Production настройте параметры доверия (переменные окружения либо одноимённые ключи конфигурации с `:` вместо `__`):

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Production'
$env:Authentication__LocalDevelopment__Enabled = 'false'
$env:Authentication__Issuer = 'https://identity.example.com/'
$env:Authentication__Audience = 'figvam'
$env:Authentication__SigningPublicKeyPem = Get-Content -Raw 'C:\config\identity-public.pem'
$env:Storage__Directory = 'C:\figvam-data\documents'
dotnet run --project src/FigVam.Server --no-launch-profile --urls http://127.0.0.1:8080
```

`Issuer` должен точно совпадать с `iss` токена и быть HTTPS URI. `Audience` проверяет `aud`. PEM содержит только открытый RSA-ключ (не менее 2048 бит); сервер принимает RS256, проверяет подпись, срок действия (обязательный `exp`, допустимое расхождение часов 30 секунд) и единственный непустой `sub`. Ключ закреплён в конфигурации; при смене ключа identity provider нужно обновить PEM и перезапустить сервер. Автоматическое обнаружение ключей не используется. Production публикуйте через HTTPS; при TLS termination этот loopback HTTP listener доступен только доверенному reverse proxy. Неполная/небезопасная конфигурация останавливает сервер с ненулевым exit code до открытия listener.

Клиент передаёт `Authorization: Bearer <access-token>`. `GET /api/identity` возвращает `{ "id": "<sub>" }`; HTTP-операции и подписки могут получать `DocumentActor` через `ClaimsPrincipal.GetDocumentActor()`. Идентичность не берётся из payload, query string, cookie или клиентского actor-заголовка. Новые endpoints по умолчанию требуют аутентификацию; только `/alive` и `/health` явно анонимны. Права на документ проверяются отдельно прикладными сервисами. Cookie-аутентификация не включена, браузер не отправляет bearer-токен автоматически, поэтому cookie-зависимая CSRF-схема здесь не нужна.

Для работы без внешнего identity provider локальный режим нужно явно включить через `Authentication:LocalDevelopment:Enabled=true` в окружении `Development` и задать `Authentication:LocalDevelopment:Token` (минимум 32 UTF-8 байта). Он разрешает только явно заданные loopback URL (`localhost`, `127.0.0.1`, `::1`), отвергает `Kestrel:Endpoints` и принудительно создаёт только loopback-сокеты. Wildcard/external URL и Production с локальным режимом завершают запуск ошибкой. Не публикуйте локальный режим через reverse proxy или туннель. Локальный bearer-токен даёт фиксированного актора `local-developer`; произвольный клиентский actorId не принимается.

Server launch profiles, используемые `dotnet run` и Aspire, явно включают этот локальный режим с общеизвестным токеном `figvam-local-development-bearer-token`; эти настройки не входят в опубликованный appsettings. В headless CI режим и токен задаются явно, как в примере выше, либо используется Production с тестовым RSA-ключом. Интеграционные тесты создают свой ключ и подписанные токены, проверяют 401 для недействительных идентичностей, отказы конфигурации и запуск headless Production.

## HTTP API доступа к документам v1

Все операции требуют bearer-токен и не зависят от браузера или UI-сессии. Идентификатор актора определяется только проверенным `sub`; поля вне опубликованных DTO отклоняются. Тела запросов ограничены 16 KiB, `memberId` — 256 символами; лимит запросов — 120 в минуту на аутентифицированного актора (до аутентификации — по IP).

| Операция | JSON запроса | Ответ |
| --- | --- | --- |
| `POST /api/v1/documents` | `{ "documentId": "<uuid>" }` | 201; пустой документ, создатель — Owner |
| `PUT /api/v1/documents/{documentId}/members` | `{ "memberId": "<sub>", "role": "Editor" }` | 200; назначение или замена роли |
| `DELETE /api/v1/documents/{documentId}/members/{memberId}` | нет | 200; удаление членства |

Роли: `Owner`, `Editor`, `Viewer` (с учётом регистра). Только Owner назначает и удаляет участников. Последнего Owner нельзя удалить или понизить. Удаление отсутствующего участника разрешено Owner. Членство и ревизия модели независимы: эти операции не меняют revision черновика.

Успех: `{ "code": "ACCEPTED", "documentId": "<uuid>" }`. Ошибка имеет поля `type`, `title`, `status`, `code`, `detail`; детали хранилища не возвращаются. Коды: 400 `INVALID_REQUEST`, `INVALID_ID`, `INVALID_MEMBER`, `INVALID_ROLE`; 401 `UNAUTHENTICATED`; 403 `FORBIDDEN` (также для неизвестного документа при изменении участников); 409 `DOCUMENT_EXISTS`, `LAST_OWNER`; 413 `REQUEST_TOO_LARGE`; 415 `UNSUPPORTED_MEDIA_TYPE`; 429 `RATE_LIMITED`; 500 `INTERNAL_ERROR`. Неизвестный API-ресурс даёт 404 `NOT_FOUND`, неподходящий HTTP-метод — 405 `METHOD_NOT_ALLOWED`.

OpenAPI опубликован в `GET /openapi/v1.json`. JSON Schemas DTO генерируются из тех же публичных типов и атрибутов и доступны через `GET /api/v1/schemas/{name}.json`: `CreateDocumentRequest`, `SetDocumentMemberRequest`, `DocumentAccessResponse`, `ApiError`. Эти endpoints также требуют bearer-токен. Схема полного `.figvam` и остальные операции ещё не опубликованы. Контрактные тесты проверяют схемы независимым JSON Schema валидатором, реальные HTTP-ответы, ошибки, права и сохранение членства после перезапуска серверного процесса.


## HTTP API команд v1

`POST /api/v1/documents/{documentId}/commands/{operation}` принимает типизированный JSON с обязательным `commandId`. Операции: `add-page` (`pageId`), `add-screen` (`pageId`, `screenId`), `add-node` (`parentId`, `nodeId`, `kind`), `delete-node` (`nodeId`), `move-node` (`nodeId`, `expectedParentId`, `targetParentId`, `position`), `set-node-property` (`nodeId`, `property`, `value`), `save` (необязательное `name`), `restore` (`versionId`), `undo` и `redo`. Значение свойства задаётся объектом с дискриминатором `type`: `string`, `number`, `boolean`, `asset`, `token` или `enum`; его поля опубликованы в схеме `SetNodePropertyRequest`. Неподтверждённый профиль пока не разрешает узлы и их свойства.

Успешный ответ содержит `status: "ACCEPTED"`, `documentId`, `commandId`, `revision`, относящиеся к операции ID и `affectedIds`. Повтор `commandId` возвращает первоначальный результат. Отказ имеет стандартные поля `ApiError`, а для свойства также `nodeId` и `property`; его код и объяснение описаны в OpenAPI. Роли проверяются обработчиком для каждой операции. DTO-схемы опубликованы под именами соответствующих типов запросов и `CommandResponse`.

Structural read queries are available at `/api/v1/documents/{documentId}` and its `pages`, `screens`, `nodes`, and `children/{parentId}` routes. Individual pages, screens, and nodes can be addressed by ID. Results identify the committed revision. Lists use `offset` and `limit` (1–100, default 50); `nodes` accepts `screenId` and `kind`, and `children` accepts `kind`. `fields` selects a comma-separated subset of `kind`, `properties`, and `childCount`; ID and type are always included. `depth` expands children from 0 to 2 levels, with at most 100 total items per response. `childrenTruncated` indicates an incomplete expansion; query children separately to paginate them. Name and semantic-key filters are not available until those fields exist in the document model. JSON Schemas are served under `/api/v1/schemas/` and OpenAPI at `/openapi/v1.json`.


`add-token` accepts `commandId`, `tokenId`, `name`, numeric `type` (0 Color, 1 Spacing, 2 Typography, 3 Geometry), and `values` with `Light`/`Dark` keys. A theme expression is `{ "expression": "literal", "value": { "type": "spacing", "value": 8 } }` or `{ "expression": "alias", "tokenId": "<uuid>" }`. Literal types: `color` (red, green, blue, alpha), `spacing` (value), `typography` (fontFamily, fontSize, fontWeight, lineHeight), `geometry` (radius). Tokens are part of document snapshots, saved versions and safe Undo/Redo; `affectedIds` includes the token ID. Invalid names, types, themes, references or cycles return `INVALID_TOKEN` (400); occupied IDs return `DUPLICATE_ID` (409). Published schemas: `AddTokenRequest` and `DocumentStructure`.

Component instances: `POST /api/v1/documents/{documentId}/commands/insert-component-instance`
accepts `commandId`, a unique `nodeId`, an existing `definitionId`, `parentId` (screen or
container node), and zero-based `position` in its child list. The server determines
the actor and creates the anchor using the definition root's profile-validated kind.
Insertion adds the anchor and binding atomically with default parameters and no variant
or slot content. Instances participate in recovery, reconnect, saved versions and guarded
per-user Undo/Redo. Removing an instance subtree removes its bindings; removing definition
roots or moving instances to create component dependency cycles is rejected.
The DTO and document schemas are available as `InsertComponentInstanceRequest.json`,
`ComponentInstance.json` and `DocumentStructure.json` under `/api/v1/schemas/`.
Failures include `COMPONENT_NOT_FOUND`, `DUPLICATE_ID`, `INVALID_POSITION`,
`PARENT_NOT_FOUND`, `INVALID_PARENT_TYPE`, `CHILDREN_NOT_ALLOWED`,
`CYCLE_NOT_ALLOWED`, `INVALID_COMPONENT` and `FORBIDDEN`, using the common API error contract.

Component variants: `add-component-variant` accepts `commandId`, `definitionId`,
`variantId`, `name`, numeric `kind` (0 Default, 1 Hover, 2 Disabled, 3 Selected,
4 Custom), optional `baseVariantId`, and `parameterChanges`, a UUID-keyed map of
component values (`valueType`: text, asset, bool, number, token, enum). Changes
are deltas over the base variant and parameter defaults. Built-in kinds are
unique within a definition; Custom variants have descriptive names.
`set-component-instance-variant` accepts `commandId`, `nodeId`, and `variantId`;
explicit `null` clears the selection. Explicit instance parameter overrides take
priority over the selected variant and its base chain. IDs and references must
belong to the document and definition; invalid values, bases, cycles, or selections
return `INVALID_COMPONENT` (400), reused IDs return `DUPLICATE_ID` (409), missing
definitions/nodes return `COMPONENT_NOT_FOUND`/`NODE_NOT_FOUND` (404), and a node
without an instance binding returns `NOT_COMPONENT_INSTANCE` (409). Authorization,
command deduplication, durable recovery, saved versions and guarded Undo/Redo use
the shared command pipeline. DTO schemas are `AddComponentVariantRequest` and
`SetComponentInstanceVariantRequest` under `/api/v1/schemas/`.


## Local JSON datasets

`POST /api/v1/documents/{documentId}/commands/add-dataset` accepts `commandId`,
a unique `datasetId`, `name`, and `fixtureJson` (a string containing the JSON value).
`replace-dataset-fixture` accepts `commandId`, `datasetId`, `expectedRevision`, and
`fixtureJson`. The revision must match the document; replacement preserves the dataset
ID and name. Owner and Editor can write; Viewer can read. Command retries, journal
recovery, saved versions, events and guarded Undo/Redo use the shared document pipeline.

Each fixture is limited to 65536 UTF-8 bytes and 32 levels of JSON nesting. Object keys
must be unique. Names are nonblank, at most 256 characters without control characters;
duplicate names are allowed. A document permits at most 1000 datasets and 8 MiB of
fixture JSON in total. These two command endpoints permit 512 KiB request bodies to
accommodate JSON string escaping; the general 16 KiB request limit still applies elsewhere.
Invalid data and stale revisions leave document contents and revision unchanged.

`GET /api/v1/documents/{documentId}/datasets` returns metadata with `offset` and `limit`
(1-100, default 50). `GET .../datasets/{datasetId}` returns one dataset's metadata;
`GET .../datasets/{datasetId}/fixture` explicitly reads its saved `fixtureJson` string.
All three accept optional `revision` and return the revision read. Metadata omits fixture
contents. The saved JSON works offline and is stored with the document; these operations
do not fetch remote data. Request bodies and fixtures are not logged. Revision diffs
report changed dataset property names without returning their values.

OpenAPI describes these routes and errors. JSON Schemas are published as
`AddDatasetRequest`, `ReplaceDatasetFixtureRequest`, `AddCsvDatasetRequest`,
`ReplaceDatasetFixtureFromCsvRequest`, `DocumentDataset`, `DatasetSummary`,
`DatasetListResponse`, `DatasetResponse`, `DatasetFixtureResponse` and `DocumentStructure`.

### CSV snapshot import

`add-csv-dataset` accepts `commandId`, `datasetId`, `name`, and `csv`;
`replace-dataset-fixture-from-csv` accepts `commandId`, `datasetId`,
`expectedRevision`, and `csv`. Both use the same authorization, revision,
history, audit and storage rules as the JSON commands. The input string is at
most 65,536 UTF-8 bytes, as is the resulting JSON fixture; the request body is
at most 512 KiB. Document-wide fixture limits also apply.

CSV uses commas and a mandatory header record with nonblank, case-sensitive,
unique names. Each subsequent record has exactly the same number of fields.
Records end in LF or CRLF, including the optional final record terminator;
a lone CR and a BOM are rejected. Fields may be quoted with double quotes;
inside quotes a doubled quote represents one quote, and commas and LF or CRLF
are preserved. A quote must enclose the entire field, with no characters after
the closing quote except a delimiter or record end. Other control characters
are rejected except tabs. Spaces are preserved, including in headers and values.
An empty field becomes an empty string, not null. Every value remains a string;
there is no number, boolean, date, or formula interpretation. Header-only CSV
produces `[]`. Each data record becomes a JSON object in an array, with the
header names as keys. Invalid or oversized CSV returns `INVALID_CSV_FIXTURE`
without changing the document; error details never include imported content.

Scalar local data bindings are stored on each node under `dataBindings`, keyed
by the target property. `bind-node-data` accepts `commandId`, `nodeId`,
`property`, and `binding: { datasetId, binding: { path, operation, expectedType } }`.
A path contains `{ type: "property", name: "rows" }` and
`{ type: "index", index: 0 }` segments, at most 32; property names are at most
256 characters and indices are nonnegative. Operations are Value=0, Count=1,
IsEmpty=2, IsPresent=3, IsNull=4. Expected types are Any=0, String=1, Number=2,
Boolean=3, Object=4, Array=5. Value bindings require String, Number or Boolean
matching the profile property. Count produces Number; the three predicates
produce Boolean. The current saved fixture must evaluate successfully and
satisfy profile value constraints when binding. No profile support is added by
these commands. A property already bound to a component parameter cannot also
have a data binding.

`unbind-node-data` accepts `commandId`, `nodeId` and `property`. Binding and
unbinding preserve the stored literal property value. Fixture replacement
preserves bindings; missing or incompatible values are reported by the
revision-aware diagnostics API with node, property, dataset and reason.
Structural queries can select `dataBindings` in `fields`, and revision diffs
identify changes as `dataBindings.<property>`. `delete-dataset` accepts
`commandId`, `datasetId`, and `expectedRevision`, rejecting `DATASET_IN_USE`
until all referencing properties are unbound or their nodes removed. Guarded
undo also rejects restoration that would introduce dangling dataset references.


Local repeaters are stored as `repeater` on a container node.
`set-node-repeater` accepts `commandId`, `nodeId`, `expectedRevision` and
`repeater` (null clears the configuration while preserving child nodes).
A configuration has `datasetId`, `items` (a Value binding with Array expected
type), `templateNodeId`, `emptyViewNodeId` and `bindings`. Each item binding
contains `nodeId`, `property` and a typed `binding` evaluated relative to that
array item. For example, a path `[ { "type": "property", "name": "name" } ]`
reads each item's name, relative to the item root. Template and empty view
are distinct, exclusively owned direct children of the container; item
bindings target distinct scalar properties within the template subtree.
Templates and empty views can contain component instances. Resolution preserves
variants, parameter overrides, nested instances and supplied slot content.
Definitions live outside repeater subtrees. Nested repeaters are rejected,
including those reached through components. The production profile is unchanged.

Initial configuration validates the current fixture, including all item
fields and profile property constraints. Evaluation allows at most 1000 items
and 100 bindings. One 10000-unit budget includes the array path, every
expanded template node and every relative path operation; empty lists charge
the empty view subtree. Excess work returns `DATA_REPEATER_LIMIT` before
building item results. Missing fields and incompatible values return
`DATA_MISSING_VALUE` and `DATA_INCOMPATIBLE_TYPE`. Fixture replacement preserves
configuration and exposes resulting errors through revision-aware diagnostics.

`GET /api/v1/documents/{documentId}/nodes/{nodeId}/repeater` evaluates only the
saved local fixture at optional `revision`, with `offset` and `limit` (1–100,
default 50). Results contain ordered item property values keyed by template
node ID and property; zero items return `emptyViewNodeId`. A diagnostic returns
no partial item values. This query uses saved data and preserves the document.
`templateNodes` (nonempty lists) or `emptyViewNodes` (empty lists) supplies the
resolved tree once. Its `id` and `childIds` are local occurrence indexes;
`sourceNodeId` identifies the original node, and `instancePath` identifies its
component context. `bindingNodeId` on a resolved instance root identifies its
structural anchor. Apply each item's property values to its structural node
(`bindingNodeId` for instance roots, otherwise `sourceNodeId`). This keeps
repeated definitions distinct without allocating or persisting new document IDs.
Structural queries can select `repeater`; revision diffs identify its changes
as `repeater`. Dataset deletion and structural mutations reject operations
that leave repeater references dangling. Clearing or deleting the whole
repeater releases its references; guarded history cannot restore them when
their targets are no longer available.

## Design token export

`GET /api/v1/documents/{documentId}/token-export?theme=Light&revision=...` exports a single revision and requires an Owner or Editor; Viewer export is disabled until a viewer export policy exists. The required theme is `Light` or `Dark`; omit revision for the current revision. The response contains the revision, selected theme, a `tokens` object, and diagnostics. A null `tokens` object means no partial export was produced. Exports are limited to 1000 tokens and 1 MiB of token JSON.

The mapping follows the [DTCG Design Tokens Format Module 2025.10](https://www.designtokens.org/TR/2025.10/format/): color uses sRGB components and alpha; spacing and radius use `dimension` in CSS pixels; aliases use curly-brace references. Names are preserved exactly, so duplicate names or names beginning with `$` or containing `.`, `{`, or `}` are rejected. Typography is rejected because DTCG requires letter spacing, which the document model does not provide, and the model does not define whether line height is a multiplier or a length; inventing that meaning would change the value. Invalid references, cycles, types and missing selected-theme values are reported. The export does not encode the other theme.


## Design token import

`POST /api/v1/documents/{documentId}/commands/import-design-tokens` uses the common authorized command handler (Owner/Editor). Supply `commandId`, `expectedRevision`, `lightJson`, `darkJson`, and `dimensionTypes`. Each JSON string is a flat DTCG 2025.10 token object, such as the `tokens` object from token export. `lightJson` explicitly maps to Light and `darkJson` to Dark; supplying the same JSON twice explicitly selects equal theme values. Every token must occur in both inputs with the same type. No theme values are inferred.

`dimensionTypes` maps every imported dimension name to the FigVam enum: `1` (Spacing) or `3` (Geometry/radius). Color needs no mapping. For example:

```json
{
  "commandId": "7f436282-5a22-49ab-a7c7-e8af02ae2739",
  "expectedRevision": 0,
  "lightJson": "{\"gap\":{\"$type\":\"dimension\",\"$value\":{\"value\":8,\"unit\":\"px\"}}}",
  "darkJson": "{\"gap\":{\"$type\":\"dimension\",\"$value\":{\"value\":12,\"unit\":\"px\"}}}",
  "dimensionTypes": { "gap": 1 }
}
```

Import adds fresh technical token IDs, preserves names and whole-token `{name}` aliases within the import, and rejects existing name conflicts. Color supports sRGB channels and optional alpha exactly representable as 8-bit values; dimension supports finite CSS pixels (radius must be nonnegative). Groups, inheritance, metadata/extensions, JSON Pointer and component references, other color representations/units/types, and typography are explicitly rejected. This is a compatible subset, not a general DTCG importer.

Limits: 1000 tokens in the resulting document, 1000 dimension mappings, JSON depth 8, 1,048,576 characters per input and 2 MiB UTF-8 combined, a 4 MiB HTTP body, and at most 100 diagnostics. A rejected import returns HTTP 400 `INVALID_TOKEN_IMPORT` with `diagnostics` entries (`code`, `path`, `message`); malformed transport DTOs return `INVALID_REQUEST`. Name/type conflicts, missing themes or references, cycles and unsupported content never partially modify the document or increment revision. Revision conflicts return HTTP 409. Accepted imports commit one revision and `IMPORT_DESIGN_TOKENS` event, return affected IDs, survive recovery and support guarded Undo/Redo. Repeating `commandId` returns the original result after checking current rights. Schemas are published as `ImportDesignTokensRequest.json`, `TokenImportDiagnostic.json`, `ApiError.json` and `CommandResponse.json` under `/api/v1/schemas/`; OpenAPI describes the route.


Screen variants are stored separately from component variants on each screen. The typed
commands `add-screen-variant`, `set-screen-variant-override` and
`remove-screen-variant-override` save property differences by stable variant and node IDs.
`GET /api/v1/documents/{documentId}/screens/{screenId}/variants` supports `revision`,
`variantId`, `offset` and `limit` (1–100). Missing overrides inherit base properties.
Variants are limited to 1000 per screen and 10000 overrides each. Existing profile
property rules and token reference types apply; this does not expand profile support.
Remove affected overrides before deleting a node or moving its subtree to another screen.
