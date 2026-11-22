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

`GET /api/v1/documents/{documentId}/events?lastSeenRevision=N` с авторизацией браузерной cookie либо заголовком `Authorization: Bearer <token>` возвращает `text/event-stream` (SSE). Необходимо ровно одно поле query `lastSeenRevision`; токены в URL и `Last-Event-ID` не используются. Браузерный клиент читает поток через `fetch` с `credentials: same-origin` в Google-режиме. OpenAPI описывает endpoint; схема `DocumentSubscriptionMessage` опубликована в `/api/v1/schemas/DocumentSubscriptionMessage.json`.

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

Новые документы используют профиль `figvam.portable-ui` версии 2 с типами Frame, Text, Button, TextInput и Image. Документы версии 1 открываются со своим профилем. Для перехода к визуальному редактированию доступна команда `upgrade-portable-ui-profile`, которая проверяет ожидаемую ревизию и соответствие документа версии 2.

## Локальный запуск

```sh
dotnet run --project src/FigVam.AppHost
```

Адрес и ссылка входа в Aspire Dashboard выводятся в консоль. AppHost запускает один серверный процесс.

## Headless для CI

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:Authentication__Mode = 'Local'
$env:Authentication__LocalDevelopment__Enabled = 'true'
$env:Authentication__LocalDevelopment__Token = 'figvam-local-development-bearer-token'
$env:Storage__Directory = 'C:\figvam-data\documents'
dotnet run --project src/FigVam.Server --no-launch-profile --urls http://127.0.0.1:8080
```

`GET /alive` проверяет доступность процесса; `GET /health` проверяет готовность сервера. Пока внешних зависимостей нет, готовность означает успешный запуск процесса. При добавлении обязательных зависимостей их проверки должны входить в readiness. Ответ при исправном состоянии — HTTP 200 и `Healthy`.

Сервер пишет структурированные JSON-логи. Метрики ASP.NET Core и runtime и трассировки ASP.NET Core передаются по OTLP при заданном `OTEL_EXPORTER_OTLP_ENDPOINT`; Aspire настраивает этот адрес при локальном запуске. Тела запросов и содержимое документов не регистрируются. При независимом запуске без OTLP endpoint внешний экспорт отключён.

## Аутентификация сервера

Стандартный браузерный режим — **Google Sign-In** с защищённой cookie-сессией и локальным списком разрешённых пользователей. Настройка Google Cloud, Bootstrap Admin, локального HTTPS, Aspire и Production описана в [инструкции Google Sign-In](docs/google-auth.md).

В Production поддерживается только Google Sign-In. Серверный OAuth подтверждает Google-пользователя, FigVam сверяет его с собственным списком доступа и создаёт HttpOnly/Secure cookie-сессию. Вся запись в API из браузера дополнительно требует CSRF-токен. Внешний Bearer/JWT API намеренно не поддерживается — его не требуется сохранять ради обратной совместимости.

Для работы без внешнего identity provider локальный режим нужно явно включить через `Authentication:Mode=Local` и `Authentication:LocalDevelopment:Enabled=true` в окружении `Development` и задать `Authentication:LocalDevelopment:Token` (минимум 32 UTF-8 байта). Он разрешает только явно заданные loopback URL (`localhost`, `127.0.0.1`, `::1`), отвергает `Kestrel:Endpoints` и принудительно создаёт только loopback-сокеты. Wildcard/external URL и Production с локальным режимом завершают запуск ошибкой. Не публикуйте локальный режим через reverse proxy или туннель. Локальный bearer-токен даёт фиксированного актора `local-developer`; произвольный клиентский actorId не принимается.

HTTP launch profile явно включает этот локальный режим с общеизвестным токеном `figvam-local-development-bearer-token`; HTTPS launch profile использует Google. Эти настройки не входят в опубликованный appsettings. В headless CI режим и токен задаются явно, как в примере выше, либо изолированный Testing с тестовым RSA-ключом. Интеграционные тесты создают свой ключ и подписанные токены, проверяют 401 для недействительных идентичностей, отказы конфигурации и запрет запуска небезопасной аутентификации в Production.

## HTTP API доступа к документам v1

Все операции требуют серверно проверенную идентичность: Google cookie в браузерном режиме или Bearer в режимах Jwt/Local. Идентификатор актора определяется только проверенным `sub`; поля вне опубликованных DTO отклоняются. Тела запросов ограничены 16 KiB, `memberId` — 256 символами. На аутентифицированного актора выделяется до 300 запросов GET и HEAD и отдельный лимит 120 запросов остальных методов в минуту. До аутентификации действует общий лимит 120 запросов в минуту по IP.

| Операция | JSON запроса | Ответ |
| --- | --- | --- |
| `POST /api/v1/documents` | `{ "documentId": "<uuid>" }` | 201; пустой документ, создатель — Owner |
| `PUT /api/v1/documents/{documentId}/members` | `{ "memberId": "<sub>", "role": "Editor" }` | 200; назначение или замена роли |
| `DELETE /api/v1/documents/{documentId}/members/{memberId}` | нет | 200; удаление членства |

Роли: `Owner`, `Editor`, `Viewer` (с учётом регистра). Только Owner назначает и удаляет участников. Последнего Owner нельзя удалить или понизить. Удаление отсутствующего участника разрешено Owner. Членство и ревизия модели независимы: эти операции не меняют revision черновика.

Успех: `{ "code": "ACCEPTED", "documentId": "<uuid>" }`. Ошибка имеет поля `type`, `title`, `status`, `code`, `detail`; детали хранилища не возвращаются. Коды: 400 `INVALID_REQUEST`, `INVALID_ID`, `INVALID_MEMBER`, `INVALID_ROLE`; 401 `UNAUTHENTICATED`; 403 `FORBIDDEN` (также для неизвестного документа при изменении участников); 409 `DOCUMENT_EXISTS`, `LAST_OWNER`; 413 `REQUEST_TOO_LARGE`; 415 `UNSUPPORTED_MEDIA_TYPE`; 429 `RATE_LIMITED`; 500 `INTERNAL_ERROR`. Неизвестный API-ресурс даёт 404 `NOT_FOUND`, неподходящий HTTP-метод — 405 `METHOD_NOT_ALLOWED`.

OpenAPI опубликован в `GET /openapi/v1.json`. JSON Schemas DTO генерируются из тех же публичных типов и атрибутов и доступны через `GET /api/v1/schemas/{name}.json`: `CreateDocumentRequest`, `SetDocumentMemberRequest`, `DocumentAccessResponse`, `ApiError`. Эти endpoints также требуют bearer-токен. Схема полного `.figvam` и остальные операции ещё не опубликованы. Контрактные тесты проверяют схемы независимым JSON Schema валидатором, реальные HTTP-ответы, ошибки, права и сохранение членства после перезапуска серверного процесса.


## HTTP API команд v1

`POST /api/v1/documents/{documentId}/commands/{operation}` принимает типизированный JSON с обязательным `commandId`. Операции: `add-page` (`pageId`), `delete-page` (`pageId`, `expectedRevision`), `add-screen` (`pageId`, `screenId`, `dimensions`), `add-node` (`parentId`, `nodeId`, `kind`), `delete-node` (`nodeId`), `move-node` (`nodeId`, `expectedParentId`, `targetParentId`, `position`), `set-node-property` (`nodeId`, `property`, `value`), `save` (необязательное `name`), `restore` (`versionId`), `undo` и `redo`. Значение свойства задаётся объектом с дискриминатором `type`: `string`, `number`, `boolean`, `asset`, `token` или `enum`; его поля опубликованы в схеме `SetNodePropertyRequest`. Неподтверждённый профиль пока не разрешает узлы и их свойства.

Успешный ответ содержит `status: "ACCEPTED"`, `documentId`, `commandId`, `revision`, относящиеся к операции ID и `affectedIds`. Повтор `commandId` возвращает первоначальный результат. Отказ имеет стандартные поля `ApiError`, а для свойства также `nodeId` и `property`; его код и объяснение описаны в OpenAPI. Роли проверяются обработчиком для каждой операции. DTO-схемы опубликованы под именами соответствующих типов запросов и `CommandResponse`.

Structural read queries are available at `/api/v1/documents/{documentId}` and its `pages`, `screens`, `nodes`, and `children/{parentId}` routes. Individual pages, screens, and nodes can be addressed by ID. Results identify the committed revision. Lists use `offset` and `limit` (1-100, default 50); `nodes` accepts `screenId` and `kind`, and `children` accepts `kind`. `fields` selects a comma-separated subset of `kind`, `properties`, and `childCount`; ID and type are always included. `depth` expands children from 0 to 2 levels, with at most 100 total items per response. `childrenTruncated` indicates an incomplete expansion; query children separately to paginate them. Name and semantic-key filters are not available until those fields exist in the document model. JSON Schemas are served under `/api/v1/schemas/` and OpenAPI at `/openapi/v1.json`.


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
saved local fixture at optional `revision`, with `offset` and `limit` (1-100,
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
`variantId`, `offset` and `limit` (1-100). Missing overrides inherit base properties.
Variants are limited to 1000 per screen and 10000 overrides each. Existing profile
property rules and token reference types apply; this does not expand profile support.
Remove affected overrides before deleting a node or moving its subtree to another screen.

### Saved prototype scenarios

`POST /api/v1/documents/{documentId}/commands/create-scenario` takes `{commandId, scenario}`; `update-scenario` takes `{commandId, scenario, expectedRevision}`; `delete-scenario` takes `{commandId, scenarioId, expectedRevision}`. A scenario is `{id, screenId, nodeId, event, actions}`. Events are Click=0, Change=1, Hover=2 and Leave=3. The event node belongs to the saved screen tree. Actions use a `type` discriminator: `navigate`/`openOverlay` with `screenId`, `showVariant` with nullable `variantId`, `setDemoValue` with `nodeId` and nullable `value`, `selectDataset` with nullable `datasetId`, or `closeOverlay`/`resetPreview`. A variant belongs to the navigation screen at that action; Navigate changes that context. Overlay nodes may receive local demo values. After ResetPreview, the active screen depends on the session initial selection; subsequent references still require existing typed document targets. Component variants are separate entities.

`GET /api/v1/documents/{documentId}/scenarios` accepts optional `revision`, `screenId`, `scenarioId`, `offset` and `limit` (1-100). Viewer may read; only editors/owners may mutate. Mutations use the same durable journal, events, commandId deduplication, safe per-actor undo/redo and immutable saved versions as other document commands. Remove or update referencing scenarios before deleting their nodes/datasets or moving event nodes to another screen. Limits: 1000 scenarios/document, 1-32 actions/scenario, 4096 characters/demo value, 1 MiB of serialized scenarios/document. These are saved demo values, not live data or secrets. The production registry has no verified prototype event/action capabilities; successful scenarios currently require a verified profile supplied by the host. No portability support is inferred from serialization.

OpenAPI documents the operations. JSON schemas are published at `/api/v1/schemas/{name}.json` for `CreateScenarioRequest`, `UpdateScenarioRequest`, `DeleteScenarioRequest`, `PreviewScenario` and `ScenariosResponse`. `INVALID_SCENARIO` reports invalid references, unsupported profile capabilities or bounds; `SCENARIO_NOT_FOUND`, `SCENARIO_IN_USE` and `REVISION_CONFLICT` distinguish target absence, protected references and stale edits.

## Internal remote JSON connector

`IRemoteJsonReader.ReadAsync(connectorId)` is a server-only foundation. It has no
HTTP fetch endpoint. The internal Preview data capability authorizes document
access before explicit refresh and again after network I/O. Live results are not persisted.

Administrators configure `RemoteJson` in server configuration, for example:

```json
{
  "RemoteJson": {
    "Connectors": {
      "catalog": {
        "Url": "https://data.example/catalog",
        "AllowedAuthorities": [{ "Host": "data.example", "Port": 443 }],
        "SecretId": "catalog-token"
      }
    }
  }
}
```

Omit `SecretId` for unauthenticated sources. Supply bearer tokens separately using
server secret configuration, for example the environment variable
`RemoteJsonSecrets__catalog-token`; never put tokens in the destination URL or
commit them to appsettings. Redirects receive a token only on the original origin.
No URL or secret is exposed through the reader interface, error codes or logs.

Every destination and redirect must use HTTPS and an exact allowed host/port.
All resolved addresses must pass the public-address policy; sockets connect to a
checked IP while TLS still validates the original hostname. Proxies, automatic
redirects, cookies and response decompression are disabled. Only JSON media types
and strictly parsed JSON are accepted. Failures return a status without body or
exception details. Production TLS certificate checks remain enabled.

Default limits per server instance: 4 concurrent reads (no queue), 30 attempts per
minute across all connectors, a 5000 ms deadline covering DNS through body parsing,
1 MiB body, JSON depth 32 and 3 redirects. Configure these via `MaxConcurrentReads`,
`RequestsPerMinute`, `TimeoutMilliseconds`, `MaxResponseBytes`, `MaxJsonDepth` and
`MaxRedirects` under `RemoteJson`; bounded values are validated at startup. Unknown
IDs are rejected without network access. `AllowLocalhostInDevelopment` explicitly
permits only loopback resolutions of the exact hostname `localhost` in Development;
enabling it in another environment refuses startup. No private IP literals or
other private hostnames inherit that exception. Use a locally trusted HTTPS
certificate for development. These limits are process-local, so a multi-instance
integration must account for the total outbound budget.


### Dataset connector links

A dataset may persist an optional `connectorId` alongside its required offline
`fixtureJson`. Editors and owners use
`POST /api/v1/documents/{documentId}/commands/set-dataset-connector` with
`{commandId, datasetId, expectedRevision, connectorId}`, or
`remove-dataset-connector` with `{commandId, datasetId, expectedRevision}`.
Both require the exact current document revision. Assignment accepts only an
administrator-configured connector ID (1–128 ASCII letters, digits, `_`, `-`,
or `.`); URLs, secrets and additional request properties are rejected. Unknown
IDs return `CONNECTOR_NOT_ALLOWED`; removing an absent link returns
`DATASET_CONNECTOR_NOT_FOUND`. A dataset's metadata queries include the optional
ID without exposing server destinations or secrets.

These commands do not resolve DNS, fetch JSON or alter the offline fixture.
Replacing/importing a fixture preserves the link. The link participates in the
same durable journal, events, revision reads/diffs, saved versions, recovery and
safe Undo/Redo as other dataset changes. Ordinary queries and comparison reads
continue to use saved fixtures. Request and document JSON Schemas and OpenAPI publish these fields.

### Internal Preview data

`IDocumentPreviewFactory` creates a revision-pinned Preview with an ephemeral
`Data` capability. Creation performs no network request. Application callers use
`GetStateAsync`, `RefreshAsync`, `UseFixtureAsync`, `EvaluateBindingAsync` and
`EvaluateRepeaterAsync`, passing a dataset ID and the current actor on every
operation. Dataset selection is independent of screen and variant selection.
This capability has no public HTTP route or UI yet.

Only explicit `RefreshAsync` invokes the trusted reader using the saved connector
ID. State reports Ready, Loading, Error or Empty and Fixture or Remote as its
source. Empty at dataset level means an empty root array; repeater evaluation
reports its empty view for an empty array at the configured items path. Errors
carry a structured remote status and automatically evaluate the saved fixture;
`UseFixtureAsync` discards remote state and clears the error. A concurrent refresh
or fixture reset of a loading dataset returns BUSY. Cancellation ends loading and
uses the fixture. Each Preview owns its remote cache; navigation history and
serialized Preview results exclude it.

Remote JSON must satisfy the existing fixture limits (64 KiB, depth 32, unique
object keys); the total per-Preview remote cache is limited to 8 MiB. Typed paths,
property validation, repeater expansion and shared work limits apply to both
sources. Evaluation returns only bound values or repeater output, rather than a
raw remote payload. No fetched JSON enters the document, journal, saved versions,
revision diff, comparison snapshots, exports or logs. The production portability
profile is unchanged.


Screens persist required `dimensions: {width, height}` in logical uiUnits. Both axes
must be finite and non-negative (zero is valid), matching reference layout size
semantics. `add-screen` requires dimensions; `resize-screen` accepts
`{commandId, screenId, dimensions}` and atomically sets both axes. Editors/owners
may write; Viewer may read. Invalid values return `INVALID_SCREEN_DIMENSIONS`
without changing revision. Resize changes no child properties.

Revision-aware screen queries include `dimensions` by default or via
`fields=dimensions`; revision diff reports `dimensions.width` and
`dimensions.height`. Creation and resize events carry dimensions. These values
are journaled before ACK, recovered in historical/current snapshots and saved
versions, and participate in guarded per-actor Undo/Redo. JSON schemas include
`AddScreenRequest`, `ResizeScreenRequest` and `ScreenDimensions`.

`delete-page` atomically removes the page, its screens (including variants), descendant nodes and contained component instances. It requires edit access and the current `expectedRevision`; retained references from other pages, scenarios or component definitions return `PAGE_IN_USE` (409). Remove those references explicitly before deletion. Refusals preserve the document and revision. Duplicate `commandId` returns the original result; the operation supports safe Undo/Redo, historical revision reads and crash recovery. Request schema: `/api/v1/schemas/DeletePageRequest.json`.


Standalone `document.json` export: `GET /api/v1/documents/{documentId}/document.json`
accepts either `revision` or `versionId`, or neither for the latest draft. Owner and
Editor may export; Viewer export remains denied until an export policy is represented.
The response is a downloadable JSON file, bounded to 16 MiB, with no document mutation.
The published format schema is `GET /api/v1/schemas/document-v1.json` (draft 2020-12,
ID `urn:figvam:document:1`). The endpoint is described in OpenAPI.

Format version 1 has four required fields: `schemaVersion` (integer 1), `revision`
(nonnegative draft revision), `savedVersion` (null for a revision export, otherwise
`id`, `name`, `timestamp`, `authorId`, and `revision`), and `document`. A saved ID is
not a revision or format version. `document.profile` is required and contains `id`
(`figvam.portable-ui`) and positive integer `version` (currently 1), independently
of `schemaVersion`, draft revision and saved-version ID. Only the exact installed
profile is accepted for import, persistence, recovery and export. Unknown IDs
produce `PROFILE_UNAVAILABLE`; unavailable versions produce
`UNSUPPORTED_PROFILE_VERSION`, without substituting another profile. This production
profile remains empty: no node kinds or target platforms are declared supported.
`document` contains all durable fields currently
represented by DocumentStructure: ID and profile; ordered pages with names and screen IDs;
screens, dimensions and variants; nodes with names, semantic keys, ordered children,
typed properties, bindings and repeaters; complete component definitions, parameters,
bindings, slots, variants and instances; tokens with both themes and aliases;
datasets with the exact local FixtureJson string and optional connector ID; and
scenarios with transitions and actions. Enum values are strings and polymorphic
values retain their discriminator fields. No metadata is inferred for fields the
current durable model does not represent (including localization
and additional document metadata).

Bytes use UTF-8 compact JSON, no BOM or trailing newline. Object keys (including
maps) sort recursively by ordinal comparison. Arrays retain model order, including
pages, child lists and actions; fixture JSON is an opaque durable string, preserved
exactly. Repeated export of the same snapshot yields identical bytes across restarts,
independent of SQLite serialization or dictionary insertion order. No export timestamp
is generated. Live connector responses, Preview state, authorization membership and
server credentials/configuration are outside the durable document and never read by
this exporter; local fixtures are intentionally included. Connector IDs are retained
without resolving network configuration.

Errors use the existing structured API error format: `FORBIDDEN`, `INVALID_QUERY`
(including simultaneous revision/versionId), `INVALID_REVISION`, `INVALID_ID`,
`REVISION_UNAVAILABLE`, `DOCUMENT_NOT_FOUND`, `VERSION_NOT_FOUND`,
`EXPORT_TOO_LARGE`, `EXPORT_UNSUPPORTED_DATA`, or `EXPORT_DEPENDENCY_UNAVAILABLE`.
The last error rejects missing or invalid asset dependencies. Standalone JSON retains
the asset manifest and references; it has no asset bytes, so reopening a document
with assets requires its complete `.figvam` container. No partial file is returned. Standalone JSON export, `.figvam` export and reopening version-1 files are available.
Schema migrations are not implemented.

### Open `.figvam` container (version 1)

`GET /api/v1/documents/{documentId}/container.figvam` returns a ZIP download.
It accepts the same mutually exclusive `revision` and `versionId` selectors, authorization,
document JSON size limit and structured errors as `document.json`. The archive contains
`manifest.json`, `document.json`, then assets sorted by technical ID at canonical
`assets/{assetId:N}.png` paths (32 lowercase hexadecimal UUID digits). Only assets
in the selected revision or saved-version manifest are included. The manifest schema is published at
`GET /api/v1/schemas/manifest-v1.json`. Its `schemaVersion` is 1; `files` contains
the path, uncompressed byte size, and lowercase hexadecimal SHA-256 of `document.json`
and each asset. Each content file is listed exactly once.
The manifest itself is not included in the hash list. Verify the size and digest against
the actual uncompressed bytes before using the document. ZIP entries are uncompressed
and use a fixed timestamp, so the same selected document yields identical archive bytes.
The exporter loads every selected asset from durable storage and verifies its hash,
size and safe PNG metadata. Missing or invalid content returns
`EXPORT_DEPENDENCY_UNAVAILABLE` with no partial archive. Remote live data and
server secrets are excluded, as in the standalone document export.


### Validating document files

`IDocumentFileReader` reads standalone JSON or version-1 `.figvam` streams into a
`DocumentJsonExport`, or returns structured diagnostics with no partial document.
It does not create documents, resolve connectors, access storage, or change its input.
Both paths validate the published schemas and the domain/profile constraints. The
central resolver selects the installed profile by the exact persisted profile ID and
version before checking node kinds, properties and behavior. Container asset content must match the
document manifest, including ID, type, hash, size and decoded dimensions. Safe raster
validation is identical to upload validation. Missing dependencies, undeclared files
and assets absent from the document manifest are rejected. Standalone JSON containing
asset dependencies returns `MISSING_DEPENDENCY` with a diagnostic requesting the container.

Input limits are 16 MiB for document JSON, 64 KiB for the manifest, 80 MiB + 256 KiB
for compressed container bytes, and 80 MiB + 64 KiB for expanded entries. Containers
accept at most 258 regular file entries: the two JSON files and up to 256 assets
(5 MiB each, 64 MiB total asset bytes). Duplicate paths (including case aliases),
unsafe paths, symbolic links, extra entries and mismatched sizes/hashes are rejected.
JSON permits depth 64 and at most 100,000 values, with duplicate properties rejected.
Documents permit at most 1,000 nodes, pages, screens, component definitions, component
instances and tokens each, and structural node depth 128. Existing domain limits for
fixtures, scenarios, strings and bindings also apply. Failure diagnostics include
object/reference IDs and property names when supplied by domain validation.


### Reopening document files

Authenticated `POST /api/v1/documents/import/document.json` accepts the raw version-1
JSON body (`application/json`, maximum 16 MiB). `POST
/api/v1/documents/import/container.figvam` accepts raw ZIP bytes (`application/zip`,
maximum 80 MiB + 256 KiB). No multipart or base64 envelope is used. Published format
schemas and reader limits above apply. Imported node kinds and properties must
be valid for the document's profile version.

Success is HTTP 201 `DocumentImportResponse` with `code`, `documentId` and `revision:0`.
The validated document and all technical IDs are preserved. One transaction creates
the baseline snapshot, all validated asset content and the authenticated importing
actor's Owner membership. An existing
ID returns HTTP 409 `DOCUMENT_EXISTS` without changing content, revision or membership.
Concurrent imports for one ID have one winner. Failed validation or storage writes
leave no accessible partial document.

The imported state starts a new local revision-zero baseline. Source revision and
saved-version metadata are validated as file metadata but do not create local
revisions or saved versions. Membership and command history are not imported.
Subsequent commands, Save, recovery, reads and exports use the regular journal.
Import does not fetch connectors or external assets; required content comes from the validated container.

HTTP 400 `DocumentImportFailure` has `code: "INVALID_DOCUMENT_FILE"` and a `diagnostics`
array of `DocumentReadDiagnostic` values: code, path, message, and optional objectId,
referenceId and property. Codes come from the reader and domain/profile validator.
HTTP 413 uses the standard API error (`REQUEST_TOO_LARGE` or `FILE_TOO_LARGE`);
other standard errors include 401, 403, 415, 429 and 500. DTO schemas are published at
`/api/v1/schemas/DocumentImportResponse.json`, `DocumentImportFailure.json` and
`DocumentReadDiagnostic.json`. Raw body content types and limits are in OpenAPI.

### Durable document raster assets

`PUT /api/v1/documents/{documentId}/assets/{assetId}?commandId={uuid}` accepts
raw `image/png` bytes (no multipart or URL). Owner or Editor is required. IDs are
nonempty UUIDs and share the document technical ID namespace. Repeating commandId
returns the original CommandResponse without adding content, revision or event;
assetId appears in affectedIds. Refusal leaves the document revision unchanged.

Limits: 5 MiB per upload, width/height 1-4096, 4,194,304 pixels, 256 assets and
64 MiB per document manifest. Only static, noninterlaced, 8-bit grayscale, RGB,
gray-alpha or RGBA PNG is accepted, with at most 1024 IHDR/IDAT/IEND chunks;
IDAT chunks must be contiguous.
The validator checks signature, order, lengths, CRC, zlib/Adler checksum,
decoded rows and filter types. Palettes, metadata, animation, SVG, external links,
other formats, truncated data and trailing bytes are rejected.

UploadDocumentAssetCommand uses the shared authorized handler. SQLite commits
content, lowercase SHA-256 hash, manifest, journal event, result and revision
in one transaction before ACK. Content is document-scoped and retained after
Undo or Restore; historical revisions and saved versions keep their own manifest.
Safe Undo refuses removal when nodes, components or screen variants reference
an asset. Recovery and Save verify references and stored content hashes.
Retained historical blobs are not garbage-collected.

`GET /api/v1/documents/{documentId}/assets` returns DocumentAssetsResponse:
documentId, revision, and at most 256 entries (id, contentType, sha256, byteLength,
width, height). `GET /api/v1/documents/{documentId}/assets/{assetId}` returns
verified PNG bytes. Both accept mutually exclusive revision and versionId;
omission selects the current draft. Every request requires current read access,
including saved-version requests. The asset must belong to the selected snapshot.
Responses use no-store, nosniff, sandbox CSP, SHA-256 ETag and X-Document-Revision.

OpenAPI documents the raw upload and responses; DTO schemas are published at
`/api/v1/schemas/DocumentAsset.json` and
`/api/v1/schemas/DocumentAssetsResponse.json`. Structured errors include
INVALID_ASSET (400), ASSET_TOO_LARGE (413), ASSET_LIMIT_EXCEEDED (409),
DUPLICATE_ID (409), FORBIDDEN (403), ASSET_NOT_FOUND (404), INVALID_QUERY (400),
and ASSET_CONTENT_UNAVAILABLE (500), plus shared authentication/revision/version
errors. No public blob URLs are issued. Container import/export includes selected
asset content; standalone JSON preserves the manifest and requires the container
to reopen dependencies.

Documents have a nonblank name of at most 256 characters without control characters. Creation accepts `name` (default `Document`); `POST /api/v1/documents/{documentId}/commands/rename-document` takes `commandId` and `name`. Document names are included in revision queries, saved versions and document exports.

Authenticated `GET /api/v1/documents` lists the actor's current memberships with document ID, current name and role. Results are ordered by document ID; `limit` defaults to 50 and ranges from 1 to 100. Pass the returned `nextCursor` as `cursor` to continue; a null cursor ends the list. Membership and name are read together per document, so changes between pages can affect later results. DTO schemas are available at `/api/v1/schemas/DocumentListItem.json` and `/api/v1/schemas/DocumentListResponse.json`.

### Initial browser workspace

Run the server using the authentication configuration described above (`dotnet run
--project src/FigVam.Server`), or start the Aspire AppHost, then open the server's
root URL. In production serve it over HTTPS. The public HTML/JS/CSS shell contains
no document data or credentials. Paste an already issued bearer token into the
password field; FigVam does not issue tokens or add an identity provider. The token
stays in JavaScript memory for the current tab, is sent only in the Authorization
header to the same-origin API, and is cleared from the field immediately. It is
never written to URL, cookies, localStorage or sessionStorage. Reloading, leaving
the page or choosing the Forget token button requires entering it again. Existing
production signature/lifetime validation and restricted loopback development mode
are unchanged.

The workspace lists accessible documents in pages of 20 with forward/backward
navigation, creates a document with a name, imports a document file, and opens
`/documents/{documentId}`.
Direct links require a token again in a new tab or after reload. The document name
and revision are fetched with current server authorization. Loading, empty list,
invalid/expired token, forbidden access, network/server errors and retry states are
displayed in Russian. Creation is never retried automatically: after an ambiguous
failure, refresh the list before creating again. Membership changes between pages
retain the listing API's existing semantics.

The editor displays pages, screens, layers and other document information. Depending
on the actor's role, it offers document and page management, screen creation and
resizing, layer operations, datasets, tokens and scenarios, as well as undo/redo,
saved versions and restore. Owners can manage members. Owners and Editors can
export the current document as JSON or a `.figvam` container; Viewer cannot export.

Create a page and a screen, then use the palette to add a Frame, Text, Button,
TextInput or Image. A Frame can contain other layers and arrange them freely or
in a horizontal or vertical stack. Use the inspector to change geometry, text
and appearance. On the canvas, drag freely positioned layers to move them and
drag the resize handle to change their size. To pan, drag the empty canvas, drag
with the middle mouse button, or hold Alt and drag with the left mouse button.
Use the mouse wheel or zoom controls to change the scale.

To add an image, upload a PNG up to 5 MiB from the palette, choose Image and select
the uploaded asset. The inspector lets you set its alternative description and
choose Contain, Cover or Stretch.

Open Preview to try the selected screen with its rendered layout, buttons and
text fields. Text entered in Preview is temporary. Return to Design to continue
editing. Confirmed edits are restored when you reopen the document. To keep an
immutable snapshot, optionally enter a version name and choose **Создать версию**.
The snapshot appears under saved versions and can be restored from there.

Forms, links, pagination and session clearing work with the keyboard, visible
focus and live status/error announcements. Text renders as plain text, and the
shell uses a restrictive CSP with no inline or external scripts.

Verification: `dotnet test tests/FigVam.Server.Tests --filter EditorUiTests` checks
the production shell/direct routes and retained bearer/membership boundaries.
Browser tests cover real API creation/list pagination/direct opening, reload token
clearing, keyboard operation, safe text rendering, loading, retry, forbidden and
token failure states. The visual workflow creates and edits a design through the UI,
then checks Preview, a saved version, reopening after a server restart, and Undo/Redo
against both the persisted model and browser layout. Run after `dotnet build FigVam.sln`:

```powershell
Set-Location tests/FigVam.Ui.Tests
npm ci
npx playwright install chromium
npm test
```

Each browser scenario starts the built Debug server on an assigned loopback port,
with isolated storage under its test output directory and an explicitly enabled
Development token. This isolates the local actor's rate-limit budget while
retaining production authorization, validation and durable journal behavior.
Server logs are attached to each result. Browser tests use one worker and no retries.
