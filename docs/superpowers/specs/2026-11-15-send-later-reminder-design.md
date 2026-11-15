Project: vezdepost
Document: design-spec

# Бот-напоминалка «отправить позже» для ЛС ВК (WOK-769). Дизайн

Статус на 15.11.2026: только дизайн. Строить бота нельзя до проверки спроса
(~10.12.2026, статья `/blog/otlozhennoe-soobshchenie-vk/`, WOK-768) и до «да»
владельца.

## Идея

Человек пишет боту текст и время. В нужный момент бот присылает ему этот текст
и ссылку на диалог ВК. Человек сам копирует текст и отправляет его. Бот не
трогает аккаунт ВК пользователя и пишет только тем, кто сам начал с ним диалог.

## Шаг 1. Правила ВК: не проверены

Страницы dev.vk.com и vk.com из инструментов сессии не открылись: WebFetch
отказывает обоим доменам, curl запрещён политикой. Поэтому выводов о правилах
ВК здесь нет. Ниже вопросы, на которые нужен ответ с цитатой.

| # | Вопрос | Страница |
|---|---|---|
| 1 | Кому сообщество может писать через `messages.send`, нужно ли согласие (человек написал первым или нажал «Разрешить сообщения») | https://dev.vk.com/ru/method/messages.send, https://dev.vk.com/ru/api/community-messages/getting-started |
| 2 | Есть ли окно ответа. Можно ли написать через N дней тому, кто однажды писал сообществу | те же + https://dev.vk.com/ru/method/messages.allowMessagesFromGroup |
| 3 | Лимиты: запросов в секунду, сообщений в сутки, отдельно для тех, кто не писал первым | https://dev.vk.com/ru/api/api-requests |
| 4 | Какие права ключа сообщества нужны (`messages`, `manage`?), работает ли Bots Long Poll | https://dev.vk.com/ru/api/access-token/community-token, https://dev.vk.com/ru/api/bots-long-poll/getting-started |
| 5 | Запреты на напоминания, ссылки, рекламу и рассылки от сообществ, правила про спам | https://dev.vk.com/ru/rules |
| 6 | Документированный формат ссылки на диалог с человеком (`vk.com/im?sel=<id>`, `vk.me/<screen_name>`) | любая страница, где он описан |
| 7 | Новые лимиты API 2026 года (после них перестал работать Kate Mobile): касаются ли они ключей сообществ | раздел новостей или изменений dev.vk.com |

Пока на вопросы 1, 2 и 4 нет ответа с цитатой, вариант д1 не строим.

## Шаг 2. Выбор канала

| Критерий | (д1) Сообщество Vezdepost в ВК | (в) Telegram |
|---|---|---|
| Правила платформы | Неизвестны, см. шаг 1. Риск: окно ответа или лимиты сделают отложенное напоминание невозможным | Бот пишет тому, кто нажал /start. Это обычная модель Telegram, препятствий не видно |
| Где человек в момент запроса | Он ищет ответ про ЛС ВК и уже во ВКонтакте. Напоминание приходит туда, где надо отправить сообщение | Надо открыть другой мессенджер, и там же есть свой «отправить позже». Часть людей уйдёт уже на этом шаге |
| Сложность | Высокая. В репозитории нет ни `messages.send`, ни ключа сообщества, ни Long Poll/Callback. Нужны новый транспорт, поллер и сообщество с ключом | Низкая. Есть `TelegramAssistantApi`, поллер, `AssistantTransport`, Redis-локи |
| Как приводит в Vezdepost | Тот, кто пишет сообществу, видит Vezdepost как бренд во ВК, рядом с провайдером `vk-group` | Подводит к Telegram-ассистенту, но аудитория статьи — люди из ВК |
| Регистрация | Сообщество, ключ сообщества, включить сообщения и Long Poll (владелец) | Новый бот в BotFather (владелец) или расширение @vezde_post_bot |

**Рекомендация: д1, если шаг 1 подтвердит, что сообщество может написать
человеку, который однажды начал диалог, через часы или дни.** Если окно
ответа короткое или лимиты не дают так делать, выбираем (в) с отдельным ботом
(почему отдельным, см. ниже). Ядро напоминаний делаем независимым от
транспорта, поэтому смена канала потом не потребует переделки.

Почему не расширять @vezde_post_bot: роутер ассистента
(`libraries/nestjs-libraries/src/assistant/assistant.router.ts:184`) считает
любой текст черновиком поста и требует привязки аккаунта через `/start <code>`.
Люди из поиска не пользуются Vezdepost, и смешивать два сценария в одном
диалоге значит запутать и их, и нынешних пользователей ассистента.

## Шаг 3. Куда встраивается

### Что уже есть

- `assistant/assistant.types.ts`: `AssistantTransportName = 'telegram' | 'max'`
  и интерфейс `AssistantTransport` (`sendMessage`, `editMessage`,
  `answerCallback`, …).
- Входящие события приходят только через long-poll: Telegram
  (`telegram-assistant/telegram.assistant.poller.ts`, лок `tg-assistant:poller`)
  и MAX (`assistant/max.assistant.poller.ts`). Боты запускаются в backend через
  `TelegramAssistantWorker.onApplicationBootstrap`, если задан токен из env.
- VK-провайдеры (`vk.provider.ts`, `vk.group.provider.ts`) работают на
  пользовательском токене VK ID и сообщений не касаются. Их не трогаем.
- Отложенная одноразовая задача:
  `apps/orchestrator/src/workflows/personal-streak-reminder.workflow.ts`
  (`sleep` до даты и одна попытка отправки), стартер
  `libraries/nestjs-libraries/src/temporal/personal-streak-reminder.starter.ts`.
- Prisma: `db push` без миграций, рискованные изменения заранее применяются
  скриптом в `docs/server-scripts/`.

### Новое

1. **Модель Prisma `MessageReminder`** (новая таблица, существующие не
   меняются, предварительный SQL не нужен):
   `id`, `transport` (String), `messengerUserId`, `chatId`, `text`,
   `targetUrl?` (ссылка на диалог, которую дал человек), `remindAt`, `timezone`,
   `status` (`scheduled | sent | cancelled | failed`), `createdAt`, `sentAt?`,
   `@@index([transport, messengerUserId, status])`. Связи с `Organization` нет:
   пользователи анонимные.
2. **Repository → Service** в `libraries/nestjs-libraries/src/database/prisma/reminders/`
   по образцу `telegram-assistant/telegram.assistant.link.*`: `create`,
   `listActive`, `cancel`, `markSent`, лимит активных напоминаний на человека
   (например, 10) против спама.
3. **Роутер напоминаний** `assistant/reminder.router.ts`. Принимает
   `AssistantEvent` от любого транспорта (как `AssistantRouter`), разбирает
   «текст + время», подтверждает кнопками «Ок / Изменить время / Отмена», даёт
   `/list` и `/cancel`. Транспорт, события и поллер берутся существующие
   (Telegram) или новые (VK), без `if (vk)` в общем коде. Разбор времени
   («завтра в 9:00», «через 2 часа», «20.11 18:30», по умолчанию
   Europe/Moscow): перед реализацией поискать, нет ли готового парсера в
   зависимостях. Новый файл с алгоритмом пишем только если парсера нет.
4. **Temporal**: новый файл `apps/orchestrator/src/workflows/message-reminder.workflow.ts`
   (`messageReminderWorkflow`, существующие workflow не меняются). Принимает
   `{ reminderId }`, делает `sleep` до `remindAt`, затем вызывает активити
   `sendReminder(reminderId)`. Активити перечитывает запись: отменённую не
   шлёт, отправляет через транспорт, ставит `sent` или `failed`. Новый класс
   `ReminderActivity` в `apps/orchestrator/src/activities/`. Стартер
   `temporal/message-reminder.starter.ts` по образцу streak-стартера:
   `workflowId = reminder_${id}`; отмена завершает workflow
   (terminate/cancel), как в `posts.service.ts`.
   Открытый вопрос: активити выполняется в orchestrator, а токены ботов сейчас
   есть только в backend. Нужно добавить токен в env orchestrator (строка в
   compose плюс configure-скрипт, см. память «Prod env via compose»).
5. **Транспорт VK (только д1)**: `assistant/vk.events.ts`,
   `assistant/vk.assistant.transport.ts`, `assistant/vk.assistant.poller.ts`
   (Bots Long Poll, свой Redis-лок), ветка в `TelegramAssistantWorker` под
   `VK_REMINDER_GROUP_TOKEN`, расширение `AssistantTransportName`. Кнопки через
   преобразование `InlineKeyboard`, как `toMaxKeyboard`. Все методы и права
   берём только после шага 1.
6. **Текст напоминания**:
   «Пора отправить: <текст>. Открыть диалог: <targetUrl>». Ниже одна строка:
   «Посты в VK, Telegram и MAX по расписанию — vezdepost.ru» со ссылкой
   `https://vezdepost.ru/?utm_source=reminder_bot&utm_medium=<transport>&utm_campaign=send_later`.
   Другой рекламы нет. Готового сборщика UTM в коде нет, хватит константы в
   роутере.

### Чего не делаем

- Пользовательский токен ВК, логин или пароль. Отправку от имени человека.
- Сообщения тем, кто сам не начал диалог. Только ответы и напоминания в
  уже открытом диалоге.
- Изменения в `AssistantRouter`, `TelegramAssistantLink` и существующих
  workflow.

### Тесты (при реализации)

Юнит-тесты на разбор времени, на роутер напоминаний с фейковым
`AssistantTransport` (по образцу тестов `assistant.router`) и на активити: если
напоминание отменено, отправки нет. Replay-тест нового workflow по образцу
`post-workflow-replay.spec.ts`.

## Решения

- 15.11.2026: до проверки спроса (~10.12.2026) только дизайн, без кода.
  Причина: условие WOK-769. Бот имеет смысл, только если статья WOK-768
  покажет спрос.
- 15.11.2026, ждёт подтверждения владельца: рекомендован д1 при условии, что
  правила ВК это позволяют, иначе (в) отдельным ботом. Отвергнуто расширение
  @vezde_post_bot: его роутер считает любой текст черновиком поста и требует
  привязки аккаунта.
