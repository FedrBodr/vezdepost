import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { Readable, Writable } from 'stream';
import { VkGroupProvider } from './vk.group.provider';
import { BadBody, RefreshToken } from '../social.abstract';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('@gitroom/helpers/utils/media.source', async (importOriginal) => ({
  ...(await importOriginal()),
  withMediaSourceStream: vi.fn(
    async (
      path: string,
      _options: unknown,
      consume: (source: unknown) => Promise<unknown>
    ) => {
      const response = await axios.get(path, { responseType: 'stream' });
      return consume({
        stream: response.data,
        size: Buffer.byteLength('image-data'),
        finalUrl: path,
        status: 200,
        headers: new Headers(),
        local: false,
      });
    }
  ),
}));

const token = 'vk-community-secret-token';
const upstreamPayload = 'vk-upstream-sensitive-payload';
const mediaUrl = 'https://media.example/private-photo.jpg';
const uploadUrl = 'https://upload.example/private-upload';
const uploadedPhoto = 'uploaded-photo-private';
const uploadHash = 'upload-hash-private';
const postText = 'private VK post text';

const response = (body: unknown) =>
  Promise.resolve({ json: async () => body } as Response);

const readMultipartBody = (formData: NodeJS.ReadableStream) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    });
    sink.on('finish', () => resolve(Buffer.concat(chunks).toString('utf8')));
    sink.on('error', reject);
    formData.on('error', reject);
    formData.pipe(sink);
  });

async function expectSanitizedPhotoFailure(
  request: Promise<unknown>,
  fetchMock: { mock: { calls: Array<[string, RequestInit?]> } },
  options: {
    expectedClass?: any;
    message?: string;
    secrets?: string[];
  } = {}
) {
  let thrown: unknown;
  try {
    await request;
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(options.expectedClass || BadBody);
  expect((thrown as any).details).toEqual([
    expect.objectContaining({ identifier: 'vk-group' }),
  ]);
  if (options.message) {
    expect(String(thrown)).toContain(options.message);
  }
  const serialized = `${String(thrown)} ${JSON.stringify(thrown)}`;
  for (const secret of [
    token,
    mediaUrl,
    uploadUrl,
    upstreamPayload,
    uploadedPhoto,
    uploadHash,
    'axios-private-message',
    ...(options.secrets || []),
  ]) {
    if (secret) {
      expect(serialized).not.toContain(secret);
    }
  }
  expect(
    fetchMock.mock.calls.filter(([url]) => url.endsWith('/method/wall.post'))
  ).toHaveLength(0);
  return thrown;
}

async function expectSanitizedWallFailure(request: Promise<unknown>) {
  let thrown: unknown;
  try {
    await request;
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(BadBody);
  expect(String(thrown)).toContain('VK wall.post request failed');
  expect((thrown as any).details).toEqual([
    { identifier: 'vk-group', json: '{}', body: '{}' },
  ]);
  const serialized = `${String(thrown)} ${JSON.stringify(thrown)}`;
  for (const secret of [
    token,
    mediaUrl,
    uploadUrl,
    upstreamPayload,
    uploadedPhoto,
    uploadHash,
    'wall-private-error',
  ]) {
    expect(serialized).not.toContain(secret);
  }
}

describe('VkGroupProvider OAuth and managed-community selection', () => {
  let provider: VkGroupProvider;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.example';
    process.env.VK_ID = 'vk-client-id';
    provider = new VkGroupProvider();
  });

  it('declares independent two-step OAuth without manual fields', async () => {
    expect(provider.isBetweenSteps).toBe(true);
    expect(provider.refreshCron).toBe(true);
    expect(provider.scopes).toEqual([
      'vkid.personal_info',
      'wall',
      'photos',
      'groups',
    ]);
    expect('customFields' in provider).toBe(false);
    expect('customFieldsInstructions' in provider).toBe(false);

    const auth = await provider.generateAuthUrl();
    const url = new URL(auth.url);
    expect(url.origin + url.pathname).toBe('https://id.vk.com/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example/integrations/social/vk-group'
    );
    expect(url.searchParams.get('scope')).toBe(
      'vkid.personal_info wall photos groups'
    );
  });

  it('authenticates the VK administrator under a temporary namespaced ID', async () => {
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({
          access_token: token,
          refresh_token: 'refresh-secret',
          expires_in: 3600,
        })
      )
      .mockImplementationOnce(() =>
        response({
          user: {
            user_id: 42,
            first_name: 'Ada',
            last_name: 'Admin',
            avatar: 'https://vk.test/admin.jpg',
          },
        })
      );

    const result = await provider.authenticate({
      code: 'authorization-code&&&&device-42',
      codeVerifier: 'verifier',
    });

    expect(result).toEqual({
      id: 'vk-group-oauth:42',
      name: 'Ada Admin',
      accessToken: token,
      refreshToken: 'refresh-secret&&&&device-42',
      expiresIn: 3600,
      picture: 'https://vk.test/admin.jpg',
      username: 'ada',
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://id.vk.com/oauth2/auth',
      'https://id.vk.com/oauth2/user_info',
    ]);
    expect(
      (fetchMock.mock.calls[0][1]?.body as FormData).get('redirect_uri')
    ).toBe('https://app.example/integrations/social/vk-group');
  });

  it('delegates refresh with the VK Group scopes and device binding', async () => {
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({
          access_token: 'rotated-token',
          refresh_token: 'rotated-refresh',
          expires_in: 7200,
        })
      )
      .mockImplementationOnce(() =>
        response({
          user: {
            user_id: '42',
            first_name: 'Ada',
            last_name: 'Admin',
          },
        })
      );

    await expect(
      provider.refreshToken('refresh-secret&&&&device-42')
    ).resolves.toEqual({
      id: '42',
      name: 'Ada Admin',
      accessToken: 'rotated-token',
      refreshToken: 'rotated-refresh&&&&device-42',
      expiresIn: 7200,
      picture: '',
      username: 'ada',
    });
    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get('refresh_token')).toBe('refresh-secret');
    expect(body.get('device_id')).toBe('device-42');
    expect(body.get('scope')).toBe('vkid.personal_info wall photos groups');
  });

  it('lists only administrator communities with stable selection fields', async () => {
    const fetchMock = vi.spyOn(provider, 'fetch').mockImplementationOnce(() =>
      response({
        response: {
          count: 2,
          items: [
            {
              id: 123,
              name: 'FedrBodr',
              screen_name: 'fedrbodr_pro',
              photo_200: 'https://vk.test/photo.jpg',
            },
            { id: '456', name: 'Second community' },
          ],
        },
      })
    );

    await expect(provider.pages(token)).resolves.toEqual([
      {
        id: '123',
        page: '123',
        username: 'fedrbodr_pro',
        name: 'FedrBodr',
        picture: 'https://vk.test/photo.jpg',
      },
      {
        id: '456',
        page: '456',
        username: '',
        name: 'Second community',
        picture: '',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.vk.com/method/groups.get'
    );
    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(Object.fromEntries(body.entries())).toEqual({
      access_token: token,
      v: '5.251',
      filter: 'admin',
      extended: '1',
      fields: 'photo_200,screen_name',
    });
  });

  it('revalidates an allowed selection and preflights photo upload capability', async () => {
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({
          response: {
            items: [
              {
                id: 123,
                name: 'FedrBodr',
                screen_name: 'fedrbodr_pro',
                photo_200: 'https://vk.test/photo.jpg',
              },
            ],
          },
        })
      )
      .mockImplementationOnce(() =>
        response({ response: { upload_url: uploadUrl } })
      );

    await expect(
      provider.fetchPageInformation(token, { page: '123' })
    ).resolves.toEqual({
      id: '-123',
      name: 'FedrBodr',
      access_token: token,
      picture: 'https://vk.test/photo.jpg',
      username: 'fedrbodr_pro',
    });

    expect(
      fetchMock.mock.calls.map(([url]) => url.split('/method/')[1])
    ).toEqual(['groups.get', 'photos.getWallUploadServer']);
    const groupsBody = fetchMock.mock.calls[0][1]?.body as FormData;
    const photoBody = fetchMock.mock.calls[1][1]?.body as FormData;
    expect(groupsBody.get('filter')).toBe('admin');
    expect(photoBody.get('group_id')).toBe('123');
  });

  it('rejects a forged selection before the capability preflight', async () => {
    const fetchMock = vi.spyOn(provider, 'fetch').mockImplementationOnce(() =>
      response({
        response: {
          items: [{ id: 123, name: 'FedrBodr' }],
        },
      })
    );

    await expect(
      provider.fetchPageInformation(token, { page: '999' })
    ).rejects.toThrow(
      'The selected VK community is not managed by this account.'
    );
    expect(
      fetchMock.mock.calls.map(([url]) => url.split('/method/')[1])
    ).toEqual(['groups.get']);
  });

  it.each(['0', '-123', '00123', '123.0', ''])(
    'rejects a non-canonical positive selection ID before calling VK (%s)',
    async (page) => {
      const fetchMock = vi.spyOn(provider, 'fetch');

      await expect(
        provider.fetchPageInformation(token, { page })
      ).rejects.toThrow(
        'The selected VK community is not managed by this account.'
      );
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each([
    'http://upload.example/private-upload',
    'https://user:password@upload.example/private-upload',
  ])(
    'rejects an unsafe capability upload URL without leaking it (%s)',
    async (unsafeUrl) => {
      const fetchMock = vi
        .spyOn(provider, 'fetch')
        .mockImplementationOnce(() =>
          response({
            response: { items: [{ id: 123, name: 'FedrBodr' }] },
          })
        )
        .mockImplementationOnce(() =>
          response({
            response: { upload_url: unsafeUrl, raw: upstreamPayload },
          })
        );

      let thrown: unknown;
      try {
        await provider.fetchPageInformation(token, { page: '123' });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(BadBody);
      expect(String(thrown)).toContain('invalid HTTPS upload URL');
      expect(`${String(thrown)} ${JSON.stringify(thrown)}`).not.toContain(
        unsafeUrl
      );
      expect(`${String(thrown)} ${JSON.stringify(thrown)}`).not.toContain(
        token
      );
      expect(`${String(thrown)} ${JSON.stringify(thrown)}`).not.toContain(
        upstreamPayload
      );
      expect(
        fetchMock.mock.calls.map(([url]) => url.split('/method/')[1])
      ).toEqual(['groups.get', 'photos.getWallUploadServer']);
    }
  );
});

describe('VkGroupProvider photo publishing', () => {
  let provider: VkGroupProvider;

  beforeEach(() => {
    provider = new VkGroupProvider();
    vi.clearAllMocks();
    vi.mocked(axios.get)
      .mockReset()
      .mockResolvedValue({ data: Readable.from(['stored-image']) });
    vi.mocked(axios.post).mockReset();
  });

  it('enforces the complete validity boundary', async () => {
    const tooMany = 'VK Group supports up to 10 photographs per post.';
    const unsupported =
      'VK Group supports photographs only. Remove videos and other attachments.';
    const images = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        path: `photo-${index}.jpg`,
        type: 'image',
      }));

    await expect(provider.checkValidity([[]], {}, [])).resolves.toBe(true);
    await expect(
      provider.checkValidity([[{ path: 'one.jpg', type: 'image' }]], {}, [])
    ).resolves.toBe(true);
    await expect(
      provider.checkValidity([[{ path: 'legacy.jpg' }]], {}, [])
    ).resolves.toBe(true);
    await expect(provider.checkValidity([images(10)], {}, [])).resolves.toBe(
      true
    );
    await expect(provider.checkValidity([images(11)], {}, [])).resolves.toBe(
      tooMany
    );
    await expect(
      provider.checkValidity([[{ path: 'clip.mp4', type: 'video' }]], {}, [])
    ).resolves.toBe(unsupported);
    await expect(
      provider.checkValidity([[{ path: 'file.pdf', type: 'document' }]], {}, [])
    ).resolves.toBe(unsupported);
    await expect(
      provider.checkValidity([[{ path: 'legacy-video.mp4' }]], {}, [])
    ).resolves.toBe(unsupported);
    await expect(
      provider.checkValidity(
        [[{ path: 'legacy-document.PDF?download=1' }]],
        {},
        []
      )
    ).resolves.toBe(unsupported);
    await expect(
      provider.checkValidity(
        [[], [{ path: 'reply.jpg', type: 'image' }]],
        {},
        []
      )
    ).resolves.toBe(unsupported);
  });

  it.each([
    [
      Array.from({ length: 11 }, (_, index) => ({
        type: 'image' as const,
        path: `photo-${index}.jpg`,
      })),
      'VK Group supports up to 10 photographs per post.',
    ],
    [
      [{ type: 'video' as const, path: 'clip.mp4' }],
      'VK Group supports photographs only. Remove videos and other attachments.',
    ],
  ])(
    'rejects forbidden media before making a network request',
    async (media, error) => {
      const fetchMock = vi.spyOn(provider, 'fetch');

      await expect(
        provider.post('-123', token, [
          { id: 'postiz-post', message: 'Hello VK', settings: {}, media },
        ])
      ).rejects.toThrow(error);

      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('rejects an unsupported path even when its normalized type says image', async () => {
    const fetchMock = vi.spyOn(provider, 'fetch');

    await expect(
      provider.post('-123', token, [
        {
          id: 'postiz-post',
          message: 'Hello VK',
          settings: {},
          media: [{ type: 'image', path: 'normalized-video.mp4' }],
        },
      ])
    ).rejects.toThrow(
      'VK Group supports photographs only. Remove videos and other attachments.'
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects image media on later post details before making a request', async () => {
    const fetchMock = vi.spyOn(provider, 'fetch');

    await expect(
      provider.post('-123', token, [
        {
          id: 'main-post',
          message: 'Hello VK',
          settings: {},
          media: Array.from({ length: 10 }, (_, index) => ({
            type: 'image',
            path: `photo-${index}.jpg`,
          })),
        },
        {
          id: 'comment',
          message: 'Reply',
          settings: {},
          media: [{ type: 'image', path: 'reply.jpg' }],
        },
      ])
    ).rejects.toThrow(
      'VK Group supports photographs only. Remove videos and other attachments.'
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts text as the community without credentials in the URL', async () => {
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() => response({ response: { post_id: 789 } }));

    const result = await provider.post('-123', token, [
      { id: 'postiz-post', message: 'Hello VK', settings: {} },
    ]);

    expect(result).toEqual([
      {
        id: 'postiz-post',
        postId: '789',
        releaseURL: 'https://vk.com/wall-123_789',
        status: 'completed',
      },
    ]);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.vk.com/method/wall.post');
    expect(url).not.toContain(token);
    expect(url).not.toContain('client_id');

    const body = options?.body as FormData;
    expect(body.get('access_token')).toBe(token);
    expect(body.get('v')).toBe('5.251');
    expect(body.get('owner_id')).toBe('-123');
    expect(body.get('from_group')).toBe('1');
    expect(body.get('message')).toBe('Hello VK');
    expect(body.has('attachments')).toBe(false);
  });

  it('publishes one photo with positive group upload IDs and a signed saved owner ID', async () => {
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({ response: { upload_url: uploadUrl } })
      )
      .mockImplementationOnce(() =>
        response({ response: [{ owner_id: -123, id: 456 }] })
      )
      .mockImplementationOnce(() => response({ response: { post_id: 789 } }));
    vi.mocked(axios.get).mockResolvedValue({
      data: Readable.from(['image-data']),
    });
    let multipartBody = '';
    vi.mocked(axios.post).mockImplementation(async (_url, formData) => {
      multipartBody = await readMultipartBody(
        formData as NodeJS.ReadableStream
      );
      return {
        data: { photo: uploadedPhoto, server: 321, hash: uploadHash },
      };
    });

    await expect(
      provider.post('-123', token, [
        {
          id: 'postiz-post',
          message: 'Hello VK',
          settings: {},
          media: [{ type: 'image', path: mediaUrl }],
        },
      ])
    ).resolves.toEqual([
      {
        id: 'postiz-post',
        postId: '789',
        releaseURL: 'https://vk.com/wall-123_789',
        status: 'completed',
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.vk.com/method/photos.getWallUploadServer',
      'https://api.vk.com/method/photos.saveWallPhoto',
      'https://api.vk.com/method/wall.post',
    ]);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).not.toContain(token);
      expect((options?.body as FormData).get('access_token')).toBe(token);
    }

    const getUploadBody = fetchMock.mock.calls[0][1]?.body as FormData;
    const saveBody = fetchMock.mock.calls[1][1]?.body as FormData;
    const wallBody = fetchMock.mock.calls[2][1]?.body as FormData;
    expect(getUploadBody.get('group_id')).toBe('123');
    expect(saveBody.get('group_id')).toBe('123');
    expect(saveBody.get('photo')).toBe(uploadedPhoto);
    expect(saveBody.get('server')).toBe('321');
    expect(saveBody.get('hash')).toBe(uploadHash);
    expect(wallBody.get('owner_id')).toBe('-123');
    expect(wallBody.get('from_group')).toBe('1');
    expect(wallBody.get('attachments')).toBe('photo-123_456');
    expect(axios.get).toHaveBeenCalledWith(mediaUrl, {
      responseType: 'stream',
    });
    const [, multipartForm, multipartOptions] = vi.mocked(axios.post).mock
      .calls[0];
    const boundary = (multipartForm as { getBoundary(): string }).getBoundary();
    expect(vi.mocked(axios.post).mock.calls[0][0]).toBe(uploadUrl);
    expect(multipartOptions?.headers).toEqual(
      expect.objectContaining({
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(Buffer.byteLength(multipartBody)),
      })
    );
    expect(multipartOptions?.maxRedirects).toBe(0);
    expect(multipartBody).toContain('name="photo"');
    expect(multipartBody).toContain('filename="private-photo.jpg"');
    expect(multipartBody).toContain('image-data');
  });

  it('uploads and saves photographs serially in original media order', async () => {
    const events: string[] = [];
    let uploadServerIndex = 0;
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementation((url, options) => {
        if (url.endsWith('/method/photos.getWallUploadServer')) {
          const index = uploadServerIndex++;
          events.push(`get-upload-server:${index}`);
          return response({
            response: {
              upload_url: `https://upload.example/private-upload-${index}`,
            },
          });
        }
        if (url.endsWith('/method/photos.saveWallPhoto')) {
          const body = options?.body as FormData;
          const index = Number(String(body.get('photo')).split('-').at(-1));
          events.push(`save-photo:${index}`);
          expect(body.get('server')).toBe(String(3000 + index));
          expect(body.get('hash')).toBe(`upload-hash-${index}`);
          return response({
            response: [
              {
                owner_id: '-123',
                id: String(2000 + index),
              },
            ],
          });
        }
        if (url.endsWith('/method/wall.post')) {
          events.push('wall-post');
          return response({ response: { post_id: 789 } });
        }
        throw new Error('unexpected VK method');
      });
    vi.mocked(axios.get).mockImplementation(async (path) => {
      const index = Number(String(path).match(/photo-(\d+)\.jpg$/)?.[1]);
      events.push(`download:${index}`);
      return { data: Readable.from([`image-from-media-${index}`]) };
    });
    vi.mocked(axios.post).mockImplementation(async (url, formData) => {
      const multipartBody = await readMultipartBody(
        formData as NodeJS.ReadableStream
      );
      const index = Number(multipartBody.match(/image-from-media-(\d+)/)?.[1]);
      events.push(`multipart-upload:${index}`);
      expect(url).toBe(`https://upload.example/private-upload-${index}`);
      expect(multipartBody).toContain('name="photo"');
      expect(multipartBody).toContain(`filename="private-photo-${index}.jpg"`);
      return {
        data: {
          photo: `uploaded-photo-${index}`,
          server: 3000 + index,
          hash: `upload-hash-${index}`,
        },
      };
    });

    await provider.post('-123', token, [
      {
        id: 'postiz-post',
        message: 'Ordered photos',
        settings: {},
        media: Array.from({ length: 3 }, (_, index) => ({
          type: 'image' as const,
          path: `https://media.example/private-photo-${index}.jpg`,
        })),
      },
    ]);

    expect(events).toEqual([
      'download:0',
      'get-upload-server:0',
      'multipart-upload:0',
      'save-photo:0',
      'download:1',
      'get-upload-server:1',
      'multipart-upload:1',
      'save-photo:1',
      'download:2',
      'get-upload-server:2',
      'multipart-upload:2',
      'save-photo:2',
      'wall-post',
    ]);

    const wallCall = fetchMock.mock.calls.find(([url]) =>
      url.endsWith('/method/wall.post')
    );
    const wallBody = wallCall?.[1]?.body as FormData;
    expect(wallBody.get('attachments')).toBe(
      Array.from({ length: 3 }, (_, index) => `photo-123_${2000 + index}`).join(
        ','
      )
    );
  });

  it('preserves large decimal string IDs throughout photo publication', async () => {
    const workerOwnerId = '-90071992547409931111111111';
    const positiveGroupId = '90071992547409931111111111';
    const uploadServerId = '90071992547409932222222222';
    const ownerId = workerOwnerId;
    const photoId = '90071992547409939876543210';
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({ response: { upload_url: uploadUrl } })
      )
      .mockImplementationOnce(() =>
        response({ response: [{ owner_id: ownerId, id: photoId }] })
      )
      .mockImplementationOnce(() => response({ response: { post_id: 789 } }));
    vi.mocked(axios.get).mockResolvedValue({
      data: Readable.from(['image-data']),
    });
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        photo: uploadedPhoto,
        server: uploadServerId,
        hash: uploadHash,
      },
    });

    await provider.post(workerOwnerId, token, [
      {
        id: 'postiz-post',
        message: 'Large IDs',
        settings: {},
        media: [{ type: 'image', path: mediaUrl }],
      },
    ]);

    const getUploadBody = fetchMock.mock.calls[0][1]?.body as FormData;
    const saveBody = fetchMock.mock.calls[1][1]?.body as FormData;
    const wallBody = fetchMock.mock.calls[2][1]?.body as FormData;
    expect(getUploadBody.get('group_id')).toBe(positiveGroupId);
    expect(saveBody.get('group_id')).toBe(positiveGroupId);
    expect(saveBody.get('server')).toBe(uploadServerId);
    expect(wallBody.get('owner_id')).toBe(workerOwnerId);
    expect(wallBody.get('attachments')).toBe(`photo${ownerId}_${photoId}`);
  });

  it.each([
    ['123', 'positive'],
    ['0', 'zero'],
    ['-0', 'negative zero'],
    ['-1.5', 'fractional'],
    ['-abc', 'nonnumeric'],
    ['', 'empty'],
    [-9007199254740993, 'unsafe rounded number'],
    [-1e21, 'exponent-producing number'],
  ])(
    'rejects an invalid worker community ID before photo requests (%s: %s)',
    async (userId) => {
      const fetchMock = vi.spyOn(provider, 'fetch');

      await expect(
        provider.post(userId as string, token, [
          {
            id: 'postiz-post',
            message: 'Photo',
            settings: {},
            media: [{ type: 'image', path: mediaUrl }],
          },
        ])
      ).rejects.toBeInstanceOf(BadBody);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(axios.get).not.toHaveBeenCalled();
      expect(axios.post).not.toHaveBeenCalled();
    }
  );

  it('classifies photo API error code 5 without leaking the upstream message', async () => {
    const fetchMock = vi.spyOn(provider, 'fetch').mockImplementationOnce(() =>
      response({
        error: {
          error_code: 5,
          error_msg: `expired ${token} ${mediaUrl} ${upstreamPayload}`,
        },
      })
    );

    const thrown = await expectSanitizedPhotoFailure(
      provider.post('-123', token, [
        {
          id: 'postiz-post',
          message: 'Photo',
          settings: {},
          media: [{ type: 'image', path: mediaUrl }],
        },
      ]),
      fetchMock,
      {
        expectedClass: RefreshToken,
        message: 'VK photos.getWallUploadServer failed with error 5',
      }
    );

    expect((thrown as any).details).toEqual([
      { identifier: 'vk-group', json: '{"code":5}', body: '{}' },
    ]);
  });

  it('redacts an ordinary VK photo error and prevents partial publication', async () => {
    const fetchMock = vi.spyOn(provider, 'fetch').mockImplementationOnce(() =>
      response({
        error: {
          error_code: 100,
          error_msg: `invalid ${token} ${mediaUrl} ${upstreamPayload}`,
        },
      })
    );

    await expectSanitizedPhotoFailure(
      provider.post('-123', token, [
        {
          id: 'postiz-post',
          message: 'Photo',
          settings: {},
          media: [{ type: 'image', path: mediaUrl }],
        },
      ]),
      fetchMock,
      { message: 'VK photos.getWallUploadServer failed with error 100' }
    );
  });

  it.each([
    ['photos.getWallUploadServer', 'upload server'],
    ['photos.saveWallPhoto', 'save'],
  ])(
    'maps legacy community-token error 27 from %s to safe reconnect guidance (%s)',
    async (method) => {
      const fetchMock = vi.spyOn(provider, 'fetch');
      if (method === 'photos.getWallUploadServer') {
        fetchMock.mockImplementationOnce(() =>
          response({
            error: {
              error_code: 27,
              error_msg: `${token} ${uploadUrl} ${mediaUrl} ${postText} ${upstreamPayload}`,
            },
          })
        );
      } else {
        fetchMock
          .mockImplementationOnce(() =>
            response({ response: { upload_url: uploadUrl } })
          )
          .mockImplementationOnce(() =>
            response({
              error: {
                error_code: 27,
                error_msg: `${token} ${uploadUrl} ${mediaUrl} ${postText} ${upstreamPayload}`,
              },
            })
          );
        vi.mocked(axios.get).mockResolvedValue({
          data: Readable.from(['image-data']),
        });
        vi.mocked(axios.post).mockResolvedValue({
          data: { photo: uploadedPhoto, server: 321, hash: uploadHash },
        });
      }

      await expectSanitizedPhotoFailure(
        provider.post('-123', token, [
          {
            id: 'postiz-post',
            message: postText,
            settings: {},
            media: [{ type: 'image', path: mediaUrl }],
          },
        ]),
        fetchMock,
        {
          message:
            'Reconnect VK Group through VK authorization to publish photographs.',
          secrets: [postText],
        }
      );
    }
  );

  it.each([
    ['photos.getWallUploadServer', 'upload server'],
    ['photos.saveWallPhoto', 'save'],
  ])(
    'gives reconnect guidance when %s denies photo access (%s)',
    async (method) => {
      const fetchMock = vi.spyOn(provider, 'fetch');
      if (method === 'photos.getWallUploadServer') {
        fetchMock.mockImplementationOnce(() =>
          response({
            error: { error_code: 15, error_msg: `denied ${upstreamPayload}` },
          })
        );
      } else {
        fetchMock
          .mockImplementationOnce(() =>
            response({ response: { upload_url: uploadUrl } })
          )
          .mockImplementationOnce(() =>
            response({
              error: {
                error_code: 15,
                error_msg: `denied ${upstreamPayload}`,
              },
            })
          );
        vi.mocked(axios.get).mockResolvedValue({
          data: Readable.from(['image-data']),
        });
        vi.mocked(axios.post).mockResolvedValue({
          data: { photo: uploadedPhoto, server: 321, hash: uploadHash },
        });
      }

      await expectSanitizedPhotoFailure(
        provider.post('-123', token, [
          {
            id: 'postiz-post',
            message: 'Photo',
            settings: {},
            media: [{ type: 'image', path: mediaUrl }],
          },
        ]),
        fetchMock,
        {
          message:
            'VK Group photo access is missing. Reconnect VK Group through VK authorization and grant photo access.',
        }
      );
    }
  );

  it.each([
    [{}, 'missing'],
    [{ response: null }, 'null'],
    [{ response: { unexpected: upstreamPayload } }, 'missing URL'],
  ])(
    'rejects a malformed photo upload-server envelope (%s)',
    async (payload) => {
      const fetchMock = vi
        .spyOn(provider, 'fetch')
        .mockImplementationOnce(() => response(payload));

      await expectSanitizedPhotoFailure(
        provider.post('-123', token, [
          {
            id: 'postiz-post',
            message: 'Photo',
            settings: {},
            media: [{ type: 'image', path: mediaUrl }],
          },
        ]),
        fetchMock
      );
      expect(axios.get).toHaveBeenCalledOnce();
    }
  );

  it.each([
    [{ malicious: upstreamPayload }, 'object'],
    ['', 'empty'],
    ['not-a-url', 'malformed'],
    ['http://upload.example/private', 'HTTP'],
    ['https://user:password@upload.example/private', 'credentials'],
  ])('rejects an unsafe photo upload URL (%s)', async (unsafeUrl) => {
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({ response: { upload_url: unsafeUrl } })
      );

    await expectSanitizedPhotoFailure(
      provider.post('-123', token, [
        {
          id: 'postiz-post',
          message: 'Photo',
          settings: {},
          media: [{ type: 'image', path: mediaUrl }],
        },
      ]),
      fetchMock,
      {
        message:
          'VK photos.getWallUploadServer returned an invalid HTTPS upload URL',
        secrets: typeof unsafeUrl === 'string' ? [unsafeUrl] : [],
      }
    );
    expect(axios.get).toHaveBeenCalledOnce();
  });

  it('redacts a photo media download failure', async () => {
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({ response: { upload_url: uploadUrl } })
      );
    vi.mocked(axios.get).mockRejectedValue(
      Object.assign(new Error(`axios-private-message ${mediaUrl}`), {
        config: { url: mediaUrl, data: uploadedPhoto },
      })
    );

    await expectSanitizedPhotoFailure(
      provider.post('-123', token, [
        {
          id: 'postiz-post',
          message: 'Photo',
          settings: {},
          media: [{ type: 'image', path: mediaUrl }],
        },
      ]),
      fetchMock,
      { message: 'VK Group media download failed' }
    );
  });

  it('redacts a multipart photo upload failure', async () => {
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({ response: { upload_url: uploadUrl } })
      );
    vi.mocked(axios.get).mockResolvedValue({
      data: Readable.from(['image-data']),
    });
    vi.mocked(axios.post).mockRejectedValue(
      Object.assign(new Error(`axios-private-message ${uploadUrl}`), {
        config: { url: uploadUrl, data: uploadedPhoto },
      })
    );

    await expectSanitizedPhotoFailure(
      provider.post('-123', token, [
        {
          id: 'postiz-post',
          message: 'Photo',
          settings: {},
          media: [{ type: 'image', path: mediaUrl }],
        },
      ]),
      fetchMock,
      { message: 'VK Group photo upload failed' }
    );
  });

  it('rejects an upload redirect without following a private or downgrade location', async () => {
    const privateRedirect = 'http://private-upload.example/token-bearing-path';
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({ response: { upload_url: uploadUrl } })
      );
    vi.mocked(axios.get).mockResolvedValue({
      data: Readable.from(['image-data']),
    });
    vi.mocked(axios.post).mockRejectedValue(
      Object.assign(
        new Error(`redirect ${privateRedirect} ${token} ${uploadedPhoto}`),
        {
          response: {
            status: 302,
            headers: { location: privateRedirect },
            data: upstreamPayload,
          },
          config: { url: uploadUrl, data: uploadedPhoto, maxRedirects: 0 },
        }
      )
    );

    await expectSanitizedPhotoFailure(
      provider.post('-123', token, [
        {
          id: 'postiz-post',
          message: 'Photo',
          settings: {},
          media: [{ type: 'image', path: mediaUrl }],
        },
      ]),
      fetchMock,
      {
        message: 'VK Group photo upload failed',
        secrets: [privateRedirect],
      }
    );

    expect(vi.mocked(axios.post).mock.calls[0][2]).toEqual(
      expect.objectContaining({ maxRedirects: 0 })
    );
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.vk.com/method/photos.getWallUploadServer',
    ]);
  });

  it('redacts a multipart form construction failure', async () => {
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({ response: { upload_url: uploadUrl } })
      );
    vi.mocked(axios.get).mockResolvedValue({
      data: { private: `axios-private-message ${mediaUrl}` },
    });

    await expectSanitizedPhotoFailure(
      provider.post('-123', token, [
        {
          id: 'postiz-post',
          message: 'Photo',
          settings: {},
          media: [{ type: 'image', path: mediaUrl }],
        },
      ]),
      fetchMock,
      { message: 'VK Group photo upload failed' }
    );
    expect(axios.post).not.toHaveBeenCalled();
  });

  it.each([
    [{ server: 321, hash: uploadHash }, 'missing photo'],
    [{ photo: '', server: 321, hash: uploadHash }, 'empty photo'],
    [{ photo: uploadedPhoto, hash: uploadHash }, 'missing server'],
    [{ photo: uploadedPhoto, server: 0, hash: uploadHash }, 'zero server'],
    [
      { photo: uploadedPhoto, server: 1.5, hash: uploadHash },
      'fractional server',
    ],
    [
      { photo: uploadedPhoto, server: 9007199254740993, hash: uploadHash },
      'unsafe rounded numeric server',
    ],
    [
      { photo: uploadedPhoto, server: 1e21, hash: uploadHash },
      'exponent-producing numeric server',
    ],
    [{ photo: uploadedPhoto, server: 321 }, 'missing hash'],
    [{ photo: uploadedPhoto, server: 321, hash: '' }, 'empty hash'],
  ])(
    'rejects malformed multipart photo upload fields (%s: %s)',
    async (data) => {
      const fetchMock = vi
        .spyOn(provider, 'fetch')
        .mockImplementationOnce(() =>
          response({ response: { upload_url: uploadUrl } })
        );
      vi.mocked(axios.get).mockResolvedValue({
        data: Readable.from(['image-data']),
      });
      vi.mocked(axios.post).mockResolvedValue({ data });

      await expectSanitizedPhotoFailure(
        provider.post('-123', token, [
          {
            id: 'postiz-post',
            message: 'Photo',
            settings: {},
            media: [{ type: 'image', path: mediaUrl }],
          },
        ]),
        fetchMock,
        { message: 'VK Group photo upload returned invalid fields' }
      );
    }
  );

  it.each([
    [{}, 'missing response'],
    [{ response: null }, 'null response'],
    [
      {
        error: {
          error_code: 100,
          error_msg: `invalid ${token} ${upstreamPayload}`,
        },
      },
      'ordinary error',
    ],
  ])('rejects a malformed photo save envelope (%s)', async (payload) => {
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({ response: { upload_url: uploadUrl } })
      )
      .mockImplementationOnce(() => response(payload));
    vi.mocked(axios.get).mockResolvedValue({
      data: Readable.from(['image-data']),
    });
    vi.mocked(axios.post).mockResolvedValue({
      data: { photo: uploadedPhoto, server: 321, hash: uploadHash },
    });

    await expectSanitizedPhotoFailure(
      provider.post('-123', token, [
        {
          id: 'postiz-post',
          message: 'Photo',
          settings: {},
          media: [{ type: 'image', path: mediaUrl }],
        },
      ]),
      fetchMock
    );
  });

  it.each([
    [{ response: {} }, 'object'],
    [{ response: true }, 'boolean'],
    [{ response: 'not-an-array' }, 'string'],
    [{ response: [] }, 'empty array'],
  ])('rejects a non-array photo save response (%s)', async (payload) => {
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({ response: { upload_url: uploadUrl } })
      )
      .mockImplementationOnce(() => response(payload));
    vi.mocked(axios.get).mockResolvedValue({
      data: Readable.from(['image-data']),
    });
    vi.mocked(axios.post).mockResolvedValue({
      data: { photo: uploadedPhoto, server: 321, hash: uploadHash },
    });

    await expectSanitizedPhotoFailure(
      provider.post('-123', token, [
        {
          id: 'postiz-post',
          message: 'Photo',
          settings: {},
          media: [{ type: 'image', path: mediaUrl }],
        },
      ]),
      fetchMock,
      { message: 'VK photos.saveWallPhoto returned an invalid photo response' }
    );
  });

  it('rejects multiple saved photos before wall.post', async () => {
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({ response: { upload_url: uploadUrl } })
      )
      .mockImplementationOnce(() =>
        response({
          response: [
            { owner_id: -123, id: 456 },
            { owner_id: -123, id: 457 },
          ],
        })
      );
    vi.mocked(axios.get).mockResolvedValue({
      data: Readable.from(['image-data']),
    });
    vi.mocked(axios.post).mockResolvedValue({
      data: { photo: uploadedPhoto, server: 321, hash: uploadHash },
    });

    await expectSanitizedPhotoFailure(
      provider.post('-123', token, [
        {
          id: 'postiz-post',
          message: 'Photo',
          settings: {},
          media: [{ type: 'image', path: mediaUrl }],
        },
      ]),
      fetchMock,
      { message: 'VK photos.saveWallPhoto returned an invalid photo response' }
    );

    expect(
      fetchMock.mock.calls.filter(([url]) => url.endsWith('/method/wall.post'))
    ).toHaveLength(0);
  });

  it.each([
    [undefined, 'missing'],
    [{ malicious: upstreamPayload }, 'object'],
    [true, 'boolean'],
    [0, 'zero'],
    ['0', 'zero string'],
    [1.5, 'fractional'],
    [9007199254740993, 'unsafe rounded number'],
    [1e21, 'exponent-producing number'],
    ['', 'empty'],
    ['not-an-id', 'nonnumeric'],
  ])('rejects an invalid saved photo owner ID (%s: %s)', async (ownerId) => {
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({ response: { upload_url: uploadUrl } })
      )
      .mockImplementationOnce(() =>
        response({ response: [{ owner_id: ownerId, id: 456 }] })
      );
    vi.mocked(axios.get).mockResolvedValue({
      data: Readable.from(['image-data']),
    });
    vi.mocked(axios.post).mockResolvedValue({
      data: { photo: uploadedPhoto, server: 321, hash: uploadHash },
    });

    await expectSanitizedPhotoFailure(
      provider.post('-123', token, [
        {
          id: 'postiz-post',
          message: 'Photo',
          settings: {},
          media: [{ type: 'image', path: mediaUrl }],
        },
      ]),
      fetchMock,
      { message: 'VK photos.saveWallPhoto returned invalid owner ID' }
    );
  });

  it('publishes a saved photo owned by the OAuth user to the community wall', async () => {
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({ response: { upload_url: uploadUrl } })
      )
      .mockImplementationOnce(() =>
        response({ response: [{ owner_id: 456, id: 789 }] })
      )
      .mockImplementationOnce(() => response({ response: { post_id: 789 } }));
    vi.mocked(axios.get).mockResolvedValue({
      data: Readable.from(['image-data']),
    });
    vi.mocked(axios.post).mockResolvedValue({
      data: { photo: uploadedPhoto, server: 321, hash: uploadHash },
    });

    await expect(
      provider.post('-123', token, [
        {
          id: 'postiz-post',
          message: 'Photo',
          settings: {},
          media: [{ type: 'image', path: mediaUrl }],
        },
      ])
    ).resolves.toEqual([
      expect.objectContaining({ releaseURL: 'https://vk.com/wall-123_789' }),
    ]);
    const wallCall = fetchMock.mock.calls.find(([url]) =>
      url.endsWith('/method/wall.post')
    );
    const wallBody = wallCall?.[1]?.body as FormData;
    expect(wallBody.get('owner_id')).toBe('-123');
    expect(wallBody.get('from_group')).toBe('1');
    expect(wallBody.get('attachments')).toBe('photo456_789');
  });

  it.each([
    [undefined, 'missing'],
    [{ malicious: upstreamPayload }, 'object'],
    [false, 'boolean'],
    [0, 'zero'],
    [-1, 'negative'],
    [2.5, 'fractional'],
    [9007199254740993, 'unsafe rounded number'],
    [1e21, 'exponent-producing number'],
    ['', 'empty'],
    ['not-an-id', 'nonnumeric'],
  ])('rejects an invalid saved photo ID (%s: %s)', async (photoId) => {
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({ response: { upload_url: uploadUrl } })
      )
      .mockImplementationOnce(() =>
        response({ response: [{ owner_id: -123, id: photoId }] })
      );
    vi.mocked(axios.get).mockResolvedValue({
      data: Readable.from(['image-data']),
    });
    vi.mocked(axios.post).mockResolvedValue({
      data: { photo: uploadedPhoto, server: 321, hash: uploadHash },
    });

    await expectSanitizedPhotoFailure(
      provider.post('-123', token, [
        {
          id: 'postiz-post',
          message: 'Photo',
          settings: {},
          media: [{ type: 'image', path: mediaUrl }],
        },
      ]),
      fetchMock,
      { message: 'VK photos.saveWallPhoto returned invalid photo ID' }
    );
  });

  it('stops before touching a sibling photograph after an upload failure', async () => {
    const events: string[] = [];
    let uploadServerIndex = 0;
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementation((url, options) => {
        if (url.endsWith('/method/photos.getWallUploadServer')) {
          const index = uploadServerIndex++;
          events.push(`get-upload-server:${index}`);
          return response({
            response: {
              upload_url: `https://upload.example/partial-${index}`,
            },
          });
        }
        if (url.endsWith('/method/photos.saveWallPhoto')) {
          events.push('save-photo');
          expect((options?.body as FormData).get('photo')).toBe(
            'partial-photo-0'
          );
          return response({ response: [{ owner_id: -123, id: 456 }] });
        }
        if (url.endsWith('/method/wall.post')) {
          return response({ response: { post_id: 789 } });
        }
        throw new Error('unexpected VK method');
      });
    vi.mocked(axios.get).mockImplementation(async () => {
      events.push('download');
      return { data: Readable.from(['image-data']) };
    });
    vi.mocked(axios.post).mockImplementation(async () => {
      events.push('multipart-upload');
      throw new Error(`axios-private-message ${uploadUrl}`);
    });

    await expectSanitizedPhotoFailure(
      provider.post('-123', token, [
        {
          id: 'postiz-post',
          message: 'Partial failure',
          settings: {},
          media: [
            { type: 'image', path: 'https://media.example/partial-0.jpg' },
            { type: 'image', path: 'https://media.example/partial-1.jpg' },
          ],
        },
      ]),
      fetchMock,
      {
        message: 'VK Group photo upload failed',
        secrets: [
          'https://media.example/partial-0.jpg',
          'https://media.example/partial-1.jpg',
          'https://upload.example/partial-0',
          'https://upload.example/partial-1',
        ],
      }
    );
    expect(events).toEqual([
      'download',
      'get-upload-server:0',
      'multipart-upload',
    ]);
    expect(axios.get).toHaveBeenCalledOnce();
    expect(axios.post).toHaveBeenCalledOnce();
  });

  it.each([
    ['transport', 'text-only'],
    ['JSON decoding', 'text-only'],
    ['transport', 'photo'],
    ['JSON decoding', 'photo'],
  ])(
    'redacts a final wall.post %s failure for a %s publication',
    async (failurePhase, publicationType) => {
      const privateError = Object.assign(
        new Error(
          `wall-private-error ${token} ${mediaUrl} ${uploadUrl} ${upstreamPayload}`
        ),
        {
          config: { url: uploadUrl, data: uploadedPhoto },
          response: { data: { hash: uploadHash, payload: upstreamPayload } },
        }
      );
      const finalWallFailure = () =>
        failurePhase === 'transport'
          ? Promise.reject(privateError)
          : Promise.resolve({
              json: async () => {
                throw privateError;
              },
            } as Response);
      const fetchMock = vi.spyOn(provider, 'fetch');
      if (publicationType === 'photo') {
        fetchMock
          .mockImplementationOnce(() =>
            response({ response: { upload_url: uploadUrl } })
          )
          .mockImplementationOnce(() =>
            response({ response: [{ owner_id: -123, id: 456 }] })
          )
          .mockImplementationOnce(finalWallFailure);
        vi.mocked(axios.get).mockResolvedValue({
          data: Readable.from(['image-data']),
        });
        vi.mocked(axios.post).mockResolvedValue({
          data: { photo: uploadedPhoto, server: 321, hash: uploadHash },
        });
      } else {
        fetchMock.mockImplementationOnce(finalWallFailure);
      }

      await expectSanitizedWallFailure(
        provider.post('-123', token, [
          {
            id: 'postiz-post',
            message: 'Hello VK',
            settings: {},
            ...(publicationType === 'photo'
              ? { media: [{ type: 'image' as const, path: mediaUrl }] }
              : {}),
          },
        ])
      );

      expect(
        fetchMock.mock.calls.filter(([url]) =>
          url.endsWith('/method/wall.post')
        )
      ).toHaveLength(1);
    }
  );

  it('turns VK HTTP-200 errors into a failed post without leaking the token', async () => {
    vi.spyOn(provider, 'fetch').mockImplementationOnce(() =>
      response({
        error: {
          error_code: 15,
          error_msg: `Access denied ${token} ${upstreamPayload}`,
        },
      })
    );

    let thrown: unknown;
    try {
      await provider.post('-123', token, [
        { id: 'postiz-post', message: 'Hello VK', settings: {} },
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadBody);
    expect(String(thrown)).toContain('VK wall.post failed with error 15');
    expect((thrown as any).details).toEqual([
      { identifier: 'vk-group', json: '{"code":15}', body: '{}' },
    ]);
    const serialized = `${String(thrown)} ${JSON.stringify(thrown)}`;
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(upstreamPayload);
    expect(serialized).not.toContain('Access denied');
  });

  it('classifies a final wall.post VK error 5 for VK Group', async () => {
    vi.spyOn(provider, 'fetch').mockImplementationOnce(() =>
      response({
        error: {
          error_code: 5,
          error_msg: `expired ${token} ${upstreamPayload}`,
        },
      })
    );

    let thrown: unknown;
    try {
      await provider.post('-123', token, [
        { id: 'postiz-post', message: 'Hello VK', settings: {} },
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RefreshToken);
    expect(String(thrown)).toContain('VK wall.post failed with error 5');
    expect((thrown as any).details).toEqual([
      { identifier: 'vk-group', json: '{"code":5}', body: '{}' },
    ]);
    const serialized = `${String(thrown)} ${JSON.stringify(thrown)}`;
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(upstreamPayload);
  });

  it.each([
    [{ malicious: true }, 'object'],
    [true, 'boolean'],
    [0, 'zero'],
    [-1, 'negative'],
    [1.5, 'fractional'],
    [9007199254740993, 'unsafe rounded number'],
    [1e21, 'exponent-producing number'],
    ['', 'empty'],
    ['abc', 'nonnumeric'],
  ])('rejects a %s wall.post ID (%s)', async (postId) => {
    vi.spyOn(provider, 'fetch').mockImplementationOnce(() =>
      response({ response: { post_id: postId } })
    );

    await expect(
      provider.post('-123', token, [
        { id: 'postiz-post', message: 'Hello VK', settings: {} },
      ])
    ).rejects.toBeInstanceOf(BadBody);
  });

  it('preserves a digit-only wall.post ID without numeric conversion', async () => {
    const postId = '90071992547409931234567890';
    vi.spyOn(provider, 'fetch').mockImplementationOnce(() =>
      response({ response: { post_id: postId } })
    );

    await expect(
      provider.post('-123', token, [
        { id: 'postiz-post', message: 'Hello VK', settings: {} },
      ])
    ).resolves.toEqual([expect.objectContaining({ postId })]);
  });

  it('creates text comments as the community without attachments', async () => {
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({ response: { comment_id: 456 } })
      );

    const result = await provider.comment(
      '-123',
      '789',
      undefined,
      token,
      [{ id: 'postiz-comment', message: 'A reply', settings: {} }],
      {} as any
    );

    expect(result).toEqual([
      {
        id: 'postiz-comment',
        postId: '456',
        releaseURL: 'https://vk.com/wall-123_789',
        status: 'completed',
      },
    ]);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.vk.com/method/wall.createComment');
    expect(url).not.toContain(token);
    expect(url).not.toContain('client_id');

    const body = options?.body as FormData;
    expect(body.get('access_token')).toBe(token);
    expect(body.get('v')).toBe('5.251');
    expect(body.get('owner_id')).toBe('-123');
    expect(body.get('from_group')).toBe('123');
    expect(body.get('post_id')).toBe('789');
    expect(body.get('message')).toBe('A reply');
    expect(body.has('attachments')).toBe(false);
  });

  it.each([
    [
      () =>
        Promise.reject(
          new Error(`comment transport ${token} ${mediaUrl} ${upstreamPayload}`)
        ),
      'transport',
    ],
    [
      () =>
        Promise.resolve({
          json: async () => {
            throw new Error(
              `comment JSON ${token} ${mediaUrl} ${upstreamPayload}`
            );
          },
        } as Response),
      'non-JSON',
    ],
  ])('sanitizes a wall.createComment %s failure', async (failure) => {
    vi.spyOn(provider, 'fetch').mockImplementationOnce(failure);

    let thrown: unknown;
    try {
      await provider.comment(
        '-123',
        '789',
        undefined,
        token,
        [{ id: 'postiz-comment', message: 'A reply', settings: {} }],
        {} as any
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadBody);
    expect(String(thrown)).toContain('VK wall.createComment request failed');
    expect((thrown as any).details).toEqual([
      { identifier: 'vk-group', json: '{}', body: '{}' },
    ]);
    const serialized = `${String(thrown)} ${JSON.stringify(thrown)}`;
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(mediaUrl);
    expect(serialized).not.toContain(upstreamPayload);
  });

  it.each([
    [5, RefreshToken],
    [100, BadBody],
  ])(
    'sanitizes wall.createComment VK error %s',
    async (errorCode, expectedClass) => {
      vi.spyOn(provider, 'fetch').mockImplementationOnce(() =>
        response({
          error: {
            error_code: errorCode,
            error_msg: `private ${token} ${mediaUrl} ${upstreamPayload}`,
          },
        })
      );

      let thrown: unknown;
      try {
        await provider.comment(
          '-123',
          '789',
          undefined,
          token,
          [{ id: 'postiz-comment', message: 'A reply', settings: {} }],
          {} as any
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(expectedClass);
      expect(String(thrown)).toContain(
        `VK wall.createComment failed with error ${errorCode}`
      );
      expect((thrown as any).details).toEqual([
        {
          identifier: 'vk-group',
          json: `{"code":${errorCode}}`,
          body: '{}',
        },
      ]);
      const serialized = `${String(thrown)} ${JSON.stringify(thrown)}`;
      expect(serialized).not.toContain(token);
      expect(serialized).not.toContain(mediaUrl);
      expect(serialized).not.toContain(upstreamPayload);
    }
  );

  it.each([
    [{ malicious: true }, 'object'],
    [false, 'boolean'],
    [0, 'zero'],
    [-1, 'negative'],
    [2.5, 'fractional'],
    ['', 'empty'],
    ['not-an-id', 'nonnumeric'],
  ])('rejects a %s wall.createComment ID (%s)', async (commentId) => {
    vi.spyOn(provider, 'fetch').mockImplementationOnce(() =>
      response({ response: { comment_id: commentId } })
    );

    await expect(
      provider.comment(
        '-123',
        '789',
        undefined,
        token,
        [{ id: 'postiz-comment', message: 'A reply', settings: {} }],
        {} as any
      )
    ).rejects.toBeInstanceOf(BadBody);
  });
});
