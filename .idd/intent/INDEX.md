# IDD Intent Index

This index helps humans and Coding Agents find relevant current intent documents.
It is not the source of truth.

Current `IDD-NNNN` documents directly under `.idd/intent/` contain normative
product intent, ADRs, or active spikes.

`GLOSSARY.md`, when present, is an optional unnumbered vocabulary support file
and is not listed in this index.

Git history is the source for deleted or previous document versions.

For shared or cross-cutting product intent, use `Area`, `Notes`, or equivalent
discovery metadata to make the scope obvious to planners. Existing projects do
not need a schema migration; keep their current INDEX shape when it already
communicates this information.

Implementation-only durable constraints belong in the optional
`.idd/engineering/` layer, not in this index.

## Current documents

Current documents are listed below.

The `Document` column contains stable `IDD-NNNN` identifiers only. Do not put
filenames, file paths, or Markdown links in this column. Resolve an identifier to
the unique current `.idd/intent/IDD-NNNN.*.md` file when the document must be
opened.

| Document | Role | Area | Notes |
| --- | --- | --- | --- |
| IDD-0001 | Spec | Продукт | Назначение и границы |
| IDD-0002 | Spec | Переносимость | Профиль и соответствие |
| IDD-0003 | Spec | Документ | Модель и формат |
| IDD-0004 | Spec | Редактор | Холст и доступность |
| IDD-0005 | Spec | Компоновка | Геометрия и ограничения |
| IDD-0006 | Spec | Дизайн-система | Компоненты и токены |
| IDD-0007 | Spec | Прототип | Сценарии и данные |
| IDD-0008 | Spec | Команды | Совместная работа |
| IDD-0009 | Spec | Сохранение | Версии и восстановление |
| IDD-0010 | Spec | API | Программный доступ |
| IDD-0011 | Spec | Экспорт | Генерация и соответствие |
| IDD-0012 | Spec | Безопасность | Доступ и аудит |
| IDD-0013 | Spec | Эксплуатация | Среды и измерения |
| IDD-0014 | Spike | Переносимость | Проверка профиля |
| IDD-0015 | Spec | Релизы | Минимальный состав MVP и V1 |
