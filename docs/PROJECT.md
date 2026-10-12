Project: vezdepost (Postiz fork)
Document: project-overview

# Vezdepost — обзор проекта для агентов

Ориентировочная дока: что это за проект, где что лежит и какие решения уже
приняты. Прочитай перед любой работой над лендингом, продуктом или копирайтом.
Серверные операции — в [devops/README.md](devops/README.md) (runbooks) и
[server-scripts/](server-scripts/) (готовые скрипты).

---

## Что это

**Vezdepost** — открытый AI-developed форк [Postiz](https://github.com/gitroomhq/postiz-app)
(AGPL-3.0): планировщик постов в 30+ соцсетей и мессенджеров с фокусом на
российские платформы (добавлен мессенджер MAX от VK, интерфейс на русском,
хостинг в РФ). Один мейнтейнер (FedrBodr / Дмитрий Федоренко), большую часть
кода пишет Claude Code под его контролем.

- Продукт: https://app.vezdepost.ru (приложение), https://vezdepost.ru (лендинг)
- Репозиторий: https://github.com/FedrBodr/vezdepost — **публичный**, ничего
  секретного в коммиты и доки не класть
- Апстрим Postiz синхронизируется еженедельно

## Репозиторий

Монорепо Postiz (PNPM): `apps/backend` (NestJS API), `apps/orchestrator`
(Temporal jobs), `apps/frontend` (Vite React), `libraries/` (общий код) — см.
корневой CLAUDE.md. Специфика форка живёт в:

- `deploy/landing/index.html` — **весь лендинг vezdepost.ru одним файлом**
  (self-contained: инлайн CSS/JS, без сборки)
- `deploy/autodeploy.sh` + compose-файлы — прод-инфраструктура
- `docs/devops/`, `docs/server-scripts/` — runbooks и скрипты сервера
- `docs/superpowers/` — планы/спеки фич (например, MAX-провайдер)

### Quick post API

`POST /posts/quick` создаёт по одному посту на каждый выбранный канал с
настройками сети по умолчанию. Тело:
`{ text, media: [{id, path}], integrationIds, schedule: {type: 'now'|'queue'|'date', date?} }`.
Ответ: `{ published: [{id, name}], failed: [{id, name, error}] }`.
Логика в `libraries/nestjs-libraries/src/quick-post/`; Telegram-ассистент
публикует через тот же сервис с creation method `API`. Спека:
`docs/superpowers/specs/2026-10-12-mobile-version-design.md`.

## Деплой и проверка изменений

- Ветка **prod** — продакшн. `git push` в prod = деплой: на сервере cron
  каждые **3 минуты** запускает `/root/postiz-app/deploy/autodeploy.sh`.
- Правка лендинга обычно live через 30–120 секунд после пуша. Проверка:
  ```sh
  curl -s https://vezdepost.ru | grep -q "<новый текст>" && echo LIVE
  ```
- Доступ на сервер: `ssh vezdepost` (alias). State-changing операции — только
  через скрипты из `docs/server-scripts/`, см. devops-доки.

### Что считать реально задеплоенным

Не считать deploy завершённым только потому, что `origin/prod`, серверный Git
HEAD или лендинг/страница приложения уже показывают новый commit. Для
production-кода обязательны все сигналы:

1. `/var/lib/vezdepost-deployed-rev` равен целевому commit;
2. `/var/log/vezdepost-autodeploy.log` содержит свежую строку `deploy finished`;
3. контейнер `postiz` пересоздан и имеет новое `StartedAt`;
4. внутри контейнера слушают порты backend/frontend/nginx: `3000`, `4200`,
   `5000`;
5. в Temporal task queue `main` зарегистрирован workflow poller.

HTTP 200 от `/launches` подтверждает только frontend: backend при этом может
возвращать 502. Полные команды и recovery-процедуры — в
[`devops/deployment.md`](devops/deployment.md) и
[`devops/diagnostics.md`](devops/diagnostics.md). Никогда не вставляй в чат или
логи полный `Cookie`, `Authorization`, `auth`, JWT, OAuth/session token или
секрет; заменяй значение на `<redacted>`.

### Ops-алерты владельцу в Telegram

Cron раз в 5 минут запускает `docs/server-scripts/ops-alerts.sh` из
задеплоенного checkout. Скрипт пишет через бота ассистента
(`TELEGRAM_ASSISTANT_TOKEN`) в Telegram, привязанный к суперадмину в
ассистенте, или в `OPS_ALERT_CHAT_ID` из `.env`. В сообщении: отвалившиеся
каналы (`refreshNeeded`), ошибки публикации, посты, зависшие в `QUEUE` дольше
15 минут, `Refresh failed for` из логов, рестарты от watchdog, падение
контейнера вне деплоя, новые регистрации. Если событий нет, скрипт молчит.
Установка: `ssh vezdepost 'bash /root/postiz-app/docs/server-scripts/33-install-ops-alerts.sh'`,
лог: `/var/log/vezdepost-ops-alerts.log`, состояние:
`/var/lib/vezdepost-ops-alerts/`. Тест: `bash docs/server-scripts/ops-alerts.spec.sh`.

## Лендинг vezdepost.ru

Один файл `deploy/landing/index.html`. Тёмная тема, CSS-переменные в `:root`
(`--accent1` фиолетовый, `--accent2` бирюза), секции чередуются `section` /
`section.alt`. Структура: hero → #preview (CSS-мокап календаря) → #steps →
#platforms → #pricing → #faq → #services → final CTA → footer.

### Аналитика

- GTM: `GTM-5JNQTLP2` (head + noscript)
- Яндекс Метрика счётчик `110559699`, цели шлются кликовым слушателем внизу
  файла: `cta_app_click` (app.vezdepost.ru), `github_click`
  (github.com/FedrBodr), `services_click` (t.me/FedrBodr внутри #services),
  `tg_footer_click` (t.me/FedrBodr вне #services, т.е. футер).
  Новая конверсия = новая ветка в этом слушателе + цель в интерфейсе Метрики.
- Google Analytics 4: ресурс «Vezdepost (vezdepost.ru)» (property 558479479,
  аккаунт AhMiranami 408932779), поток `G-NG6Q7F0Z9N`. Тег gtag.js — прямо в
  head лендинга и в `GTM_HEAD` генератора блога (не через GTM — так он в репо и
  под тестом). Тот же кликовый слушатель шлёт одноимённые события GA4
  (`gtag('event', goal, {link_url})`), `language_switch` — с параметром
  `language`. Хранение данных — 14 мес. Ключевое событие — `cta_app_click`
  (отмечается звёздочкой в Admin → Events, когда событие появится в списке).
  Приложение app.vezdepost.ru шлёт в тот же поток: `GoogleAnalyticsComponent`
  в `apps/frontend/src/components/layout/gtm.component.tsx`, ID — runtime-env
  `GOOGLE_ANALYTICS_ID` (литерал в `docker-compose.override.yaml`). Контейнер
  GTM-5JNQTLP2 (его тоже грузит приложение через `/g.js`) принадлежит другому
  Google-аккаунту, поэтому GA4 подключён не через GTM.
- Search Console: основной ресурс `sc-domain:vezdepost.ru` (владелец — другой
  Google-аккаунт; сервис-аккаунт — Full user). Для связки с GA4 добавлен
  ресурс `https://vezdepost.ru/` (URL-prefix), подтверждён через тег GA4 —
  **не удалять gtag с главной**, иначе подтверждение слетит. GA4 ↔ GSC связаны,
  в отчётах GA4 опубликованы коллекции Life cycle и Search Console.

### Атрибуция пользователей (WOK-523)

Метрика и PostHog не видят посетителей с блокировщиками, а поисковые фразы в
Метрике скрыты. Поэтому источник регистрации хранится у нас:

- **First-touch cookie** `vp_first_touch` на `.vezdepost.ru`, 180 дней,
  пишется один раз: на лендинге — inline-скрипт в `deploy/landing/index.html`,
  в приложении — серверно в Next proxy (`apps/frontend/src/proxy.ts`, по HTTP
  Referer, блокировщики не мешают). Формат и парсер —
  `libraries/helpers/src/utils/first.touch.ts`.
- При регистрации (email и OAuth: Google, VK и т.д.) бэкенд копирует cookie в
  `User.signupSource` (JSON: `src`, `ref`, `path`, `utm`, `at`). У
  пользователей, зарегистрированных до 2026-10-02, поле пустое.
- Отчёт: `ssh vezdepost 'bash -s' < docs/server-scripts/28-signup-sources.sh`.
- **Access-лог Caddy** (JSON, с Referer и User-Agent, Cookie/Authorization
  редактируются): `/data/access-logs/access.log` в контейнере `caddy`
  (volume `caddy-data`), ротация 50 MiB × 20, хранение 30 дней. Поиск:
  `ssh vezdepost "docker exec caddy sh -c 'grep -h <IP> /data/access-logs/*'"`.
- **Изменения `deploy/Caddyfile` автодеплой не применяет**: файл смонтирован
  одиночным bind mount, после `git reset` контейнер видит старый inode
  (`--watch` не помогает). После деплоя такого коммита:
  `ssh vezdepost 'bash -s' < docs/server-scripts/29-apply-caddyfile.sh`.
- **Поисковые запросы** — только в Search Console (сервисный аккаунт из
  `~/.config/fedrbodr/gsc-sa.json` должен иметь доступ к ресурсу vezdepost.ru)
  и Яндекс Вебмастере (`~/.config/fedrbodr/yandex-webmaster.token`).

**UTM для собственных ссылок** (без них переход считается «прямым»):

| Где ссылка | URL |
|---|---|
| LinkedIn, профиль | `https://vezdepost.ru/?utm_source=linkedin&utm_medium=social&utm_campaign=profile` |
| LinkedIn, посты | `https://vezdepost.ru/?utm_source=linkedin&utm_medium=social&utm_campaign=post` |
| VK | `https://vezdepost.ru/?utm_source=vk&utm_medium=social&utm_campaign=profile` |
| spros.work | `https://vezdepost.ru/?utm_source=spros&utm_medium=referral&utm_campaign=profile` |
| Telegram (канал/профиль) | `https://vezdepost.ru/?utm_source=telegram&utm_medium=social&utm_campaign=profile` |
| fedrbodr.com | `https://vezdepost.ru/?utm_source=fedrbodr&utm_medium=referral&utm_campaign=site` |
| GitHub README | `https://vezdepost.ru/?utm_source=github&utm_medium=referral&utm_campaign=readme` |

Для разовой публикации меняй `utm_campaign` (например `post-2026-10-belovo`).

### Тон и принятые копирайт-решения (не откатывать молча)

- **Слово «зарплата» на лендинге не используем** — жена мейнтейнера отметила,
  что «серверы + 1 зарплата» пугает. Формула: «сейчас бесплатно; подписка,
  если понадобится, покроет только серверы — без инвесторов и наценки».
- Оплата времени мейнтейнера упоминается только в FAQ «Это правда бесплатно?»
  с ориентиром «рыночная зарплата **founding engineer**» (не Lead, не CTO —
  обсуждалось и выбрано осознанно 2026-07-10).
- Про ИИ пишем «под контролем **опытного инженера-практика**».
- Общий тон — скромный и честный («это не бизнес, а открытый проект»),
  обещания проверяемые.

### Секция услуг (#services)

Личное предложение мейнтейнера: «MVP и кастомные решения — до 7 дней»,
таймлайн дни 1–2 разработка → 3–4 правки → 5 прод → **7 смотрим метрики**.
Ключевой месседж: клиент через неделю смотрит на метрики реальных
пользователей, а не на демо. CTA → https://t.me/FedrBodr (цель
`services_click`).

## Блог vezdepost.ru/blog/

SEO-гайды под реальные запросы (исследование и частотности Wordstat —
[content/blog-keyword-research.md](content/blog-keyword-research.md)).

- Исходники статей: `deploy/blog/articles/<slug>.html` — JSON-метаданные в
  первом комментарии (`title`, `h1`, `description`, `published`, `updated`,
  `lead`, `card`, необязательные `order`, `related`) + тело статьи. У каждого
  `<h2>` обязателен `id` — из них собирается оглавление.
- Сборка: `node deploy/blog/build.mjs` пишет `deploy/landing/blog/**/index.html`,
  индекс блога и **обновляет `deploy/landing/sitemap.xml`**. Результат
  коммитится; `deploy/blog/build.spec.ts` падает, если сборка устарела, sitemap
  неполный или есть битые внутренние ссылки.
- Исходники лежат вне `deploy/landing`, поэтому Caddy их не раздаёт.
- Общие `deploy/landing/blog/blog.css` / `blog.js` (first-touch cookie с
  `path=/blog/...` и те же цели Метрики, что на лендинге; GTM — инлайн в head).
- Правило контента: только проверяемые факты о продукте (нет ОК/Дзена, нет
  импорта истории TG→MAX, нет «зеркала»); цены конкурентов не публикуем без
  проверки. Даты `updated` обновлять при правке фактов — правила MAX меняются.
- После деплоя новых статей: `node deploy/blog/indexnow.mjs` (без аргументов —
  все URL из sitemap, или конкретные URL аргументами) — уведомляет Яндекс и Bing
  по IndexNow. Ключ публичный: `deploy/landing/<KEY>.txt`, KEY — в скрипте.
  Дополнительно можно отправить URL на переобход в Яндекс Вебмастере.

## Текущие хвосты (на 2026-07-11)

- Бэкапы Postgres на сервере ещё не настроены.
- Оптимизация Dockerfile (pnpm fetch) — запланирована, не сделана.
