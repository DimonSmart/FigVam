# Google Sign-In в FigVam

FigVam использует стандартный ASP.NET Core Google OAuth (AddGoogle), серверную cookie-сессию (AddCookie) и собственный SQLite-список разрешённых пользователей. Пароли и Google access tokens приложением не сохраняются. В Google-режиме запросы к документам используют стабильный внутренний идентификатор вида `google:<uuid>`, а не адрес электронной почты.

## 1. Настройка Google Cloud

1. Откройте https://console.cloud.google.com/, создайте новый проект или выберите существующий.
2. Откройте **Google Auth Platform** → **Branding** и заполните название FigVam, контакты поддержки и разработчика.
3. В разделе **Audience** выберите External для обычных Google-аккаунтов. Если приложение в Testing, добавьте адреса нужных людей в **Test users**. Только указанные Google-пользователи смогут пройти OAuth в этом режиме; FigVam дополнительно проверяет собственный allowlist.
4. В **Clients** создайте OAuth Client ID типа **Web application**.
5. Добавьте **Authorized redirect URI**: `https://localhost:7146/signin-google`. Адрес должен совпадать символ в символ, включая схему, порт и путь.
6. Сохраните **Client ID** и **Client Secret**. Не публикуйте секрет в репозитории или клиентском JavaScript. Для Production зарегистрируйте дополнительный redirect URI: `https://<your-domain>/signin-google`.

Используются стандартные scope Google (профиль и email) и проверка `verified_email=true` из Google userinfo. Контактный email Google не используется как постоянный ID.

## 2. Первый администратор и секреты (локально)

Из каталога репозитория (PowerShell):

```powershell
dotnet user-secrets set "Authentication:Google:ClientId" "<client-id>" --project src/FigVam.Server
dotnet user-secrets set "Authentication:Google:ClientSecret" "<client-secret>" --project src/FigVam.Server
dotnet user-secrets set "Authentication:Google:BootstrapAdminEmail" "admin@example.com" --project src/FigVam.Server
dotnet dev-certs https --trust
dotnet run --project src/FigVam.Server --launch-profile https
```

Откройте `https://localhost:7146`, нажмите **Войти через Google** и выберите аккаунт с подтверждённым email, который указан как `BootstrapAdminEmail`. Первый такой вход создаст администратора. Этот механизм применяется **один раз**; завершение bootstrap фиксируется в SQLite. Незнакомые аккаунты и другие email не получают автоматического доступа.

После входа откройте раздел **Пользователи FigVam** на странице документов. Добавляйте людей по email, изменяйте доступ и роль Admin. Приглашённый пользователь должен впервые войти с тем же подтверждённым Google email. После привязки пользователя идентифицирует только Google `sub`; совпадение email не позволяет заменить уже привязанный аккаунт. Последнего активного Admin нельзя отключить или понизить.

## 3. Режимы

| Режим | Конфигурация | Применение |
| --- | --- | --- |
| Google (по умолчанию) | `Authentication:Mode=Google` | Браузер, HTTPS, серверные cookies |
| Jwt | `Authentication:Mode=Jwt`, `Issuer`, `Audience`, `SigningPublicKeyPem` | Программные API-клиенты и прежние JWT-тесты |
| Local | `Authentication:Mode=Local`, `LocalDevelopment:Enabled=true`, `LocalDevelopment:Token` | Только Development на loopback |

В режиме Local используется HTTP-профиль `http://localhost:5210`. Он не принимает внешний трафик и не должен проксироваться в Internet. Режимы разделены: Bearer не даёт автоматический доступ к Google-cookie приложения и не обходит его allowlist.

Сервер при запуске требует Google Client ID, Client Secret и BootstrapAdminEmail в Google-режиме. Не создавайте Production-конфигурацию без них. Ошибки OAuth и отказ allowlist показываются на стартовой странице, не раскрывая внутренние детали.

## 4. Aspire

Проект `FigVam.AppHost` запускает сервер FigVam. Его HTTPS endpoint может получить динамический адрес. Посмотрите фактический адрес `server` в Aspire Dashboard и добавьте соответствующий `https://localhost:<port>/signin-google` в Authorized redirect URIs, либо закрепите HTTPS endpoint на стабильном порту в AppHost. Не используйте `http://...` для Google OAuth callback.

Google User Secrets должны быть доступны процессу **FigVam.Server** внутри запуска Aspire. При необходимости вместо них передавайте `Authentication__Google__ClientId`, `Authentication__Google__ClientSecret`, `Authentication__Google__BootstrapAdminEmail` через защищённую конфигурацию окружения запуска.

## 5. Production

- Публикуйте только через HTTPS и используйте соответствующий Google redirect URI.
- Размещайте `Storage:Directory` в постоянном каталоге, доступном для записи только приложению. Здесь лежат документы, `figvam-users.sqlite` и Data Protection keys в `auth-keys`. Создавайте резервные копии этих данных, включая ключи.
- Защитите ключи Data Protection средствами ОС или выделенного защищённого хранилища. При нескольких репликах сервера используйте единое защищённое хранилище ключей и SQLite с корректной организацией общего хранения. Для распределённой эксплуатации SQLite требует отдельной архитектурной проверки.
- Если используется TLS-terminating reverse proxy, настройте ASP.NET Core Forwarded Headers **только от доверенного proxy**; иначе Google OAuth callback может сформировать неверную схему HTTP. Не доверяйте произвольным `X-Forwarded-*` от клиента.
- `__Host-FigVam` cookie содержит серверно зашифрованный ticket: `HttpOnly`, `Secure`, `SameSite=Lax`, не более восьми часов. Cookies отзываются через сохранённые серверные сессии.
- Browser storage не содержит Google токенов и cookie-секретов. `X-CSRF-TOKEN` выдаётся лишь после аутентификации и требуется для POST, PUT, PATCH, DELETE запросов к API.

## 6. Документы и миграция

Права Owner/Editor/Viewer по-прежнему хранятся у самого документа. Роль Admin позволяет управлять пользователями, но **не** предоставляет Owner для всех документов. Для добавления участника документа используйте email из списка разрешённых пользователей, уже привязавших Google-аккаунт. При выборе сервер переводит email в постоянный идентификатор.

Ранее созданные документы и членство с `local-developer` или JWT `sub` сохраняются без преобразования. Они **не** наследуются Google-пользователем по совпадению email. Для явного переноса прав без подмены владельца используйте существующее API управления участниками:

1. Привяжите Google-аккаунт через Google Sign-In. Запишите свой новый actorId (`GET /api/identity`, формат `google:<uuid>`).
2. В отдельное время переключите сервер на прежний режим `Jwt` либо локальный `Local` с **тем же** Storage:Directory. Войдите как существующий Owner документа (старый JWT `sub` либо `local-developer`).
3. Используя **именно токен действующего Owner**, отправьте `PUT /api/v1/documents/{documentId}/members` с телом `{"memberId":"google:<uuid>","role":"Owner"}` либо более ограниченной ролью. Сервер проверит исходные права Owner через существующую модель документа и сохранит новое членство. Не заменяйте существующего Owner до проверки.
4. Верните режим `Google`, проверьте доступ нового аккаунта. При необходимости старый Owner затем может отозвать прежнее членство.

Это явное изменение прав с проверкой прежнего владельца, а не автоматическое объединение аккаунтов по email. Копирование/перезапись SQLite-строк вручную не требуется и не рекомендуется.

## 7. Проверки

```powershell
dotnet restore FigVam.sln
dotnet build FigVam.sln --no-restore
dotnet test tests/FigVam.Server.Tests/FigVam.Server.Tests.csproj --no-build
cd tests/FigVam.Ui.Tests
npm ci
npx playwright install chromium
npx playwright test
```

Автоматические тесты используются с локальным тестовым Bearer (без обращения к Google). Проверка реального Google Sign-In на localhost остаётся отдельным ручным smoke-test: открыть страницу, войти первым администратором, добавить второго пользователя, зайти вторым аккаунтом, проверить отказ неизвестному, отзыв доступа и выход.
