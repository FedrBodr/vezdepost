import axios from 'axios';
import { Readable } from 'stream';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { VkGroupProvider } from '@gitroom/nestjs-libraries/integrations/social/vk.group.provider';
import { PostActivity } from './post.activity';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const userOAuthToken = 'vk-user-oauth-token';
const integration = {
  id: 'integration-1',
  organizationId: 'org-1',
  providerIdentifier: 'vk-group',
  internalId: '-123',
  token: userOAuthToken,
} as any;

const response = (body: unknown) =>
  Promise.resolve({ json: async () => body } as Response);

const storedPost = (id: string, mediaIds: string[]) =>
  ({
    id,
    content: `Stored post ${id}`,
    image: JSON.stringify(mediaIds.map((mediaId) => ({ id: mediaId }))),
    settings: '{}',
  } as any);

function createHarness({
  storedMedia,
  uploadFailure = false,
  saveFailure = false,
  savedOwnerId = '-123',
}: {
  storedMedia: Record<string, { id: string; path: string; type: string }>;
  uploadFailure?: boolean;
  saveFailure?: boolean;
  savedOwnerId?: string;
}) {
  const events: string[] = [];
  let uploadServerIndex = 0;
  const provider = new VkGroupProvider();
  const fetchMock = vi
    .spyOn(provider, 'fetch')
    .mockImplementation((url, options) => {
      const method = url.split('/method/')[1];
      events.push(method);

      if (method === 'photos.getWallUploadServer') {
        return response({
          response: {
            upload_url: `https://upload.example/photo-${uploadServerIndex++}`,
          },
        });
      }
      if (method === 'photos.saveWallPhoto') {
        if (saveFailure) {
          return response({
            error: { error_code: 100, error_msg: 'invalid upload' },
          });
        }
        const body = options?.body as FormData;
        const mediaIndex = Number(String(body.get('photo')).split('-').at(-1));
        return response({
          response: [{ owner_id: savedOwnerId, id: 456 + mediaIndex }],
        });
      }
      if (method === 'wall.post') {
        return response({ response: { post_id: 789 } });
      }
      throw new Error(`Unexpected VK method ${method}`);
    });

  vi.mocked(axios.get).mockImplementation(async () => ({
    data: Readable.from(['stored-image']),
  }));
  let multipartIndex = 0;
  vi.mocked(axios.post).mockImplementation(async () => {
    events.push('multipart upload');
    if (uploadFailure) {
      throw new Error('upload failed');
    }
    return {
      data: {
        photo: `uploaded-photo-${multipartIndex++}`,
        server: 321,
        hash: 'upload-hash',
      },
    };
  });

  const repository = { updateImages: vi.fn() };
  const mediaService = {
    getMediaById: vi.fn(async (id: string) => storedMedia[id]),
  };
  const integrationManager = {
    getSocialIntegration: vi.fn().mockReturnValue(provider),
  };
  const postsService = new PostsService(
    repository as any,
    integrationManager as any,
    {} as any,
    mediaService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  const activity = new PostActivity(
    postsService,
    {} as any,
    integrationManager as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

  return {
    activity,
    events,
    fetchMock,
    mediaService,
    repository,
  };
}

async function expectNoWallPost(
  request: Promise<unknown>,
  fetchMock: MockInstance<VkGroupProvider['fetch']>,
  message: string
) {
  await expect(request).rejects.toThrow(message);
  expect(
    fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/method/wall.post')
    )
  ).toHaveLength(0);
}

describe('PostActivity VK Group OAuth publishing', () => {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    vi.clearAllMocks();
    vi.mocked(axios.get).mockReset();
    vi.mocked(axios.post).mockReset();
  });

  afterEach(() => {
    if (stripeSecretKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = stripeSecretKey;
    }
  });

  it('publishes stored media with the user token through the exact VK photo sequence', async () => {
    const media = {
      id: 'stored-photo',
      path: 'https://media.example/stored-photo.jpg',
      type: 'image',
    };
    const { activity, events, fetchMock, mediaService, repository } =
      createHarness({ storedMedia: { [media.id]: media } });

    await expect(
      activity.postSocial(integration, [storedPost('post-1', [media.id])])
    ).resolves.toEqual([
      {
        id: 'post-1',
        postId: '789',
        releaseURL: 'https://vk.com/wall-123_789',
        status: 'completed',
      },
    ]);

    expect(events).toEqual([
      'photos.getWallUploadServer',
      'multipart upload',
      'photos.saveWallPhoto',
      'wall.post',
    ]);
    expect(mediaService.getMediaById).toHaveBeenCalledWith(media.id);
    expect(repository.updateImages).toHaveBeenCalledWith(
      'post-1',
      JSON.stringify([
        {
          ...media,
          url: media.path,
        },
      ])
    );
    for (const [, options] of fetchMock.mock.calls) {
      expect((options?.body as FormData).get('access_token')).toBe(
        userOAuthToken
      );
    }
    const wallBody = fetchMock.mock.calls.at(-1)?.[1]?.body as FormData;
    expect(wallBody.get('owner_id')).toBe('-123');
    expect(wallBody.get('from_group')).toBe('1');
    expect(wallBody.get('attachments')).toBe('photo-123_456');
  });

  it('runs each stored photograph through the exact serial VK sequence', async () => {
    const storedMedia = Object.fromEntries(
      [0, 1].map((index) => [
        `stored-photo-${index}`,
        {
          id: `stored-photo-${index}`,
          path: `https://media.example/stored-photo-${index}.jpg`,
          type: 'image',
        },
      ])
    );
    const { activity, events, fetchMock, repository } = createHarness({
      storedMedia,
    });

    await expect(
      activity.postSocial(integration, [
        storedPost('post-1', ['stored-photo-0', 'stored-photo-1']),
      ])
    ).resolves.toEqual([
      expect.objectContaining({ releaseURL: 'https://vk.com/wall-123_789' }),
    ]);
    expect(events).toEqual([
      'photos.getWallUploadServer',
      'multipart upload',
      'photos.saveWallPhoto',
      'photos.getWallUploadServer',
      'multipart upload',
      'photos.saveWallPhoto',
      'wall.post',
    ]);
    expect(axios.get).toHaveBeenNthCalledWith(
      1,
      storedMedia['stored-photo-0'].path,
      { responseType: 'stream' }
    );
    expect(axios.get).toHaveBeenNthCalledWith(
      2,
      storedMedia['stored-photo-1'].path,
      { responseType: 'stream' }
    );
    expect(repository.updateImages).toHaveBeenCalledWith(
      'post-1',
      expect.any(String)
    );
    expect(
      JSON.parse(repository.updateImages.mock.calls[0][1]).map(
        ({ id, path }: { id: string; path: string }) => ({ id, path })
      )
    ).toEqual(
      ['stored-photo-0', 'stored-photo-1'].map((id) => ({
        id,
        path: storedMedia[id].path,
      }))
    );
    const wallCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/method/wall.post')
    );
    const wallBody = wallCall?.[1]?.body as FormData;
    expect(wallBody.get('attachments')).toBe('photo-123_456,photo-123_457');
  });

  it('does not call wall.post for a stored invalid media type', async () => {
    const media = {
      id: 'stored-video',
      path: 'https://media.example/stored-video.mp4',
      type: 'video',
    };
    const { activity, fetchMock } = createHarness({
      storedMedia: { [media.id]: media },
    });

    await expectNoWallPost(
      activity.postSocial(integration, [storedPost('post-1', [media.id])]),
      fetchMock,
      'VK Group supports photographs only'
    );
  });

  it('does not call wall.post when a stored comment has media', async () => {
    const media = {
      id: 'comment-photo',
      path: 'https://media.example/comment-photo.jpg',
      type: 'image',
    };
    const { activity, fetchMock } = createHarness({
      storedMedia: { [media.id]: media },
    });

    await expectNoWallPost(
      activity.postSocial(integration, [
        storedPost('post-1', []),
        storedPost('comment-1', [media.id]),
      ]),
      fetchMock,
      'VK Group supports photographs only'
    );
  });

  it('does not call wall.post for more than ten stored images', async () => {
    const storedMedia = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [
        `stored-photo-${index}`,
        {
          id: `stored-photo-${index}`,
          path: `https://media.example/stored-photo-${index}.jpg`,
          type: 'image',
        },
      ])
    );
    const { activity, fetchMock } = createHarness({ storedMedia });

    await expectNoWallPost(
      activity.postSocial(integration, [
        storedPost('post-1', Object.keys(storedMedia)),
      ]),
      fetchMock,
      'VK Group supports up to 10 photographs per post'
    );
  });

  it('does not touch sibling media or wall.post after a multipart upload failure', async () => {
    const storedMedia = Object.fromEntries(
      [0, 1].map((index) => [
        `stored-photo-${index}`,
        {
          id: `stored-photo-${index}`,
          path: `https://media.example/stored-photo-${index}.jpg`,
          type: 'image',
        },
      ])
    );
    const { activity, events, fetchMock } = createHarness({
      storedMedia,
      uploadFailure: true,
    });

    await expectNoWallPost(
      activity.postSocial(integration, [
        storedPost('post-1', ['stored-photo-0', 'stored-photo-1']),
      ]),
      fetchMock,
      'VK Group photo upload failed'
    );
    expect(events).toEqual(['photos.getWallUploadServer', 'multipart upload']);
    expect(axios.get).toHaveBeenCalledOnce();
    expect(axios.post).toHaveBeenCalledOnce();
  });

  it('does not call wall.post after photos.saveWallPhoto fails', async () => {
    const media = {
      id: 'stored-photo',
      path: 'https://media.example/stored-photo.jpg',
      type: 'image',
    };
    const { activity, events, fetchMock } = createHarness({
      storedMedia: { [media.id]: media },
      saveFailure: true,
    });

    await expectNoWallPost(
      activity.postSocial(integration, [storedPost('post-1', [media.id])]),
      fetchMock,
      'VK photos.saveWallPhoto failed with error 100'
    );
    expect(events).toEqual([
      'photos.getWallUploadServer',
      'multipart upload',
      'photos.saveWallPhoto',
    ]);
  });

  it('publishes a stored photo saved for the OAuth user to the community wall', async () => {
    const media = {
      id: 'stored-photo',
      path: 'https://media.example/stored-photo.jpg',
      type: 'image',
    };
    const { activity, fetchMock } = createHarness({
      storedMedia: { [media.id]: media },
      savedOwnerId: '456',
    });

    await expect(
      activity.postSocial(integration, [storedPost('post-1', [media.id])])
    ).resolves.toEqual([expect.objectContaining({ status: 'completed' })]);
    const wallCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/method/wall.post')
    );
    const wallBody = wallCall?.[1]?.body as FormData;
    expect(wallBody.get('owner_id')).toBe('-123');
    expect(wallBody.get('from_group')).toBe('1');
    expect(wallBody.get('attachments')).toBe('photo456_456');
  });
});
