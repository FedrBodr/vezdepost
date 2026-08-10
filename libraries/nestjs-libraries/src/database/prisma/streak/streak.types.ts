export type PersonalStreak = {
  days: number;
  timezone: string;
  lastPublishedLocalDate: string | null;
  nextChangeAt: string | null;
};

export type StreakReminderSchedule = {
  enabled: boolean;
  active: boolean;
  targetLocalDate: string | null;
  reminderAt: string | null;
  midnightAt: string | null;
};
