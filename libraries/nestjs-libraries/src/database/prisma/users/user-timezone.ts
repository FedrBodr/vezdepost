export type UserCalendarZone =
  | { kind: 'iana'; name: string; label: string }
  | { kind: 'offset'; minutes: number; label: string };

const isOffsetTimeZoneIdentifier = (timeZone: string) =>
  timeZone.startsWith('+') || timeZone.startsWith('-');

export function resolveUserCalendarZone(
  timezoneName: string | null,
  offsetMinutes: number
): UserCalendarZone {
  if (timezoneName) {
    if (isOffsetTimeZoneIdentifier(timezoneName)) {
      throw new RangeError('UTC offset identifiers are not IANA time zones');
    }

    const formatter = new Intl.DateTimeFormat(undefined, {
      timeZone: timezoneName,
    });
    const name = formatter.resolvedOptions().timeZone;

    if (isOffsetTimeZoneIdentifier(name)) {
      throw new RangeError('UTC offset identifiers are not IANA time zones');
    }

    return { kind: 'iana', name, label: name };
  }

  if (offsetMinutes === 0) {
    return { kind: 'iana', name: 'UTC', label: 'UTC' };
  }

  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  const sign = offsetMinutes > 0 ? '+' : '-';

  return {
    kind: 'offset',
    minutes: offsetMinutes,
    label: `UTC${sign}${String(hours).padStart(2, '0')}:${String(
      minutes
    ).padStart(2, '0')}`,
  };
}
