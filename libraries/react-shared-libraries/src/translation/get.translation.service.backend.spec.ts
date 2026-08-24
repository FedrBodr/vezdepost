import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getRequestLanguageMock } = vi.hoisted(() => ({
  getRequestLanguageMock: vi.fn(),
}));

vi.mock('./get.request.language', () => ({
  getRequestLanguage: getRequestLanguageMock,
}));

import { getT } from './get.translation.service.backend';

describe('getT', () => {
  beforeEach(() => {
    getRequestLanguageMock.mockReset();
  });

  it('returns request-fixed translators without changing global language', async () => {
    getRequestLanguageMock
      .mockResolvedValueOnce('ru')
      .mockResolvedValueOnce('en');

    const [russianT, englishT] = await Promise.all([getT(), getT()]);

    expect(russianT('sign_up')).toBe('Зарегистрироваться');
    expect(englishT('sign_up')).toBe('Sign Up');
  });
});
