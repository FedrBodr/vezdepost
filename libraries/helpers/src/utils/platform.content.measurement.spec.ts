import { describe, expect, it } from 'vitest';
import { measureContent } from './platform.content.measurement';

describe('measureContent', () => {
  it.each([
    ['graphemes', '👨‍👩‍👧‍👦a', 2],
    ['utf16-code-units', '😀a', 3],
    ['utf8-bytes', '😀a', 5],
  ] as const)('measures %s exactly', (unit, value, measured) => {
    expect(
      measureContent(value, { max: measured, unit, source: 'platform' })
    ).toEqual({ measured, exceeded: false });
  });

  it('delegates weighted limits to the declared counter', () => {
    expect(
      measureContent('https://example.com/' + 'x'.repeat(80), {
        max: 280,
        unit: 'weighted',
        counter: 'x-weighted',
        source: 'runtime',
      }).measured
    ).toBeLessThan(105);
  });
});
