import { describe, expect, it, vi } from 'vitest';
import { TelegramAssistantController } from './telegram.assistant.controller';

describe('TelegramAssistantController', () => {
  it('returns a deep link bound to the current user and organization', async () => {
    const linkService = {
      createLinkUrl: vi.fn(async () => 'https://t.me/vezde_post_bot?start=code'),
    };
    const controller = new TelegramAssistantController(linkService as any);

    await expect(
      controller.createLink({ id: 'user-1' } as any, { id: 'org-1' } as any)
    ).resolves.toEqual({ url: 'https://t.me/vezde_post_bot?start=code' });
    expect(linkService.createLinkUrl).toHaveBeenCalledWith('user-1', 'org-1');
  });
});
