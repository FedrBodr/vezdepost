import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import type { EmailActivity } from '@gitroom/orchestrator/activities/email.activity';

type SerializedSchedule = Awaited<
  ReturnType<EmailActivity['getStreakReminderSchedule']>
>;

function isSameSchedule(first: SerializedSchedule, second: SerializedSchedule) {
  return (
    first.targetLocalDate === second.targetLocalDate &&
    first.reminderAt === second.reminderAt &&
    first.midnightAt === second.midnightAt &&
    first.timezone === second.timezone
  );
}

const { getStreakReminderSchedule, hasPublishedOnLocalDate } =
  proxyActivities<EmailActivity>({
    startToCloseTimeout: '10 minute',
    taskQueue: 'main',
    cancellationType: 'ABANDON',
  });

const { sendStreakReminder } = proxyActivities<EmailActivity>({
  startToCloseTimeout: '10 minute',
  taskQueue: 'main',
  cancellationType: 'ABANDON',
  retry: { maximumAttempts: 1 },
});

export async function personalStreakReminderWorkflow({
  organizationId,
  userId,
}: {
  organizationId: string;
  userId: string;
}): Promise<void> {
  const schedule = await getStreakReminderSchedule(organizationId, userId);
  if (
    !schedule.enabled ||
    !schedule.active ||
    !schedule.targetLocalDate ||
    !schedule.reminderAt ||
    !schedule.midnightAt
  ) {
    return;
  }

  await sleep(Math.max(0, Date.parse(schedule.reminderAt) - Date.now()));

  const currentSchedule = await getStreakReminderSchedule(
    organizationId,
    userId
  );
  if (!currentSchedule.enabled || !currentSchedule.active) {
    return;
  }
  if (!isSameSchedule(schedule, currentSchedule)) {
    await continueAsNew<typeof personalStreakReminderWorkflow>({
      organizationId,
      userId,
    });
    return;
  }

  const publishedAtReminder = await hasPublishedOnLocalDate(
    organizationId,
    userId,
    schedule.targetLocalDate
  );
  if (!publishedAtReminder) {
    await sendStreakReminder(organizationId, userId, schedule.targetLocalDate);
  }

  await sleep(Math.max(0, Date.parse(schedule.midnightAt) - Date.now()));
  const publishedAtMidnight = await hasPublishedOnLocalDate(
    organizationId,
    userId,
    schedule.targetLocalDate
  );
  if (!publishedAtMidnight) {
    return;
  }

  await continueAsNew<typeof personalStreakReminderWorkflow>({
    organizationId,
    userId,
  });
  return;
}
