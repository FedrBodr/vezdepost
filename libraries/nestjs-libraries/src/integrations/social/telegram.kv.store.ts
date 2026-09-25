import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

export type KeyValueStore = {
  get(key: string): Promise<string | null | undefined>;
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

/** Test/dev store; honours NX, ignores expiry. */
export class MemoryKeyValueStore implements KeyValueStore {
  private readonly data = new Map<string, string>();

  async get(key: string) {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  async set(key: string, value: string, ...args: Array<string | number>) {
    if (args.includes('NX') && this.data.has(key)) {
      return null;
    }
    this.data.set(key, value);
    return 'OK';
  }

  async del(key: string) {
    return this.data.delete(key) ? 1 : 0;
  }
}

export const redisKeyValueStore = ioRedis as unknown as KeyValueStore;
