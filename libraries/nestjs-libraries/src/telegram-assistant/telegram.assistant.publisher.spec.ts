import { describe, expect, it, vi } from 'vitest';
import {
  PublishError,
  TelegramAssistantPublisher,
} from './telegram.assistant.publisher';

const integrations = [
  {
    id: 'vk-1',
    name: 'My VK',
    providerIdentifier: 'vk',
    disabled: false,
    refreshNeeded: false,
    inBetweenSteps: false,
  },
  {
    id: 'tg-1',
    name: 'Channel',
    providerIdentifier: 'telegram',
    disabled: false,
    refreshNeeded: false,
    inBetweenSteps: false,
  },
  {
    id: 'pin-1',
    name: 'Boards',
    providerIdentifier: 'pinterest',
    disabled: false,
    refreshNeeded: false,
    inBetweenSteps: false,
  },
  {
    id: 'off-1',
    name: 'Off',
    providerIdentifier: 'x',
    disabled: true,
    refreshNeeded: false,
    inBetweenSteps: false,
  },
  {
    id: 'old-1',
    name: 'Expired',
    providerIdentifier: 'x',
    disabled: false,
    refreshNeeded: true,
    inBetweenSteps: false,
  },
];

const validResult = (name: string) => ({
  identifier: 'x',
  name,
  emptyContent: false,
  valid: true,
  errors: true as const,
  tooLong: false,
  maximumCharacters: 1000,
});

const make = () => {
  let mediaNumber = 0;
  const deps = {
    api: { downloadFile: vi.fn(async (id: string) => Buffer.from(id)) },
    storeFile: vi.fn(async (buffer: Buffer) => ({
      path: `https://app.test/uploads/${buffer.toString()}.jpg`,
      name: `${buffer.toString()}.jpg`,
    })),
    mediaService: {
      saveFile: vi.fn(async (_org: string, name: string, path: string) => ({
        id: `media-${++mediaNumber}`,
        name,
        path,
      })),
    },
    integrationService: {
      getIntegrationsList: vi.fn(async () => integrations),
    },
    postsService: {
      validatePosts: vi.fn(async (_org: string, posts: any[]) =>
        posts.map((post) =>
          post.integration.id === 'pin-1'
            ? {
                ...validResult('Boards'),
                valid: false,
                settingsError: 'Board is required',
              }
            : validResult(post.integration.id)
        )
      ),
      mapTypeToPost: vi.fn(async (body: any) => body),
      createPost: vi.fn(async () => [{ postId: 'p1' }]),
    },
  };
  return { publisher: new TelegramAssistantPublisher(deps as any), deps };
};

describe('TelegramAssistantPublisher', () => {
  it('offers only active channels', async () => {
    const { publisher } = make();

    await expect(publisher.listChannels('org-1')).resolves.toEqual([
      { id: 'vk-1', name: 'My VK', providerIdentifier: 'vk' },
      { id: 'tg-1', name: 'Channel', providerIdentifier: 'telegram' },
      { id: 'pin-1', name: 'Boards', providerIdentifier: 'pinterest' },
    ]);
  });

  it('stores files once and creates a "now" post per valid channel', async () => {
    const { publisher, deps } = make();

    const result = await publisher.publish('org-1', {
      text: 'Hello\nworld',
      files: [
        { fileId: 'a', kind: 'image' },
        { fileId: 'b', kind: 'video' },
      ],
      selected: ['vk-1', 'tg-1', 'pin-1'],
    });

    expect(deps.api.downloadFile).toHaveBeenCalledTimes(2);
    expect(deps.mediaService.saveFile).toHaveBeenCalledTimes(2);
    expect(deps.postsService.createPost).toHaveBeenCalledTimes(2);
    const body = deps.postsService.mapTypeToPost.mock.calls[0][0];
    expect(body.type).toBe('now');
    expect(body.posts[0].settings).toEqual({ __type: 'vk' });
    expect(body.posts[0].value[0]).toMatchObject({
      content: '<p>Hello</p><p>world</p>',
      image: [
        { id: 'media-1', path: 'https://app.test/uploads/a.jpg' },
        { id: 'media-2', path: 'https://app.test/uploads/b.jpg' },
      ],
    });
    expect(deps.postsService.createPost.mock.calls[0][0]).toBe('org-1');
    expect(result).toEqual({
      published: ['My VK', 'Channel'],
      failed: [{ name: 'Boards', error: 'Board is required' }],
    });
  });

  it('ignores selected channels that are no longer active', async () => {
    const { publisher, deps } = make();

    const result = await publisher.publish('org-1', {
      text: 'Hi',
      files: [],
      selected: ['off-1', 'vk-1'],
    });

    expect(result.published).toEqual(['My VK']);
    expect(deps.postsService.createPost).toHaveBeenCalledTimes(1);
  });

  it('reports a channel whose post creation throws', async () => {
    const { publisher, deps } = make();
    deps.postsService.createPost.mockRejectedValueOnce(new Error('Boom'));

    const result = await publisher.publish('org-1', {
      text: 'Hi',
      files: [],
      selected: ['vk-1', 'tg-1'],
    });

    expect(result).toEqual({
      published: ['Channel'],
      failed: [{ name: 'My VK', error: 'Boom' }],
    });
  });

  it('shows the details of a Nest validation error', async () => {
    const { publisher, deps } = make();
    deps.postsService.mapTypeToPost.mockRejectedValueOnce(
      Object.assign(new Error('Bad Request Exception'), {
        getResponse: () => ({ message: ['date must be a valid date'] }),
      })
    );

    const result = await publisher.publish('org-1', {
      text: 'Hi',
      files: [],
      selected: ['vk-1'],
    });

    expect(result.failed).toEqual([
      { name: 'My VK', error: 'date must be a valid date' },
    ]);
  });

  it.each([
    [{ text: 'Hi', files: [], selected: [] }, 'Выберите хотя бы один канал'],
    [{ text: '  ', files: [], selected: ['vk-1'] }, 'Пустой пост'],
  ])('refuses %j', async (draft, message) => {
    const { publisher } = make();

    await expect(publisher.publish('org-1', draft as any)).rejects.toThrow(
      new PublishError(message)
    );
  });
});
