import { describe, expect, it } from 'vitest';
import { textSlicer } from './count.length';

describe('textSlicer', () => {
  it('returns an exclusive X boundary for ASCII text', () => {
    const text = 'abcdefghijk';
    const { start, end } = textSlicer('x', 10, text);

    expect(text.slice(start, end)).toBe('abcdefghij');
    expect(text.slice(end)).toBe('k');
  });

  it('returns an exclusive UTF-16 boundary without splitting an emoji', () => {
    const text = `${'😀'.repeat(5)}x`;
    const { start, end } = textSlicer('x', 10, text);

    expect(end).toBe(10);
    expect(text.slice(start, end)).toBe('😀'.repeat(5));
    expect(text.slice(end)).toBe('x');
  });

  it('keeps the existing exclusive boundary for non-X integrations', () => {
    expect(textSlicer('linkedin', 10, 'abcdefghijk')).toEqual({
      start: 0,
      end: 10,
    });
  });
});
