# Vezdepost — Project Home и Task Sync

Актуализировано 10.09.2026 в рамках [WOK-112](https://linear.app/fedrbodrcore/issue/WOK-112).

## Идентичность

- Продукт: Vezdepost, личный open-source форк Postiz.
- Control Hub project_id: `vezdepost`.
- Linear Project: [Vezdepost](https://linear.app/fedrbodrcore/project/vezdepost-f960aae52c62).
- Linear Project ID: `b7b5d731-507d-4acd-b658-2be7f3748c5a`.
- GitHub origin: https://github.com/FedrBodr/vezdepost .
- Upstream: https://github.com/gitroomhq/postiz-app .
- Primary Project Home: этот репозиторий. Историческое имя папки `postiz-app`
  и её расположение внутри `webbankir` не меняют принадлежность продукта.
- Роль: личное параллельное направление, Active / operations / secondary.
- Архитектура и эксплуатация: [PROJECT.md](PROJECT.md),
  [devops/README.md](devops/README.md), [CLAUDE.md](../CLAUDE.md).

## Начало содержательной работы

1. Получить `get_project_context({project_id: "vezdepost"})` через Control Hub.
2. Найти существующую задачу в этом Linear Project. Текущее описание Linear и
   свежий checkpoint важнее старых планов и этого датированного обзора.
3. Существующие FED-* задачи не переносить и не копировать: учитывать
   workflow команды FedrBodrCore. Новые задачи создавать в Work внутри того же
   проекта: по прямому поручению Ready, агентскую инициативу — Triage.
4. Выбранную задачу перевести в In Progress.
5. Проверить Git remote и актуальную базовую ревизию. Для реализации плана
   использовать изолированный worktree по корневым правилам. Сохранить
   пользовательские изменения primary checkout.

## Завершение сессии

- Записать `report_checkpoint` с project_id `vezdepost`, обязательным
  `idempotency_key`, фактическими результатами, проверками и следующим шагом.
- Закрыть именно выполнявшуюся задачу: Done при подтверждённом результате;
  Waiting при внешнем ожидании с `set_waiting` и датой проверки; Ready при
  остановке без результата. Для исторической команды использовать её
  доступные состояния по смыслу, не менять глобальный workflow ради задачи.
- При недоступном MCP работу не блокировать; явно отметить отложенный синк.
- Новые идеи отправлять в Inbox, не расширять ими выполняемую задачу.
- Задачи других проектов, использующих Vezdepost как инструмент, остаются в
  соответствующем проекте.

## Существующие задачи

Приоритет при следующем входе — [FED-381](https://linear.app/fedrbodrcore/issue/FED-381):
актуализировать состояние social/video каналов AhMiranami и определить
доступный этап. Вход в личные аккаунты и OAuth-приёмку выполняет владелец по
корневому AGENTS.md.

| Направление | Существующая задача |
|---|---|
| VK Group: rollout и приёмка | [FED-333](https://linear.app/fedrbodrcore/issue/FED-333) |
| Blue-green при подтверждённых пользователях | [FED-337](https://linear.app/fedrbodrcore/issue/FED-337) |
| Остальные capability-профили | [FED-347](https://linear.app/fedrbodrcore/issue/FED-347) |
| Курсив | [FED-382](https://linear.app/fedrbodrcore/issue/FED-382) |
| MAX video | [FED-288](https://linear.app/fedrbodrcore/issue/FED-288) |
| Telegram Rich Messages: проверить предпосылки | [FED-386](https://linear.app/fedrbodrcore/issue/FED-386) |
| Streaming Hub: отложенный дизайн | [FED-338](https://linear.app/fedrbodrcore/issue/FED-338) |
| Проверка хостед-версии | [FED-286](https://linear.app/fedrbodrcore/issue/FED-286) |
| Эпизод шоу | [FED-287](https://linear.app/fedrbodrcore/issue/FED-287) |
| Конфликтный upstream PR #2 | [WOK-120](https://linear.app/fedrbodrcore/issue/WOK-120) |

FED-281—285, FED-336 и FED-339—346 отмечены Done на инвентаризации 09.09.
Не исполнять их планы заново только из-за незачёркнутых checkbox.

## Ограничения актуальности

На сверке 09.09.2026 primary checkout `prod` стоял на `1e357ef5`, а
GitHub `prod` — на `e182e612` (208 более новых коммитов). Эта запись
не означает, что checkout был обновлён. Перед изменениями проверить заново.

Открыт [upstream PR #2](https://github.com/FedrBodr/vezdepost/pull/2)
с конфликтами (`upstream-sync` → `main`). FED-284 относится к настройке
workflow, а WOK-120 — к разбору конкретного PR.

У FED-333 и FED-337 остались августовские даты; они не подтверждают
актуальное клиентское обязательство. FED-347 сообщает о незавершённом аудите,
хотя FED-346 Done: сначала найти артефакт. FED-382 следует перечитать с учётом
свежего remote sanitizer fix; наличие одного fix не доказывает готовность
всего capability-контракта.

Ветка `prod` запускает autodeploy при push. При регистрации проектный код,
публикации и production не изменялись. Секреты не включать в документацию,
Linear и checkpoint.

