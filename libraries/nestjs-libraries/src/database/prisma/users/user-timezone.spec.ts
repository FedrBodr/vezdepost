import { validateSync } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { UserTimezoneDto } from '../../../dtos/users/user-timezone.dto';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { resolveUserCalendarZone } from './user-timezone';

describe('resolveUserCalendarZone', () => {
  it('resolves a stored IANA time zone', () => {
    expect(resolveUserCalendarZone('Europe/Moscow', 0)).toEqual({
      kind: 'iana',
      name: 'Europe/Moscow',
      label: 'Europe/Moscow',
    });
    expect(resolveUserCalendarZone('America/New_York', 0).kind).toBe('iana');
  });

  it('rejects an invalid stored IANA time zone', () => {
    expect(() => resolveUserCalendarZone('Mars/Olympus', 0)).toThrow();
  });

  it('falls back to a legacy fractional UTC offset', () => {
    expect(resolveUserCalendarZone(null, 330)).toEqual({
      kind: 'offset',
      minutes: 330,
      label: 'UTC+05:30',
    });
  });

  it('uses IANA UTC as the final fallback', () => {
    expect(resolveUserCalendarZone(null, 0)).toEqual({
      kind: 'iana',
      name: 'UTC',
      label: 'UTC',
    });
  });
});

describe('UserTimezoneDto', () => {
  it.each(['', 'x'.repeat(256)])(
    'rejects an empty or overlong time zone: %s',
    (timezoneName) => {
      const dto = Object.assign(new UserTimezoneDto(), { timezoneName });

      expect(validateSync(dto)).not.toHaveLength(0);
    }
  );
});

describe('UsersRepository.updateTimezone', () => {
  it('updates only the stored IANA time-zone name', () => {
    const model = { user: { update: vi.fn() } };
    const repository = new UsersRepository({ model } as any);

    repository.updateTimezone('user-1', 'Europe/Moscow');

    expect(model.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { timezoneName: 'Europe/Moscow' },
      select: { timezoneName: true },
    });
  });
});

describe('UsersService.updateTimezone', () => {
  it('rejects an empty time zone before persistence', () => {
    const repository = { updateTimezone: vi.fn() };
    const service = new UsersService(repository as any, {} as any);

    expect(() => service.updateTimezone('user-1', '')).toThrow();
    expect(repository.updateTimezone).not.toHaveBeenCalled();
  });

  it('rejects an invalid IANA time zone before persistence', () => {
    const repository = { updateTimezone: vi.fn() };
    const service = new UsersService(repository as any, {} as any);

    expect(() => service.updateTimezone('user-1', 'Mars/Olympus')).toThrow();
    expect(repository.updateTimezone).not.toHaveBeenCalled();
  });

  it('persists a valid IANA time zone', () => {
    const repository = { updateTimezone: vi.fn() };
    const service = new UsersService(repository as any, {} as any);

    service.updateTimezone('user-1', 'Europe/Moscow');

    expect(repository.updateTimezone).toHaveBeenCalledWith(
      'user-1',
      'Europe/Moscow'
    );
  });
});
