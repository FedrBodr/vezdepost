import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const rules = readFileSync(
  join(process.cwd(), 'docs/content/adaptive-crossposting-chat-rules.md'),
  'utf8'
);
const examples = readFileSync(
  join(process.cwd(), 'docs/content/adaptive-crossposting-examples.md'),
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

  it('ships universal, Pinterest, and Telegram split acceptance scenarios', () => {
    expect(examples).toContain('Сценарий 1: универсальный текст');
    expect(examples).toContain('Сценарий 2: отдельный Pinterest');
    expect(examples).toContain('Сценарий 3: длинный Telegram с медиа');
    expect(examples).toContain('Ожидаемое решение');
  });
});
