import { describe, expect, it } from 'vitest';
import { shouldCompress, sizeProblem, targetSize } from './image.compression';

const MB = 1024 * 1024;

describe('shouldCompress', () => {
  it('compresses a large phone photo', () => {
    expect(shouldCompress({ type: 'image/jpeg', size: 6 * MB })).toBe(true);
    expect(
      shouldCompress({ type: 'image/jpeg', size: 1 * MB }, 4000, 3000)
    ).toBe(true);
  });

  it('leaves small images, GIFs and videos alone', () => {
    expect(
      shouldCompress({ type: 'image/png', size: 300 * 1024 }, 1200, 800)
    ).toBe(false);
    expect(shouldCompress({ type: 'image/gif', size: 8 * MB })).toBe(false);
    expect(shouldCompress({ type: 'video/mp4', size: 50 * MB })).toBe(false);
  });
});

describe('targetSize', () => {
  it('scales the long side down to 2048 and keeps the ratio', () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 2048, height: 1536 });
    expect(targetSize(1000, 2000)).toEqual({ width: 1000, height: 2000 });
    expect(targetSize(1000, 4096)).toEqual({ width: 500, height: 2048 });
  });
});

describe('sizeProblem', () => {
  it('explains the limit for oversized files and unsupported types', () => {
    expect(sizeProblem({ type: 'image/jpeg', size: 11 * MB })).toBe(
      'Фото больше 10 МБ'
    );
    expect(sizeProblem({ type: 'video/mp4', size: 2 * 1024 * MB })).toBe(
      'Видео больше 1 ГБ'
    );
    expect(sizeProblem({ type: 'application/pdf', size: 1 })).toBe(
      'Можно только фото или видео'
    );
    expect(sizeProblem({ type: 'video/mp4', size: 20 * MB })).toBeNull();
  });
});
