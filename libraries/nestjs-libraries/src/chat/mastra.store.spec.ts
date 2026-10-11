import { describe, expect, it, vi } from 'vitest';

// The real PostgresStore pins a pool connection before initializing, so the
// base class is replaced by one that caches its init promise the way
// MastraCompositeStore does; the test covers only our retry override.
vi.mock('@mastra/pg', () => ({
  PostgresStore: class {
    hasInitialized: Promise<void> | null = null;
    stores: Record<string, { init: () => Promise<void> }> = {};
    constructor(_config: unknown) {}
    async init() {
      this.hasInitialized ??= Promise.all(
        Object.values(this.stores).map((store) => store.init())
      ).then(() => undefined);
      await this.hasInitialized;
    }
  },
}));

describe('RetryablePostgresStore', () => {
  it('clears Mastra composite initialization state after a failed attempt', async () => {
    const { RetryablePostgresStore } = await import('./mastra.store');
    const store = new RetryablePostgresStore({
      id: 'retry-test',
      connectionString: 'postgresql://postiz:postiz@127.0.0.1:5432/postiz-test',
    });
    const initDomain = vi
      .fn()
      .mockRejectedValueOnce(new Error('schema creation failed'))
      .mockResolvedValueOnce(undefined);

    (store as any).stores = { memory: { init: initDomain } };

    await expect(store.init()).rejects.toThrow('schema creation failed');
    await expect(store.init()).resolves.toBeUndefined();

    expect(initDomain).toHaveBeenCalledTimes(2);
  });
});
