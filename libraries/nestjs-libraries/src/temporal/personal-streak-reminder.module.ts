import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/prisma/database.module';
import { PersonalStreakReminderStarter } from './personal-streak-reminder.starter';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [PersonalStreakReminderStarter],
  exports: [PersonalStreakReminderStarter],
})
export class PersonalStreakReminderModule {}
