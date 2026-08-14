import { describe, expect, it } from 'vitest';
import { TemporalWorkerManagerService } from 'nestjs-temporal-core';

describe('installed Temporal worker status', () => {
  it('is unhealthy when native state is stopped even before the running flag changes', () => {
    const manager = new TemporalWorkerManagerService(
      {} as any,
      { enableLogger: false } as any,
      null
    );

    (manager as any).workers.set('main', {
      worker: { getState: () => 'STOPPED' },
      taskQueue: 'main',
      namespace: 'default',
      isRunning: true,
      isInitialized: true,
      lastError: null,
      startedAt: new Date(),
      restartCount: 0,
      activities: new Map(),
      workflowSource: 'filesystem',
    });

    expect(manager.getWorkerStatusByTaskQueue('main')).toMatchObject({
      isInitialized: true,
      isRunning: true,
      isHealthy: false,
    });
  });
});
