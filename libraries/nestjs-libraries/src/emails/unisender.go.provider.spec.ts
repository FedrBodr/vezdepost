import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnisenderGoProvider } from './unisender.go.provider';

const fetchMock = vi.fn();

describe('UnisenderGoProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('UNISENDER_GO_API_KEY', 'test-key');
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns the API result and defaults to the go1 cluster', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', job_id: 'job-1' }),
    });

    const result = await new UnisenderGoProvider().sendEmail(
      'user@example.com',
      'Привет',
      '<p>hi</p>',
      'Дмитрий из Vezdepost',
      'hello@vezdepost.ru',
      'owner@example.com'
    );

    expect(result).toEqual({ status: 'success', job_id: 'job-1' });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://go1.unisender.ru/ru/transactional/api/v1/email/send.json'
    );
  });

  it('uses the account cluster host when it is set', async () => {
    vi.stubEnv('UNISENDER_GO_HOST', 'go2.unisender.ru');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success' }),
    });

    await new UnisenderGoProvider().sendEmail(
      'user@example.com',
      'Subject',
      '<p>hi</p>',
      'Name',
      'hello@vezdepost.ru',
      'owner@example.com'
    );

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://go2.unisender.ru/ru/transactional/api/v1/email/send.json'
    );
  });

  it('sends the payload with the API key', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success' }),
    });

    await new UnisenderGoProvider().sendEmail(
      'user@example.com',
      'Привет',
      '<p>hi</p>',
      'Дмитрий из Vezdepost',
      'hello@vezdepost.ru',
      'owner@example.com'
    );
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers['X-API-KEY']).toBe('test-key');
    expect(JSON.parse(init.body)).toEqual({
      message: {
        recipients: [{ email: 'user@example.com' }],
        subject: 'Привет',
        from_email: 'hello@vezdepost.ru',
        from_name: 'Дмитрий из Vezdepost',
        body: { html: '<p>hi</p>' },
        reply_to: 'owner@example.com',
      },
    });
  });

  it('omits reply-to when it is not given', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success' }),
    });

    await new UnisenderGoProvider().sendEmail(
      'user@example.com',
      'Subject',
      '<p>hi</p>',
      'Name',
      'hello@vezdepost.ru'
    );

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).message).not.toHaveProperty(
      'reply_to'
    );
  });

  it('throws on an API error so the send is retried', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ status: 'error', code: 102, message: 'bad key' }),
    });

    await expect(
      new UnisenderGoProvider().sendEmail(
        'user@example.com',
        'Subject',
        '<p>hi</p>',
        'Name',
        'hello@vezdepost.ru'
      )
    ).rejects.toThrow('Unisender Go 401: bad key');
  });
});
