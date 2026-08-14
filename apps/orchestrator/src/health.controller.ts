import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { Connection } from '@temporalio/client';
import { getTemporalWorkerIdentity } from '@gitroom/nestjs-libraries/temporal/temporal.worker.identity';
import { TemporalService } from 'nestjs-temporal-core';

@Controller('health')
export class HealthController {
  constructor(private readonly _temporalService: TemporalService) {}

  @Get('/status')
  async getHealthStatus(@Res() res: Response) {
    let connection: Connection | undefined;
    try {
      const workerStatus =
        this._temporalService.getWorkerStatusByTaskQueue('main');
      if (
        !workerStatus?.isInitialized ||
        !workerStatus.isRunning ||
        !workerStatus.isHealthy
      ) {
        return res.status(503).json({
          status: 'error',
          workerIdentity: getTemporalWorkerIdentity(),
          worker: workerStatus
            ? {
                taskQueue: workerStatus.taskQueue,
                isInitialized: workerStatus.isInitialized,
                isRunning: workerStatus.isRunning,
                isHealthy: workerStatus.isHealthy,
                lastError: workerStatus.lastError,
              }
            : null,
        });
      }

      const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
      connection = await Connection.connect({
        address,
        ...(process.env.TEMPORAL_TLS === 'true' ? { tls: true } : {}),
        ...(process.env.TEMPORAL_API_KEY
          ? { apiKey: process.env.TEMPORAL_API_KEY }
          : {}),
      });

      const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
      await Promise.race([
        connection.workflowService.describeNamespace({ namespace }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 10000)
        ),
      ]);
      return res.status(200).json({
        status: 'ok',
        workerIdentity: getTemporalWorkerIdentity(),
      });
    } catch {
      return res.status(500).json({ status: 'error' });
    } finally {
      await connection?.close().catch(() => {});
    }
  }
}
