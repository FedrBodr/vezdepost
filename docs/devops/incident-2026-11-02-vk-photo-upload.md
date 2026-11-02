Project: vezdepost
Document: incident

# 2026-11-02: VK и VK Group не публикуют посты с картинкой

## Кратко

Пост с одной картинкой ушёл через MCP на 9 каналов. Семь опубликовались: Telegram, Telegram Stories, MAX, Discord, Tumblr, Pinterest, а LinkedIn висел в очереди на момент проверки. Оба VK-канала упали на загрузке фото. Повтор с JPG вместо PNG дал ту же ошибку, то есть дело не в формате файла.

## Что произошло

| Канал | integrationId | Пост | Время (UTC) | Вложение | Ошибка |
|---|---|---|---|---|---|
| VK личный «Dmitry Fedorenko» | `cmrkt2bm60004qmd9pmwa5a5e` | `cmvzosj0p0002tijfcsau8vtj` | 20:03 | PNG 1080×1350, ~510 КБ | `VK photos.getWallUploadServer returned invalid upload fields` |
| VK Group «FedrBodr» | `cmrkssexc0001qmd927cfakqk` | `cmvzosj1c0003tijfmfxjqjw5` | 20:03 | PNG 1080×1350, ~510 КБ | `VK Group photo upload returned invalid fields` |
| VK личный, повтор | `cmrkt2bm60004qmd9pmwa5a5e` | `cmvzot6b90009tijfbe424y9q` | 20:04 | JPG 1080×1350, ~181 КБ | та же |
| VK Group, повтор | `cmrkssexc0001qmd927cfakqk` | `cmvzot6de000atijfiov9tnd8` | 20:04 | JPG 1080×1350, ~181 КБ | та же |

Медиа загружены через Public API (`/api/public/v1/upload`) и лежат в `https://app.vezdepost.ru/uploads/2026/11/02/`:
- PNG: `c4d4ac33b31e4a1c10d23e02412a820ef.png`
- JPG: `8bb58ee09a18c45ffc4d992415d1cbd8.jpg`

Эти же PNG в ту же минуту успешно ушли в Telegram, MAX, Discord, Tumblr и Pinterest. Значит, файл доступен и хранилище отдаёт его нормально.

Текст поста около 1,7 тыс. символов, ссылка `https://fedrbodr.com/go/smekalka-vk` (и `-vkg`), settings пустые. Публикация шла через `integrationSchedulePostTool`, `type: now`.

## Где падает

- **VK личный:** `libraries/nestjs-libraries/src/integrations/social/vk.provider.ts`, `parsePhotoUploadResponse` (строки ~86–103). Ответ upload-сервера не содержит непустых строковых `photo` и `hash`. Код upload-сервера (`error`) провайдер не логирует и в сообщение не выносит, поэтому из ошибки причину не понять.
- **VK Group:** `vk.group.provider.ts`, `badPhotoUploadFields`. Коммит `00668cb9` (30.10, есть в `prod`) добавляет в сообщение код `ERR_UPLOAD_...`, если upload-сервер его вернул. В нашей ошибке кода **нет**, значит:
  - либо upload-сервер вернул `photo: "[]"` без поля `error`;
  - либо на проде ещё сборка без `00668cb9`. Проверить версию бэкенда.
- В бэкенд-логе VK Group должна быть строка `[vk-group] photo upload returned invalid fields:` с формой полей (`photo:empty-list`, `hash:string` и т. п.). Смотреть за 2026-11-02 около 20:03–20:05 UTC.

## Гипотезы (не проверены)

1. **Нет scope `photos` у токена** или токен выпущен без него. Тогда VK отдаёт upload URL, но сам upload возвращает пустой `photo`. Это совпадает с тем, что `docs/devops/vk-group-photo-capability-check.md` до сих пор в статусе **Pending authorized execution**: фото в VK Group на проде ни разу не проходило проверку.
2. **Upload-сервер не может скачать или принять файл.** Например, провайдер отправляет не байты, а URL, или неверное имя multipart-поля (`photo`/`file`). Против этой версии говорит то, что ломаются обе интеграции, а код у них разный.
3. **Сломалось что-то общее**, например заголовки или прокси исходящих запросов к `pu.vk.com`. На это указывает то, что падают оба провайдера сразу.

## Что сделать

- [ ] Найти в логах бэкенда записи за 20:03–20:05 UTC по обоим integrationId и строку `[vk-group] photo upload returned invalid fields`.
- [ ] Проверить, что прод собран с `00668cb9`.
- [ ] В `vk.provider.ts` сделать такую же безопасную диагностику, как в группе: код `ERR_UPLOAD_*` и форма полей без значений.
- [ ] Проверить scopes токенов обоих каналов. Если нет `photos`, переподключить.
- [ ] Провести проверку из `vk-group-photo-capability-check.md` и получить `GO`.
- [ ] Повторить публикацию постов `cmvzosj0p0002tijfcsau8vtj` и `cmvzosj1c0003tijfmfxjqjw5` (текст в Postiz).

## Обходной путь

Опубликовать в VK тот же текст без вложения, тогда VK сам построит превью по ссылке. Проходит ли такая публикация сейчас, не проверено.

## Причина (установлена 2026-11-02, 20:40–21:00 UTC)

Гипотезы 1–3 не подтвердились. Токены, scope `photos`, формат файла и сеть в порядке.

- Ручные загрузки на проде: тот же PNG и JPG, токены обоих каналов, и временный скрипт, и настоящий код провайдера, остановленный до `saveWallPhoto`. В большинстве попыток VK вернул нормальные `photo` и `hash`.
- Но upload-сервер VK **периодически** отвечает `405 Not Allowed` (nginx `kittenx`) или присылает строковые `photo`/`hash` с пустым значением. Следующая попытка с новым `getWallUploadServer` проходит.
- История в базе показывает то же самое: у личного VK с фото 16 PUBLISHED и 13 ERROR с сентября, то есть сбои плавающие, не постоянные.
- Код делал ровно одну попытку, поэтому любой сбой upload-сервера сразу ронял пост.

## Исправление

`vk.provider.ts` и `vk.group.provider.ts`: если загрузка фото упала или VK вернул пустые поля без явного кода `ERR_UPLOAD_*`, код ещё до двух раз (пауза 1 с, затем 3 с) получает новый upload-сервер, заново открывает файл и загружает его. Не повторяются: видео (каждый `video.save` создаёт новую запись), ошибки VK API (включая 5) и явные коды `ERR_UPLOAD_*`. Лог группы теперь показывает длины строковых полей.
