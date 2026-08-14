import { hostname } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  describeNamespace: vi.fn(),
  close: vi.fn(),
  getWorkerStatusByTaskQueue: vi.fn(),
}));

vi.mock('@temporalio/client', () => ({
  Connection: {
    connect: mocks.connect,
  },
}));

import { HealthController } from './health.controller';

describe('HealthController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.describeNamespace.mockResolvedValue({});
    mocks.close.mockResolvedValue(undefined);
    mocks.connect.mockResolvedValue({
      workflowService: { describeNamespace: mocks.describeNamespace },
      close: mocks.close,
    });
    mocks.getWorkerStatusByTaskQueue.mockReturnValue({
      taskQueue: 'main',
      isInitialized: true,
      isRunning: true,
      isHealthy: true,
    });
  });

  it('reports the exact Temporal worker identity of this process', async () => {
    const response = {
      status: vi.fn(),
      json: vi.fn(),
    };
    response.status.mockReturnValue(response);

    await new HealthController({
      getWorkerStatusByTaskQueue: mocks.getWorkerStatusByTaskQueue,
    } as any).getHealthStatus(response as any);

    expect(mocks.getWorkerStatusByTaskQueue).toHaveBeenCalledWith('main');
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      status: 'ok',
      workerIdentity: `${process.pid}@${hostname()}`,
    });
  });

  it('fails closed when the main worker is stopped', async () => {
    mocks.getWorkerStatusByTaskQueue.mockReturnValue({
      taskQueue: 'main',
      isInitialized: true,
      isRunning: false,
      isHealthy: false,
      lastError: 'worker stopped',
    });
    const response = {
      status: vi.fn(),
      json: vi.fn(),
    };
    response.status.mockReturnValue(response);

    await new HealthController({
      getWorkerStatusByTaskQueue: mocks.getWorkerStatusByTaskQueue,
    } as any).getHealthStatus(response as any);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' })
    );
  });
});
