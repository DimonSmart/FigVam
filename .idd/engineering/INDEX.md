# Engineering Rules Index

This index is a compact discovery projection for current Engineering Rules. Full rule documents are normative.

The `Rule` column contains stable `ENG-NNNN` identifiers only. Resolve each ID to exactly one current `.idd/engineering/ENG-NNNN.rule-*.md` file.

Next ID: ENG-0008

| Rule | Applicability | Applies when | Summary |
| --- | --- | --- | --- |
| ENG-0001 | Always | Every implementation task | Серверный стек и модульный монолит |
| ENG-0002 | Always | Every implementation task | Границы домена и приложения |
| ENG-0003 | Conditional | Изменение возможностей профиля | Единый реестр переносимых возможностей |
| ENG-0004 | Conditional | Обработка команд и сохранение | Единый обработчик и durable journal |
| ENG-0005 | Conditional | Компоновка и её применение | Общий чистый эталонный движок |
| ENG-0006 | Conditional | Разработка и сопровождение демонстрируемых браузерных UI-тестов | Деморежим поверх того же E2E-сценария без влияния на CI |
| ENG-0007 | Conditional | Разработка и сопровождение frontend FigVam | TypeScript, React, Vite, Base UI и типизированные API-контракты |
