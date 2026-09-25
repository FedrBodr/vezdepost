import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TelegramStoriesDto } from './telegram.stories.dto';
import { getValidationSchemas } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';
import { allProviders } from './all.providers.settings';
import { PLATFORM_CAPABILITY_PROFILES } from '@gitroom/helpers/utils/platform.capability.profiles';

const errors = (value: unknown) =>
  validateSync(plainToInstance(TelegramStoriesDto, value));

describe('TelegramStoriesDto', () => {
  it('accepts lifetime and positional frames', () => {
    expect(
      errors({
        active_period: '43200',
        frames: [{ text: 'none' }, { text: 'custom', caption: 'Hi' }],
      })
    ).toHaveLength(0);
  });

  it.each([{ active_period: '3600' }, { frames: [{ text: 'all' }] }])(
    'rejects %j',
    (value) => {
      expect(errors(value).length).toBeGreaterThan(0);
    }
  );

  it('is registered for the editor and MCP', () => {
    expect(
      allProviders().find((p) => p.name === 'telegram-stories')?.value
    ).toBe(TelegramStoriesDto);
    const schema = getValidationSchemas()['TelegramStoriesDto'] as any;
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['active_period', 'frames'])
    );
  });

  it('has a capability profile requiring media', () => {
    const profile = (PLATFORM_CAPABILITY_PROFILES as any)['telegram-stories'];
    expect(profile.variants.story.media.type).toBe('required');
    expect(profile.variants.story.fields[0].limit.max).toBe(2048);
  });
});
