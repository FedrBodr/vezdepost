import { describe, expect, it } from 'vitest';
import {
  draftProblem,
  emptyDraft,
  localDateTimeToIso,
  toQuickPostBody,
} from './quick.post.request';

const valid = () => ({
  ...emptyDraft(),
  text: 'Привет',
  selected: ['vk-1'],
});

describe('draftProblem', () => {
  it('accepts text with a channel, or media with a channel', () => {
    expect(draftProblem(valid())).toBeNull();
    expect(
      draftProblem({
        ...valid(),
        text: '',
        media: [{ id: 'm', path: '/a.jpg' }],
      })
    ).toBeNull();
  });

  it('refuses an empty post and a post without channels', () => {
    expect(draftProblem({ ...valid(), text: '   ' })).toBe(
      'Добавьте текст или фото'
    );
    expect(draftProblem({ ...valid(), selected: [] })).toBe(
      'Выберите хотя бы один канал'
    );
  });

  it('refuses a dated post without a date', () => {
    expect(
      draftProblem({ ...valid(), schedule: { type: 'date', date: '' } })
    ).toBe('Выберите дату');
  });
});

describe('toQuickPostBody', () => {
  it('maps the draft to the /posts/quick body', () => {
    expect(
      toQuickPostBody({
        ...valid(),
        media: [{ id: 'm1', path: '/a.jpg' }],
        selected: ['vk-1', 'tg-1'],
        schedule: { type: 'date', date: '2026-10-20T08:00:00.000Z' },
      })
    ).toEqual({
      text: 'Привет',
      media: [{ id: 'm1', path: '/a.jpg' }],
      integrationIds: ['vk-1', 'tg-1'],
      schedule: { type: 'date', date: '2026-10-20T08:00:00.000Z' },
    });
    expect(toQuickPostBody(valid()).schedule).toEqual({ type: 'now' });
  });
});

describe('localDateTimeToIso', () => {
  it('converts a datetime-local value to an ISO string', () => {
    const iso = localDateTimeToIso('2026-10-20T08:30');
    expect(new Date(iso).getFullYear()).toBe(2026);
    expect(iso.endsWith('Z')).toBe(true);
    expect(new Date(iso).getMinutes()).toBe(
      new Date('2026-10-20T08:30').getMinutes()
    );
  });
});
