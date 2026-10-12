import { describe, expect, it, vi } from 'vitest';
import { QuickPostError, QuickPostService } from './quick.post.service';

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

const media = [{ id: 'media-1', path: 'https://app.test/uploads/a.jpg' }];

const make = () => {
  const deps = {
    integrationService: {
      getIntegrationsList: vi.fn(async () => integrations),
      findFreeDateTime: vi.fn(async () => [120, 400]),
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
      findFreeDateTime: vi.fn(async () => '2026-10-13T02:00:00'),
    },
    now: () => new Date('2026-10-12T10:00:00.000Z'),
  };
  return { service: new QuickPostService(deps as any), deps };
};

describe('QuickPostService', () => {
  it('offers only active channels', async () => {
    const { service } = make();

    await expect(service.listChannels('org-1')).resolves.toEqual([
      { id: 'vk-1', name: 'My VK', providerIdentifier: 'vk' },
      { id: 'tg-1', name: 'Channel', providerIdentifier: 'telegram' },
      { id: 'pin-1', name: 'Boards', providerIdentifier: 'pinterest' },
    ]);
  });

  it('creates a "now" post per valid channel and reports the rest', async () => {
    const { service, deps } = make();

    const result = await service.publish(
      'org-1',
      {
        text: 'Hello\nworld',
        media,
        integrationIds: ['vk-1', 'tg-1', 'pin-1'],
        schedule: { type: 'now' },
      },
      'API'
    );

    expect(deps.postsService.createPost).toHaveBeenCalledTimes(2);
    const body = deps.postsService.mapTypeToPost.mock.calls[0][0];
    expect(body.type).toBe('now');
    expect(body.date).toBe('2026-10-12T10:00:00.000Z');
    expect(body.posts[0].settings).toEqual({ __type: 'vk' });
    expect(body.posts[0].value[0]).toMatchObject({
      content: '<p>Hello</p><p>world</p>',
      image: media,
    });
    expect(deps.postsService.createPost.mock.calls[0]).toEqual([
      'org-1',
      expect.anything(),
      'API',
    ]);
    expect(result).toEqual({
      published: [
        { id: 'vk-1', name: 'My VK' },
        { id: 'tg-1', name: 'Channel' },
      ],
      failed: [{ id: 'pin-1', name: 'Boards', error: 'Board is required' }],
    });
  });

  it('uses one organization-wide free slot for every channel in queue', async () => {
    const { service, deps } = make();

    await service.publish(
      'org-1',
      {
        text: 'Hi',
        media: [],
        integrationIds: ['vk-1', 'tg-1'],
        schedule: { type: 'queue' },
      },
      'WEB'
    );

    expect(deps.postsService.findFreeDateTime).toHaveBeenCalledTimes(1);
    expect(deps.postsService.findFreeDateTime).toHaveBeenCalledWith('org-1');
    const dates = deps.postsService.mapTypeToPost.mock.calls.map(
      (call) => call[0]
    );
    expect(dates).toHaveLength(2);
    for (const body of dates) {
      expect(body).toMatchObject({
        type: 'schedule',
        date: '2026-10-13T02:00:00',
      });
    }
  });

  it('refuses queue when no channel has posting times', async () => {
    const { service, deps } = make();
    deps.integrationService.findFreeDateTime.mockResolvedValueOnce([]);

    await expect(
      service.publish(
        'org-1',
        {
          text: 'Hi',
          media: [],
          integrationIds: ['vk-1'],
          schedule: { type: 'queue' },
        },
        'WEB'
      )
    ).rejects.toThrow(
      new QuickPostError('У каналов нет расписания — задайте время публикации')
    );
    expect(deps.postsService.findFreeDateTime).not.toHaveBeenCalled();
    expect(deps.postsService.createPost).not.toHaveBeenCalled();
  });

  it('schedules at the given date', async () => {
    const { service, deps } = make();

    await service.publish(
      'org-1',
      {
        text: 'Hi',
        media: [],
        integrationIds: ['vk-1'],
        schedule: { type: 'date', date: '2026-10-20T08:00:00.000Z' },
      },
      'WEB'
    );

    expect(deps.postsService.mapTypeToPost.mock.calls[0][0]).toMatchObject({
      type: 'schedule',
      date: '2026-10-20T08:00:00.000Z',
    });
  });

  it('refuses a date in the past', async () => {
    const { service, deps } = make();

    await expect(
      service.publish(
        'org-1',
        {
          text: 'Hi',
          media: [],
          integrationIds: ['vk-1'],
          schedule: { type: 'date', date: '2026-10-01T08:00:00.000Z' },
        },
        'WEB'
      )
    ).rejects.toThrow(new QuickPostError('Дата публикации уже прошла'));
    expect(deps.postsService.createPost).not.toHaveBeenCalled();
  });

  it('deduplicates integration ids', async () => {
    const { service, deps } = make();

    const result = await service.publish(
      'org-1',
      {
        text: 'Hi',
        media: [],
        integrationIds: ['vk-1', 'vk-1'],
        schedule: { type: 'now' },
      },
      'WEB'
    );

    expect(deps.postsService.createPost).toHaveBeenCalledTimes(1);
    expect(result.published).toEqual([{ id: 'vk-1', name: 'My VK' }]);
  });

  it('ignores integrations outside the organization or no longer active', async () => {
    const { service, deps } = make();

    const result = await service.publish(
      'org-1',
      {
        text: 'Hi',
        media: [],
        integrationIds: ['off-1', 'old-1', 'other-org', 'vk-1'],
        schedule: { type: 'now' },
      },
      'WEB'
    );

    expect(result.published).toEqual([{ id: 'vk-1', name: 'My VK' }]);
    expect(deps.postsService.createPost).toHaveBeenCalledTimes(1);
  });

  it('reports a channel whose post creation throws', async () => {
    const { service, deps } = make();
    deps.postsService.createPost.mockRejectedValueOnce(new Error('Boom'));

    const result = await service.publish(
      'org-1',
      {
        text: 'Hi',
        media: [],
        integrationIds: ['vk-1', 'tg-1'],
        schedule: { type: 'now' },
      },
      'WEB'
    );

    expect(result).toEqual({
      published: [{ id: 'tg-1', name: 'Channel' }],
      failed: [{ id: 'vk-1', name: 'My VK', error: 'Boom' }],
    });
  });

  it('shows the details of a Nest validation error', async () => {
    const { service, deps } = make();
    deps.postsService.mapTypeToPost.mockRejectedValueOnce(
      Object.assign(new Error('Bad Request Exception'), {
        getResponse: () => ({ message: ['date must be a valid date'] }),
      })
    );

    const result = await service.publish(
      'org-1',
      {
        text: 'Hi',
        media: [],
        integrationIds: ['vk-1'],
        schedule: { type: 'now' },
      },
      'WEB'
    );

    expect(result.failed).toEqual([
      { id: 'vk-1', name: 'My VK', error: 'date must be a valid date' },
    ]);
  });

  it.each([
    [
      { text: 'Hi', media: [], integrationIds: [], schedule: { type: 'now' } },
      'Выберите хотя бы один канал',
    ],
    [
      {
        text: '  ',
        media: [],
        integrationIds: ['vk-1'],
        schedule: { type: 'now' },
      },
      'Пустой пост',
    ],
    [
      {
        text: 'Hi',
        media: [],
        integrationIds: ['off-1'],
        schedule: { type: 'now' },
      },
      'Выбранные каналы недоступны — подключите их заново',
    ],
  ])('refuses %j', async (input, message) => {
    const { service } = make();

    await expect(service.publish('org-1', input as any, 'WEB')).rejects.toThrow(
      new QuickPostError(message)
    );
  });
});
