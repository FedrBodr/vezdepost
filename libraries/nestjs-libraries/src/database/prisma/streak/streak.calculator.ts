import type { UserCalendarZone } from '../users/user-timezone';
import type { PersonalStreak } from './streak.types';

type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

type CalendarDateTimeParts = CalendarDateParts & {
  hour: number;
  minute: number;
  second: number;
};

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function formatCalendarDate({ year, month, day }: CalendarDateParts) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(
    2,
    '0'
  )}-${String(day).padStart(2, '0')}`;
}

function formatCalendarDateTime({
  year,
  month,
  day,
  hour,
  minute,
  second,
}: CalendarDateTimeParts) {
  return `${formatCalendarDate({ year, month, day })}T${String(hour).padStart(
    2,
    '0'
  )}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function parseCalendarDate(value: string): CalendarDateParts | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month - 1 ||
    date.getUTCDate() !== parts.day
  ) {
    return null;
  }

  return parts;
}

export function shiftCalendarDate(value: string, days: number) {
  const parts = parseCalendarDate(value);
  if (!parts) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);

  return formatCalendarDate({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

function getIanaDateTimeParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const values = new Map(
    formatter
      .formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)])
  );

  return {
    year: values.get('year')!,
    month: values.get('month')!,
    day: values.get('day')!,
    hour: values.get('hour')!,
    minute: values.get('minute')!,
    second: values.get('second')!,
  } satisfies CalendarDateTimeParts;
}

export function getLocalCalendarDate(date: Date, timezone: UserCalendarZone) {
  if (timezone.kind === 'offset') {
    const localDate = new Date(date.getTime() + timezone.minutes * 60_000);
    return formatCalendarDate({
      year: localDate.getUTCFullYear(),
      month: localDate.getUTCMonth() + 1,
      day: localDate.getUTCDate(),
    });
  }

  return formatCalendarDate(getIanaDateTimeParts(date, timezone.name));
}

export function getUtcAtLocalTime(
  calendarDate: string,
  hour: number,
  minute: number,
  timezone: UserCalendarZone
) {
  const parts = parseCalendarDate(calendarDate);
  if (!parts) {
    throw new RangeError(`Invalid calendar date: ${calendarDate}`);
  }
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    throw new RangeError(`Invalid local time: ${hour}:${minute}`);
  }

  if (timezone.kind === 'offset') {
    return new Date(
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        hour,
        minute - timezone.minutes
      )
    );
  }

  const target = formatCalendarDateTime({
    ...parts,
    hour,
    minute,
    second: 0,
  });
  let lowerBound = Date.UTC(parts.year, parts.month - 1, parts.day - 3);
  let upperBound = Date.UTC(parts.year, parts.month - 1, parts.day + 3);

  while (lowerBound < upperBound) {
    const candidate = lowerBound + Math.floor((upperBound - lowerBound) / 2);
    const candidateLocalDateTime = formatCalendarDateTime(
      getIanaDateTimeParts(new Date(candidate), timezone.name)
    );

    if (candidateLocalDateTime < target) {
      lowerBound = candidate + 1;
    } else {
      upperBound = candidate;
    }
  }

  return new Date(lowerBound);
}

function getUtcAtLocalMidnight(
  calendarDate: string,
  timezone: UserCalendarZone
) {
  return getUtcAtLocalTime(calendarDate, 0, 0, timezone);
}

function normalizeDates(localDates: string[]) {
  return [
    ...new Set(localDates.filter((value) => parseCalendarDate(value) !== null)),
  ].sort((left, right) => right.localeCompare(left));
}

export function calculatePersonalStreak(
  localDates: string[],
  now: Date,
  timezone: UserCalendarZone
): PersonalStreak {
  const dates = normalizeDates(localDates);
  const latest = dates[0] ?? null;

  if (!latest) {
    return {
      days: 0,
      timezone: timezone.label,
      lastPublishedLocalDate: null,
      nextChangeAt: null,
    };
  }

  const today = getLocalCalendarDate(now, timezone);
  const yesterday = shiftCalendarDate(today, -1);

  if (latest !== today && latest !== yesterday) {
    return {
      days: 0,
      timezone: timezone.label,
      lastPublishedLocalDate: latest,
      nextChangeAt: null,
    };
  }

  const dateSet = new Set(dates);
  let days = 0;
  let currentDate = latest;

  while (dateSet.has(currentDate)) {
    days += 1;
    currentDate = shiftCalendarDate(currentDate, -1);
  }

  const expiryDate = shiftCalendarDate(today, latest === today ? 2 : 1);

  return {
    days,
    timezone: timezone.label,
    lastPublishedLocalDate: latest,
    nextChangeAt: getUtcAtLocalMidnight(expiryDate, timezone).toISOString(),
  };
}
