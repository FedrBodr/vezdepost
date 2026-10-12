import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QuickPostDto } from './quick.post.dto';

const check = async (body: unknown) =>
  validate(plainToInstance(QuickPostDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

const valid = {
  text: 'Hi',
  media: [{ id: 'm1', path: 'https://app.test/uploads/a.jpg' }],
  integrationIds: ['vk-1'],
  schedule: { type: 'now' },
};

describe('QuickPostDto', () => {
  it('accepts a valid body', async () => {
    expect(await check(valid)).toEqual([]);
  });

  it('accepts empty text with media and empty media with text', async () => {
    expect(await check({ ...valid, text: '' })).toEqual([]);
    expect(await check({ ...valid, media: [] })).toEqual([]);
  });

  it('rejects an empty integration list', async () => {
    const errors = await check({ ...valid, integrationIds: [] });
    expect(errors.map((e) => e.property)).toEqual(['integrationIds']);
  });

  it('rejects media without a path', async () => {
    const errors = await check({ ...valid, media: [{ id: 'm1' }] });
    expect(errors.map((e) => e.property)).toEqual(['media']);
  });

  it('rejects an unknown schedule type', async () => {
    const errors = await check({ ...valid, schedule: { type: 'later' } });
    expect(errors.map((e) => e.property)).toEqual(['schedule']);
  });

  it('requires a date for schedule type date', async () => {
    const errors = await check({ ...valid, schedule: { type: 'date' } });
    expect(errors.map((e) => e.property)).toEqual(['schedule']);
    expect(
      await check({
        ...valid,
        schedule: { type: 'date', date: '2026-10-20T08:00:00.000Z' },
      })
    ).toEqual([]);
  });
});
