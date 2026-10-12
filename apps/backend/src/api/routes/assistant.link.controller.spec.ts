import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AssistantLinkController } from './assistant.link.controller';

const user = { id: 'user-1' } as any;
const org = { id: 'org-1' } as any;

describe('AssistantLinkController', () => {
  it('returns a MAX deep link for the current user and organization', async () => {
    const linkService = {
      createLinkUrl: vi.fn(async () => 'https://max.ru/bot?start=code'),
    };
    const controller = new AssistantLinkController(linkService as any);

    await expect(controller.createLink(user, org, 'max')).resolves.toEqual({
      url: 'https://max.ru/bot?start=code',
    });
    expect(linkService.createLinkUrl).toHaveBeenCalledWith(
      'user-1',
      'org-1',
      'max'
    );
  });

  it('rejects an unknown transport', async () => {
    const controller = new AssistantLinkController({} as any);
    await expect(controller.createLink(user, org, 'signal')).rejects.toThrow(
      BadRequestException
    );
  });
});
