import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller';

const response = () => {
  const res: any = {};
  res.cookie = vi.fn(() => res);
  res.header = vi.fn(() => res);
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
};

const setup = () => {
  const authService = {
    getOrgFromCookie: vi.fn(() => false),
    routeAuth: vi.fn(async (..._args: unknown[]) => ({
      jwt: 'jwt',
      addedOrg: false,
    })),
  };
  const emailService = { hasProvider: vi.fn(() => false) };
  const controller = new AuthController(
    authService as any,
    emailService as any
  );
  return { controller, authService };
};

const cookie = JSON.stringify({
  src: 'landing',
  ref: 'https://www.google.com/',
  path: '/?utm_source=vk',
  utm: { utm_source: 'vk', injected: 'x' },
  at: '2026-09-22T09:00:00.000Z',
});
const expected = {
  src: 'landing',
  ref: 'https://www.google.com/',
  path: '/?utm_source=vk',
  utm: { utm_source: 'vk' },
  at: '2026-09-22T09:00:00.000Z',
};

describe('AuthController first touch', () => {
  it('passes the sanitized first-touch cookie on provider login (Google/VK sign-up path)', async () => {
    const { controller, authService } = setup();
    await controller.login(
      { cookies: { vp_first_touch: cookie } } as any,
      { provider: 'GOOGLE' } as any,
      response(),
      '1.2.3.4',
      'agent'
    );

    expect(authService.routeAuth).toHaveBeenCalledWith(
      'GOOGLE',
      { provider: 'GOOGLE' },
      '1.2.3.4',
      'agent',
      false,
      expected
    );
  });

  it('passes it on email registration and tolerates a missing cookie', async () => {
    const { controller, authService } = setup();
    await controller.register(
      { cookies: { vp_first_touch: cookie } } as any,
      { provider: 'LOCAL' } as any,
      response(),
      '1.2.3.4',
      'agent'
    );
    await controller.register(
      { cookies: {} } as any,
      { provider: 'LOCAL' } as any,
      response(),
      '1.2.3.4',
      'agent'
    );

    expect(authService.routeAuth.mock.calls[0][5]).toEqual(expected);
    expect(authService.routeAuth.mock.calls[1][5]).toBeUndefined();
  });
});
