import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { DatabaseModule } from '../database.module';
import { StreakRepository } from './streak.repository';
import { StreakService } from './streak.service';

describe('DatabaseModule streak providers', () => {
  it('registers and exports the streak repository and service', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      DatabaseModule
    );
    const exports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      DatabaseModule
    );

    expect(providers).toEqual(
      expect.arrayContaining([StreakRepository, StreakService])
    );
    expect(exports).toEqual(
      expect.arrayContaining([StreakRepository, StreakService])
    );
  });
});
