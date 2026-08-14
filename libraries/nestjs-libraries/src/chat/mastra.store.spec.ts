import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('RetryablePostgresStore', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.DATABASE_URL =
      'postgresql://postiz:postiz@127.0.0.1:5432/postiz-test';
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    vi.resetModules();
  });

  it('clears Mastra composite initialization state after a failed attempt', async () => {
    const { RetryablePostgresStore } = await import('./mastra.store');
    const store = new RetryablePostgresStore({
      id: 'retry-test',
      connectionString: process.env.DATABASE_URL!,
    });
    const initDomain = vi
      .fn()
      .mockRejectedValueOnce(new Error('schema creation failed'))
      .mockResolvedValueOnce(undefined);

    (store as any).stores = { memory: { init: initDomain } };

    await expect(store.init()).rejects.toThrow('schema creation failed');
    await expect(store.init()).resolves.toBeUndefined();

    expect(initDomain).toHaveBeenCalledTimes(2);
    await store.close();
  });
});
