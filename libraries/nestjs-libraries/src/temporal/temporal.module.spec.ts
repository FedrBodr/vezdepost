import { hostname } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  register: vi.fn((config) => config),
}));

vi.mock('nestjs-temporal-core', () => ({
  TemporalModule: { register: mocks.register },
}));

vi.mock(
  '@gitroom/nestjs-libraries/integrations/integration.manager',
  () => ({ socialIntegrationList: [] })
);

import { getTemporalModule } from './temporal.module';

describe('getTemporalModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('configures workers with the identity reported by orchestrator health', () => {
    getTemporalModule(true, '/workflows', []);

    const config = mocks.register.mock.calls[0][0];
    const mainWorker = config.workers.find(
      (worker: { taskQueue: string }) => worker.taskQueue === 'main'
    );

    expect(mainWorker.workerOptions.identity).toBe(
      `${process.pid}@${hostname()}`
    );
  });
});
