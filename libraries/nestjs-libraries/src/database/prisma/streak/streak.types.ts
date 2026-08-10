export type PersonalStreak = {
  days: number;
  timezone: string;
  lastPublishedLocalDate: string | null;
  nextChangeAt: string | null;
};

export type StreakReminderContext = {
  enabled: boolean;
  hasActiveStreak: boolean;
  timezone: import('../users/user-timezone').UserCalendarZone;
};
