import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  agent: vi.fn(),
  mastraConfigs: [] as unknown[],
}));

vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', () => ({
  pStore: { init: mocks.init },
}));

vi.mock('@gitroom/nestjs-libraries/chat/load.tools.service', () => ({
  LoadToolsService: class LoadToolsService {},
}));

vi.mock('@mastra/core/logger', () => ({
  ConsoleLogger: class ConsoleLogger {},
}));

vi.mock('@mastra/core/mastra', () => ({
  Mastra: class Mastra {
    constructor(config: unknown) {
      mocks.mastraConfigs.push(config);
    }
  },
}));

import { MastraService } from './mastra.service';

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('MastraService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mastraConfigs.length = 0;
    (MastraService as any).mastra = undefined;
    (MastraService as any).mastraPromise = undefined;
  });

  it('shares one store initialization and Mastra instance across concurrent callers', async () => {
    const init = deferred<void>();
    mocks.init.mockReturnValue(init.promise);
    mocks.agent.mockResolvedValue({ id: 'postiz-agent' });
    const service = new MastraService({ agent: mocks.agent } as any);

    const first = service.mastra();
    const second = service.mastra();

    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.agent).not.toHaveBeenCalled();

    init.resolve();
    const [firstMastra, secondMastra] = await Promise.all([first, second]);

    expect(firstMastra).toBe(secondMastra);
    expect(mocks.agent).toHaveBeenCalledTimes(1);
    expect(mocks.mastraConfigs).toHaveLength(1);
  });

  it('clears a rejected attempt so a later call can retry', async () => {
    mocks.init
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined);
    mocks.agent.mockResolvedValue({ id: 'postiz-agent' });
    const service = new MastraService({ agent: mocks.agent } as any);

    await expect(service.mastra()).rejects.toThrow('storage unavailable');
    await Promise.resolve();
    await expect(service.mastra()).resolves.toBeDefined();

    expect(mocks.init).toHaveBeenCalledTimes(2);
    expect(mocks.agent).toHaveBeenCalledTimes(1);
  });
});
