import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { DatabaseModule } from '../database.module';
import { StreakRepository } from './streak.repository';
import { StreakService } from './streak.service';
import { PersonalStreakReminderStarter } from '../../../temporal/personal-streak-reminder.starter';
import { PersonalStreakReminderModule } from '../../../temporal/personal-streak-reminder.module';

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

  it('keeps Temporal reminder providers out of the database module', () => {
    const databaseProviders = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      DatabaseModule
    );
    const reminderProviders = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      PersonalStreakReminderModule
    );
    const reminderExports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      PersonalStreakReminderModule
    );

    expect(databaseProviders).not.toContain(PersonalStreakReminderStarter);
    expect(reminderProviders).toContain(PersonalStreakReminderStarter);
    expect(reminderExports).toContain(PersonalStreakReminderStarter);
  });
});
