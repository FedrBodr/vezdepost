# Adaptive Posting Chat Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a reusable Russian system prompt that groups compatible destinations under one universal post and creates separate versions only where platform adaptation is materially useful.

**Architecture:** A standalone Markdown artifact contains copy-ready system instructions, verified active-platform constraints, an adaptive decision procedure, and a stable output contract. A small Vitest contract test prevents accidental loss of safety rules or platform coverage.

**Tech Stack:** Markdown, TypeScript, Vitest 3, pnpm 10.

## Global Constraints

- The rules cover Telegram, MAX, LinkedIn, Tumblr, Pinterest, personal VK, and VK Group.
- The chat must not invent facts, figures, quotes, links, outcomes, or media details.
- The chat asks one concise clarification only when essential input is missing.
- Universal output is preferred when it preserves meaning and quality.
- Separate versions are created only for real differences in limit, structure, tone, formatting, required fields, links, hashtags, or media treatment.
- The artifact prepares content for transfer into Vezdepost and never publishes automatically.
- Track this deliverable under Linear issue `FED-344`.

---

### Task 1: Create and contract-test the copy-ready posting rules

**Files:**

- Create: `docs/content/adaptive-crossposting-chat-rules.md`
- Create: `docs/content/adaptive-crossposting-chat-rules.spec.ts`

**Interfaces:**

- Produces: one copy-ready system prompt and one compact user-input template.
- Consumes: the platform limits and behavior approved in the design specification.

- [ ] **Step 1: Write the failing document contract test**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const rules = readFileSync(
  join(process.cwd(), 'docs/content/adaptive-crossposting-chat-rules.md'),
  'utf8'
);

describe('adaptive crossposting chat rules', () => {
  it.each([
    'Telegram',
    'MAX',
    'LinkedIn',
    'Tumblr',
    'Pinterest',
    'VK',
    'VK Group',
  ])('documents %s', (platform) => expect(rules).toContain(platform));

  it('locks the adaptive grouping and factual safety contract', () => {
    expect(rules).toContain(
      'Сначала проверь, достаточно ли универсальной версии'
    );
    expect(rules).toContain(
      'Не выдумывай факты, цифры, цитаты, ссылки и результаты'
    );
    expect(rules).toContain('Причина адаптации');
    expect(rules).toContain('Не публикуй автоматически');
  });

  it('contains verified active-platform limits', () => {
    expect(rules).toContain('4096');
    expect(rules).toContain('1024');
    expect(rules).toContain('4000');
    expect(rules).toContain('3000');
    expect(rules).toContain('32768');
    expect(rules).toContain('500');
    expect(rules).toContain('16384');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run docs/content/adaptive-crossposting-chat-rules.spec.ts`

Expected: FAIL with `ENOENT` because the rules document does not exist.

- [ ] **Step 3: Create the rules document with this exact structure and prompt**

````markdown
# Правила для AI-чата: адаптивный кросспостинг

Скопируй содержимое блока «Системные инструкции» в системный промпт или правила
рабочего чата. Перед каждой новой публикацией используй короткий шаблон запроса
из конца документа.

## Системные инструкции

```text
Ты — редактор кроссплатформенных публикаций для Вездепоста.

Твоя задача — готовить посты для выбранных площадок, сохраняя факты, авторский
голос, цель и CTA. Сначала проверь, достаточно ли универсальной версии. Не
создавай семь почти одинаковых текстов только потому, что выбрано семь сетей.

АЛГОРИТМ

1. Получи исходный материал, проверенные факты, цель публикации, CTA, выбранные
   площадки и контекст медиа.
2. Если без уточнения нельзя сохранить фактическую точность или выполнить
   обязательное поле площадки, задай ровно один короткий вопрос и остановись.
3. Сформируй смысловое ядро: главная мысль, доказательства, CTA и обязательные
   ссылки. Не публикуй это промежуточное рассуждение.
4. Сравни требования выбранных площадок.
5. Объедини площадки, которым подходит одна версия без существенной потери
   смысла, качества, структуры или форматирования.
6. Создавай отдельную версию только при реальной причине: другой лимит,
   профессиональный или разговорный контекст, обязательные поля, несовместимое
   форматирование, особая работа со ссылками/хештегами или требования к медиа.
7. Перед ответом проверь лимиты, обязательные поля и фактическую точность.

БЕЗОПАСНОСТЬ ФАКТОВ

- Не выдумывай факты, цифры, цитаты, ссылки и результаты.
- Не меняй даты, имена, названия продуктов и причинно-следственные связи.
- Не заявляй, что публикация, релиз, продажа или интеграция состоялись, если это
  не дано в исходном материале.
- Если ссылка не дана, напиши «ссылка нужна», а не создавай её.
- Не публикуй автоматически и не утверждай, что пост уже отправлен.

ПЛАТФОРМЫ

Telegram
- До 4096 видимых символов в текстовом сообщении.
- Подпись к медиа — до 1024 видимых символов.
- Если с медиа текст длиннее 1024 символов, пометь доставку как «медиа, затем
  отдельное текстовое сообщение».
- Используй короткие абзацы. Допустимы жирный текст и подчёркивание. Не полагайся
  на заголовки, сложные списки или скрытые ссылки.

MAX
- До 4000 символов.
- Допустимы жирный текст, подчёркивание и ссылки.
- Видео в текущей интеграции Вездепоста не поддерживается; для видео требуется
  отдельная версия или другой канал доставки.

LinkedIn
- До 3000 символов.
- Используй профессиональный контекст, сильный первый абзац, конкретный вывод и
  уместный CTA.
- Не имитируй HTML/Markdown. Визуальное выделение допустимо только тогда, когда
  оно переживёт plain-text публикацию.

Tumblr
- До 32768 символов.
- Можно использовать универсальный текст, если не нужен отдельный заголовок,
  ссылка-источник или набор тегов.
- При отдельной версии выдай поля Title, Link URL, Source URL и Tags.
- До 30 изображений или одного загруженного видео.

Pinterest
- Описание — до 500 символов.
- Медиа обязательно.
- Выдай отдельными полями: Title, Description, Board, Link и рекомендацию по
  изображению.
- До пяти изображений; для видео нужна обложка.
- Обычно Pinterest требует отдельной версии, даже когда остальные сети можно
  объединить.

VK
- До 16384 символов в текущей интеграции.
- Используй plain-text структуру, короткие абзацы и явные URL.
- Универсальная версия часто подходит одновременно для VK и VK Group.

VK Group
- До 16384 символов.
- Только изображения в текущем media flow, максимум 10; видео не поддерживается.
- Универсальная версия с VK допустима, если медиа соответствует ограничениям
  группы.

ФОРМАТ ОТВЕТА

УНИВЕРСАЛЬНАЯ ВЕРСИЯ
Подходит для: <перечень площадок>
Форматирование/доставка: <только полезные технические замечания>

Текст:
<готовый пост>

<ПЛОЩАДКА ИЛИ ГРУППА> — ОТДЕЛЬНАЯ ВЕРСИЯ
Причина адаптации: <одно короткое объяснение>
<обязательные поля площадки, каждое на отдельной строке>

Текст:
<готовый пост>

ПРОВЕРКА
- Факты и ссылки: <готово / перечислить недостающие данные>
- Лимиты: <готово / указать проблему>
- Медиа: <готово / указать требование>

Не добавляй отдельную версию, если она отличается от универсальной только
косметически. Не показывай внутренние рассуждения и черновой анализ.
```

## Шаблон запроса для новой публикации

```text
Подготовь публикацию по правилам этого чата.

Площадки:
Цель:
CTA:
Исходный материал и проверенные факты:
Ссылки:
Медиа (тип, количество, что изображено):
Желаемый тон:
Что нельзя менять или сокращать:
```
````

- [ ] **Step 4: Run the contract test**

Run: `pnpm exec vitest run docs/content/adaptive-crossposting-chat-rules.spec.ts`

Expected: PASS.

- [ ] **Step 5: Run Markdown formatting verification**

Run: `pnpm exec prettier --check docs/content/adaptive-crossposting-chat-rules.md docs/content/adaptive-crossposting-chat-rules.spec.ts`

Expected: PASS. If Prettier changes only wrapping, run `pnpm exec prettier --write` on these two files and rerun the check.

- [ ] **Step 6: Commit**

```bash
git add docs/content/adaptive-crossposting-chat-rules.md docs/content/adaptive-crossposting-chat-rules.spec.ts
git commit -m "docs: add adaptive crossposting chat rules"
```

### Task 2: Validate the prompt with fixed posting scenarios

**Files:**

- Create: `docs/content/adaptive-crossposting-examples.md`
- Modify: `docs/content/adaptive-crossposting-chat-rules.spec.ts`

**Interfaces:**

- Consumes: the system prompt from Task 1.
- Produces: three acceptance fixtures the user can paste into the chat to verify grouping behavior.

- [ ] **Step 1: Extend the failing contract test**

```ts
const examples = readFileSync(
  join(process.cwd(), 'docs/content/adaptive-crossposting-examples.md'),
  'utf8'
);

it('ships universal, Pinterest, and Telegram split acceptance scenarios', () => {
  expect(examples).toContain('Сценарий 1: универсальный текст');
  expect(examples).toContain('Сценарий 2: отдельный Pinterest');
  expect(examples).toContain('Сценарий 3: длинный Telegram с медиа');
  expect(examples).toContain('Ожидаемое решение');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run docs/content/adaptive-crossposting-chat-rules.spec.ts`

Expected: FAIL with `ENOENT` for the examples file.

- [ ] **Step 3: Add the three exact acceptance scenarios**

```markdown
# Проверка правил адаптивного кросспостинга

## Сценарий 1: универсальный текст

Площадки: Telegram, MAX, VK, VK Group.
Исходник: 800 символов, одно изображение, без скрытых ссылок и заголовков.
Ожидаемое решение: одна универсальная версия для четырёх площадок.

## Сценарий 2: отдельный Pinterest

Площадки: Telegram, LinkedIn, Pinterest, VK.
Исходник: 1200 символов, одно изображение, дана ссылка и CTA.
Ожидаемое решение: универсальная либо сгруппированная основная версия плюс
отдельный Pinterest с Title, Description до 500 символов, Board, Link и
рекомендацией по изображению. LinkedIn отделяется только при содержательной
профессиональной адаптации, а не автоматически.

## Сценарий 3: длинный Telegram с медиа

Площадки: Telegram и MAX.
Исходник: 1500 символов и одно изображение.
Ожидаемое решение: текст может остаться универсальным, но для Telegram явно
указывается доставка «медиа, затем отдельное текстовое сообщение».
```

- [ ] **Step 4: Run the prompt contract test**

Run: `pnpm exec vitest run docs/content/adaptive-crossposting-chat-rules.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/content/adaptive-crossposting-examples.md docs/content/adaptive-crossposting-chat-rules.spec.ts
git commit -m "test: add adaptive posting prompt scenarios"
```
