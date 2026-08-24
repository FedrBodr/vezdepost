import { beforeEach, describe, expect, it, vi } from 'vitest';

const { headersMock, cookiesMock } = vi.hoisted(() => ({
  headersMock: vi.fn(),
  cookiesMock: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: headersMock,
  cookies: cookiesMock,
}));

import { getRequestLanguage } from './get.request.language';

describe('getRequestLanguage', () => {
  beforeEach(() => {
    headersMock.mockReset();
    cookiesMock.mockReset();
    headersMock.mockResolvedValue({ get: vi.fn().mockReturnValue(null) });
    cookiesMock.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) });
  });

  it('uses the normalized proxy header first', async () => {
    headersMock.mockResolvedValue({ get: vi.fn().mockReturnValue('ru') });
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'en' }),
    });
    await expect(getRequestLanguage()).resolves.toBe('ru');
  });

  it('uses a valid cookie when the proxy header is unavailable', async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'ar' }),
    });
    await expect(getRequestLanguage()).resolves.toBe('ar');
  });

  it('falls back to English for invalid or missing request state', async () => {
    headersMock.mockResolvedValue({ get: vi.fn().mockReturnValue('invalid') });
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'bn' }),
    });
    await expect(getRequestLanguage()).resolves.toBe('en');
  });
});
