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

## Деплой и проверка изменений

- Ветка **prod** — продакшн. `git push` в prod = деплой: на сервере cron
  каждые **3 минуты** запускает `/root/postiz-app/deploy/autodeploy.sh`.
- Правка лендинга обычно live через 30–120 секунд после пуша. Проверка:
  ```sh
  curl -s https://vezdepost.ru | grep -q "<новый текст>" && echo LIVE
  ```
- Доступ на сервер: `ssh vezdepost` (alias). State-changing операции — только
  через скрипты из `docs/server-scripts/`, см. devops-доки.

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

## Текущие хвосты (на 2026-07-11)

- Бэкапы Postgres на сервере ещё не настроены.
- Оптимизация Dockerfile (pnpm fetch) — запланирована, не сделана.
