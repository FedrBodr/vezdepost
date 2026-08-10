import { proxyActivities, sleep } from '@temporalio/workflow';
import type { EmailActivity } from '@gitroom/orchestrator/activities/email.activity';
import {
  getLocalCalendarDate,
  getUtcAtLocalTime,
  shiftCalendarDate,
} from '@gitroom/nestjs-libraries/database/prisma/streak/streak.calculator';

const {
  getStreakReminderContext,
  hasPublishedOnLocalDate,
  sendStreakReminder,
} = proxyActivities<EmailActivity>({
  startToCloseTimeout: '10 minute',
  taskQueue: 'main',
  cancellationType: 'ABANDON',
});

export async function personalStreakReminderWorkflow({
  organizationId,
  userId,
}: {
  organizationId: string;
  userId: string;
}) {
  const initialContext = await getStreakReminderContext(organizationId, userId);
  if (!initialContext.enabled || !initialContext.hasActiveStreak) {
    return;
  }

  const now = new Date();
  const targetLocalDate = shiftCalendarDate(
    getLocalCalendarDate(now, initialContext.timezone),
    1
  );
  const reminderAt = getUtcAtLocalTime(
    targetLocalDate,
    22,
    0,
    initialContext.timezone
  );
  await sleep(Math.max(0, reminderAt.getTime() - now.getTime()));

  const reminderContext = await getStreakReminderContext(
    organizationId,
    userId
  );
  if (!reminderContext.enabled || !reminderContext.hasActiveStreak) {
    return;
  }

  if (await hasPublishedOnLocalDate(organizationId, userId, targetLocalDate)) {
    return;
  }

  await sendStreakReminder(organizationId, userId, targetLocalDate);

  const dayAfterTarget = shiftCalendarDate(targetLocalDate, 1);
  const midnightAt = getUtcAtLocalTime(
    dayAfterTarget,
    0,
    0,
    initialContext.timezone
  );
  await sleep(Math.max(0, midnightAt.getTime() - new Date().getTime()));
  await hasPublishedOnLocalDate(organizationId, userId, targetLocalDate);
}
