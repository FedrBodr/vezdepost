import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { QuickPostController } from './quick.post.controller';
import { QuickPostError } from '@gitroom/nestjs-libraries/quick-post/quick.post.service';

const org = { id: 'org-1' } as any;

const body = {
  text: 'Hi',
  media: [],
  integrationIds: ['vk-1'],
  schedule: { type: 'now' as const },
};

describe('QuickPostController', () => {
  it('publishes through the service with the WEB creation method', async () => {
    const service = {
      publish: vi.fn().mockResolvedValue({ published: [], failed: [] }),
    };
    const controller = new QuickPostController(service as any);

    await expect(controller.publish(org, body)).resolves.toEqual({
      published: [],
      failed: [],
    });
    expect(service.publish).toHaveBeenCalledWith('org-1', body, 'WEB');
  });

  it('passes a dated schedule through with its date', async () => {
    const service = {
      publish: vi.fn().mockResolvedValue({ published: [], failed: [] }),
    };
    const controller = new QuickPostController(service as any);

    await controller.publish(org, {
      ...body,
      schedule: { type: 'date', date: '2026-10-20T08:00:00.000Z' },
    });

    expect(service.publish.mock.calls[0][1].schedule).toEqual({
      type: 'date',
      date: '2026-10-20T08:00:00.000Z',
    });
  });

  it('turns a QuickPostError into 400 with its message', async () => {
    const service = {
      publish: vi.fn().mockRejectedValue(new QuickPostError('Пустой пост')),
    };
    const controller = new QuickPostController(service as any);

    await expect(controller.publish(org, body)).rejects.toThrow(
      new BadRequestException('Пустой пост')
    );
  });

  it('lets unexpected errors through untouched', async () => {
    const service = {
      publish: vi.fn().mockRejectedValue(new Error('db down')),
    };
    const controller = new QuickPostController(service as any);

    await expect(controller.publish(org, body)).rejects.toThrow('db down');
  });
});

describe('QuickPostController registration', () => {
  it('is registered in the API module', async () => {
    const { ApiModule } = await import('@gitroom/backend/api/api.module');
    const controllers: unknown[] = Reflect.getMetadata(
      'controllers',
      ApiModule
    );
    expect(controllers).toContain(QuickPostController);
  });
});
