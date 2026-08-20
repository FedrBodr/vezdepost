/// <reference lib="es2022.intl" />

import { weightedLength } from './count.length';
import type { ContentLimit } from './platform.capability.types';

export const measureContent = (
  value: string,
  limit: ContentLimit
): { measured: number; exceeded: boolean } => {
  let measured: number;

  switch (limit.unit) {
    case 'graphemes':
      measured = Array.from(
        new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
          value
        )
      ).length;
      break;
    case 'utf16-code-units':
      measured = value.length;
      break;
    case 'utf8-bytes':
      measured = new TextEncoder().encode(value).length;
      break;
    case 'weighted':
      if (limit.counter !== 'x-weighted') {
        throw new Error(
          'Weighted content limit requires a supported counter'
        );
      }
      measured = weightedLength(value);
      break;
  }

  return { measured, exceeded: measured > limit.max };
};
