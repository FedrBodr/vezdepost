import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { BadBody, RefreshToken } from '../social.abstract';
import { VkProvider } from './vk.provider';

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
        size: undefined,
        finalUrl: path,
        status: 200,
        headers: new Headers(),
        local: false,
      });
    }
  ),
}));

class TestVkProvider extends VkProvider {
  upload(userId: string, accessToken: string, post: any) {
    return this.uploadMedia(userId, accessToken, post);
  }
}

const accessToken = 'vk-personal-secret-token';
const mediaUrl = 'https://media.example/private-photo.jpg';
const videoUrl = 'https://media.example/private-video.mp4';
const uploadUrl = 'https://upload.example/private-upload';
const response = (body: unknown) => ({ json: async () => body } as Response);

const textPost = {
  id: 'postiz-post',
  message: 'Hello VK',
  media: [],
  settings: {},
};

const imagePost = {
  ...textPost,
  media: [{ id: 'photo', path: mediaUrl }],
};

const videoPost = {
  ...textPost,
  media: [{ id: 'video', path: videoUrl }],
};

async function expectSanitizedFailure(
  request: Promise<unknown>,
  secrets: string[] = [accessToken, mediaUrl]
) {
  let thrown: unknown;
  try {
    await request;
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Error);
  for (const secret of secrets) {
    expect(JSON.stringify(thrown)).not.toContain(secret);
  }
}

describe('VkProvider verified publishing', () => {
  let provider: TestVkProvider;

  beforeEach(() => {
    provider = new TestVkProvider();
    vi.clearAllMocks();
    vi.mocked(axios.get).mockReset().mockResolvedValue({ data: 'media-data' });
    vi.mocked(axios.post).mockReset();
  });

  it('opts into proactive token refresh', () => {
    expect(new VkProvider().refreshCron).toBe(true);
  });

  it('preserves the personal VK OAuth scope contract', () => {
    expect(new VkProvider().scopes).toMatchInlineSnapshot(`
      [
        "vkid.personal_info",
        "email",
        "wall",
        "status",
        "docs",
        "photos",
        "video",
      ]
    `);
  });

  it('throws RefreshToken when a media API returns VK error 5', async () => {
    vi.spyOn(provider, 'fetch').mockResolvedValue(
      response({ error: { error_code: 5, error_msg: 'expired' } })
    );

    const request = provider.upload('1', accessToken, imagePost);
    await expect(request).rejects.toBeInstanceOf(RefreshToken);
    await expectSanitizedFailure(request);
  });

  it('rejects a media upload response without upload_url', async () => {
    vi.spyOn(provider, 'fetch').mockResolvedValue(response({ response: {} }));

    const request = provider.upload('1', accessToken, imagePost);
    await expect(request).rejects.toBeInstanceOf(BadBody);
    await expectSanitizedFailure(request);
  });

  it.each([
    [{ upload_url: { malicious: true } }, 'object'],
    [{ upload_url: true }, 'boolean'],
    [{ upload_url: 123 }, 'number'],
    [{ upload_url: '' }, 'empty'],
    [{ upload_url: 'not-a-url' }, 'malformed'],
    [{ upload_url: 'javascript:alert(1)' }, 'unsafe protocol'],
  ])('rejects a %s upload URL (%s)', async (uploadResponse) => {
    vi.spyOn(provider, 'fetch').mockResolvedValue(
      response({ response: uploadResponse })
    );
    vi.mocked(axios.get).mockResolvedValue({ data: 'image-data' });
    vi.mocked(axios.post).mockResolvedValue({
      data: { photo: 'photo', server: 1, hash: 'hash' },
    });

    const request = provider.upload('1', accessToken, imagePost);
    await expect(request).rejects.toBeInstanceOf(BadBody);
    await expectSanitizedFailure(request, [accessToken, mediaUrl]);
    expect(axios.get).toHaveBeenCalledOnce();
  });

  it.each([
    [{ malicious: true }, 'object'],
    [true, 'boolean'],
    [0, 'zero'],
    [-1, 'negative'],
    [1.5, 'fractional'],
    ['', 'empty'],
    ['not-an-id', 'nonnumeric'],
  ])('rejects a %s video ID (%s)', async (videoId) => {
    vi.spyOn(provider, 'fetch').mockResolvedValue(
      response({ response: { upload_url: uploadUrl, video_id: videoId } })
    );
    vi.mocked(axios.get).mockResolvedValue({ data: 'video-data' });
    vi.mocked(axios.post).mockResolvedValue({ data: {} });

    const request = provider.upload('1', accessToken, videoPost);
    await expect(request).rejects.toBeInstanceOf(BadBody);
    await expectSanitizedFailure(request, [accessToken, videoUrl, uploadUrl]);
    expect(axios.get).toHaveBeenCalledOnce();
  });

  it('preserves a digit-only video ID without numeric conversion', async () => {
    const videoId = '90071992547409931234567890';
    vi.spyOn(provider, 'fetch').mockResolvedValue(
      response({ response: { upload_url: uploadUrl, video_id: videoId } })
    );
    vi.mocked(axios.get).mockResolvedValue({ data: 'video-data' });
    vi.mocked(axios.post).mockResolvedValue({ data: {} });

    await expect(provider.upload('1', accessToken, videoPost)).resolves.toEqual(
      [{ id: videoId, type: 'video' }]
    );
  });

  it.each([
    [{ server: 1, hash: 'hash' }, 'photo'],
    [{ photo: 'photo', hash: 'hash' }, 'server'],
    [{ photo: 'photo', server: 1 }, 'hash'],
    [{ photo: { malicious: true }, server: 1, hash: 'hash' }, 'photo type'],
    [{ photo: 'photo', server: 0, hash: 'hash' }, 'server value'],
    [{ photo: 'photo', server: 1, hash: false }, 'hash type'],
  ])(
    'rejects a photo upload response with invalid %s (%s)',
    async (uploadResponse, _field) => {
      const fetchMock = vi
        .spyOn(provider, 'fetch')
        .mockResolvedValueOnce(
          response({ response: { upload_url: uploadUrl } })
        );
      vi.mocked(axios.get).mockResolvedValue({ data: 'image-data' });
      vi.mocked(axios.post).mockResolvedValue({ data: uploadResponse });

      const request = provider.upload('1', accessToken, imagePost);
      await expect(request).rejects.toBeInstanceOf(BadBody);
      await expectSanitizedFailure(request, [accessToken, mediaUrl, uploadUrl]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it('rejects a saved photo response without an ID', async () => {
    vi.spyOn(provider, 'fetch')
      .mockResolvedValueOnce(response({ response: { upload_url: uploadUrl } }))
      .mockResolvedValueOnce(response({ response: [{}] }));
    vi.mocked(axios.get).mockResolvedValue({ data: 'image-data' });
    vi.mocked(axios.post).mockResolvedValue({
      data: { photo: 'photo', server: 1, hash: 'hash' },
    });

    const request = provider.upload('1', accessToken, imagePost);
    await expect(request).rejects.toBeInstanceOf(BadBody);
    await expectSanitizedFailure(request, [accessToken, mediaUrl, uploadUrl]);
  });

  it.each([
    [{ malicious: true }, 'object'],
    [false, 'boolean'],
    [0, 'zero'],
    [-1, 'negative'],
    [2.5, 'fractional'],
    ['', 'empty'],
    ['not-an-id', 'nonnumeric'],
  ])('rejects a %s saved photo ID (%s)', async (photoId) => {
    vi.spyOn(provider, 'fetch')
      .mockResolvedValueOnce(response({ response: { upload_url: uploadUrl } }))
      .mockResolvedValueOnce(response({ response: [{ id: photoId }] }));
    vi.mocked(axios.get).mockResolvedValue({ data: 'image-data' });
    vi.mocked(axios.post).mockResolvedValue({
      data: { photo: 'photo', server: 1, hash: 'hash' },
    });

    const request = provider.upload('1', accessToken, imagePost);
    await expect(request).rejects.toBeInstanceOf(BadBody);
    await expectSanitizedFailure(request, [accessToken, mediaUrl, uploadUrl]);
  });

  it('preserves a digit-only saved photo ID without numeric conversion', async () => {
    const photoId = '90071992547409931234567890';
    vi.spyOn(provider, 'fetch')
      .mockResolvedValueOnce(response({ response: { upload_url: uploadUrl } }))
      .mockResolvedValueOnce(response({ response: [{ id: photoId }] }));
    vi.mocked(axios.get).mockResolvedValue({ data: 'image-data' });
    vi.mocked(axios.post).mockResolvedValue({
      data: { photo: 'photo', server: 1, hash: 'hash' },
    });

    await expect(provider.upload('1', accessToken, imagePost)).resolves.toEqual(
      [{ id: photoId, type: 'photo' }]
    );
  });

  it('sanitizes an Axios media download failure', async () => {
    vi.spyOn(provider, 'fetch').mockResolvedValue(
      response({ response: { upload_url: uploadUrl } })
    );
    vi.mocked(axios.get).mockRejectedValue(
      Object.assign(new Error('download failed'), {
        config: { url: mediaUrl },
      })
    );

    const request = provider.upload('1', accessToken, imagePost);
    await expect(request).rejects.toBeInstanceOf(BadBody);
    await expectSanitizedFailure(request, [accessToken, mediaUrl, uploadUrl]);
  });

  it('sanitizes an Axios media upload failure', async () => {
    vi.spyOn(provider, 'fetch').mockResolvedValue(
      response({ response: { upload_url: uploadUrl } })
    );
    vi.mocked(axios.get).mockResolvedValue({ data: 'image-data' });
    vi.mocked(axios.post).mockRejectedValue(
      Object.assign(new Error('upload failed'), {
        config: { url: uploadUrl },
      })
    );

    const request = provider.upload('1', accessToken, imagePost);
    await expect(request).rejects.toBeInstanceOf(BadBody);
    await expectSanitizedFailure(request, [accessToken, mediaUrl, uploadUrl]);
  });

  it('rejects non-refresh VK media errors without leaking credentials', async () => {
    vi.spyOn(provider, 'fetch').mockResolvedValue(
      response({ error: { error_code: 15, error_msg: 'access denied' } })
    );

    const request = provider.upload('1', accessToken, imagePost);
    await expect(request).rejects.toBeInstanceOf(BadBody);
    await expectSanitizedFailure(request);
  });

  it('rejects a wall.post response without post_id', async () => {
    vi.spyOn(provider, 'fetch').mockResolvedValue(response({ response: {} }));

    const request = provider.post('1', accessToken, [textPost]);
    await expect(request).rejects.toBeInstanceOf(BadBody);
    await expectSanitizedFailure(request);
  });

  it('returns a concrete release URL for a verified post_id', async () => {
    vi.spyOn(provider, 'fetch').mockResolvedValue(
      response({ response: { post_id: 77 } })
    );

    await expect(
      provider.post('1', accessToken, [textPost])
    ).resolves.toMatchObject([
      {
        postId: '77',
        releaseURL: 'https://vk.com/feed?w=wall1_77',
        status: 'completed',
      },
    ]);
  });

  it('rejects an empty wall.post ID', async () => {
    vi.spyOn(provider, 'fetch').mockResolvedValue(
      response({ response: { post_id: '' } })
    );

    await expect(
      provider.post('1', accessToken, [textPost])
    ).rejects.toBeInstanceOf(BadBody);
  });

  it.each([
    [{ malicious: true }, 'object'],
    [true, 'boolean'],
    [0, 'zero'],
    [-1, 'negative'],
    [1.5, 'fractional'],
    ['abc', 'nonnumeric'],
  ])('rejects a %s wall.post ID (%s)', async (postId) => {
    vi.spyOn(provider, 'fetch').mockResolvedValue(
      response({ response: { post_id: postId } })
    );

    await expect(
      provider.post('1', accessToken, [textPost])
    ).rejects.toBeInstanceOf(BadBody);
  });

  it('preserves a valid digit-only wall.post ID without numeric conversion', async () => {
    const postId = '90071992547409931234567890';
    vi.spyOn(provider, 'fetch').mockResolvedValue(
      response({ response: { post_id: postId } })
    );

    await expect(provider.post('1', accessToken, [textPost])).resolves.toEqual([
      expect.objectContaining({ postId }),
    ]);
  });

  it('rejects a wall.createComment response without comment_id', async () => {
    vi.spyOn(provider, 'fetch').mockResolvedValue(response({ response: {} }));

    const request = provider.comment(
      '1',
      '77',
      undefined,
      accessToken,
      [textPost],
      {} as any
    );
    await expect(request).rejects.toBeInstanceOf(BadBody);
    await expectSanitizedFailure(request);
  });

  it('rejects an empty wall.createComment ID', async () => {
    vi.spyOn(provider, 'fetch').mockResolvedValue(
      response({ response: { comment_id: '' } })
    );

    await expect(
      provider.comment('1', '77', undefined, accessToken, [textPost], {} as any)
    ).rejects.toBeInstanceOf(BadBody);
  });

  it.each([
    [{ malicious: true }, 'object'],
    [false, 'boolean'],
    [0, 'zero'],
    [-1, 'negative'],
    [2.5, 'fractional'],
    ['not-an-id', 'nonnumeric'],
  ])('rejects a %s wall.createComment ID (%s)', async (commentId) => {
    vi.spyOn(provider, 'fetch').mockResolvedValue(
      response({ response: { comment_id: commentId } })
    );

    await expect(
      provider.comment('1', '77', undefined, accessToken, [textPost], {} as any)
    ).rejects.toBeInstanceOf(BadBody);
  });
});

describe('VkProvider OAuth response validation', () => {
  let provider: TestVkProvider;

  beforeEach(() => {
    provider = new TestVkProvider();
    vi.clearAllMocks();
  });

  it('preserves the personal VK AuthTokenDetails shape', async () => {
    vi.spyOn(provider, 'fetch')
      .mockResolvedValueOnce(
        response({
          response: {
            access_token: 'new-access-secret',
            refresh_token: 'new-refresh-secret',
            expires_in: 3600,
          },
        })
      )
      .mockResolvedValueOnce(
        response({
          response: {
            user: {
              user_id: '123',
              first_name: 'Ada',
              last_name: 'Lovelace',
              avatar: 'https://cdn.example.test/avatar.png',
            },
          },
        })
      );

    await expect(
      provider.authenticate({
        code: 'authorization-code&&&&device-1',
        codeVerifier: 'verifier',
      })
    ).resolves.toMatchInlineSnapshot(`
      {
        "accessToken": "new-access-secret",
        "expiresIn": 3600,
        "id": "123",
        "name": "Ada Lovelace",
        "picture": "https://cdn.example.test/avatar.png",
        "refreshToken": "new-refresh-secret&&&&device-1",
        "username": "ada",
      }
    `);
  });

  it('rejects a successful auth response without an access token before user_info', async () => {
    const fetchMock = vi.spyOn(provider, 'fetch').mockResolvedValue(
      response({
        response: {
          refresh_token: 'refresh-secret',
          expires_in: 3600,
        },
      })
    );

    const request = provider.authenticate({
      code: 'authorization-code&&&&device-1',
      codeVerifier: 'verifier',
    });

    await expect(request).rejects.toBeInstanceOf(BadBody);
    await expectSanitizedFailure(request, ['refresh-secret']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a successful refresh response without a refresh token', async () => {
    const fetchMock = vi.spyOn(provider, 'fetch').mockResolvedValue(
      response({
        response: {
          access_token: 'new-access-secret',
          expires_in: 3600,
        },
      })
    );

    const request = provider.refreshToken('old-refresh-secret&&&&device-1');

    await expect(request).rejects.toBeInstanceOf(BadBody);
    await expectSanitizedFailure(request, [
      'old-refresh-secret',
      'new-access-secret',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a successful auth response without expires_in', async () => {
    const fetchMock = vi.spyOn(provider, 'fetch').mockResolvedValue(
      response({
        response: {
          access_token: 'new-access-secret',
          refresh_token: 'new-refresh-secret',
        },
      })
    );

    const request = provider.authenticate({
      code: 'authorization-code&&&&device-1',
      codeVerifier: 'verifier',
    });

    await expect(request).rejects.toBeInstanceOf(BadBody);
    await expectSanitizedFailure(request, [
      'new-access-secret',
      'new-refresh-secret',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a successful user_info response without a nested user', async () => {
    vi.spyOn(provider, 'fetch')
      .mockResolvedValueOnce(
        response({
          response: {
            access_token: 'new-access-secret',
            refresh_token: 'new-refresh-secret',
            expires_in: 3600,
          },
        })
      )
      .mockResolvedValueOnce(response({ response: {} }));

    const request = provider.authenticate({
      code: 'authorization-code&&&&device-1',
      codeVerifier: 'verifier',
    });

    await expect(request).rejects.toBeInstanceOf(BadBody);
    await expectSanitizedFailure(request, [
      'new-access-secret',
      'new-refresh-secret',
    ]);
  });

  it('rejects a nested user without required profile fields', async () => {
    vi.spyOn(provider, 'fetch')
      .mockResolvedValueOnce(
        response({
          response: {
            access_token: 'new-access-secret',
            refresh_token: 'new-refresh-secret',
            expires_in: 3600,
          },
        })
      )
      .mockResolvedValueOnce(
        response({ response: { user: { user_id: '123' } } })
      );

    const request = provider.authenticate({
      code: 'authorization-code&&&&device-1',
      codeVerifier: 'verifier',
    });

    await expect(request).rejects.toBeInstanceOf(BadBody);
    await expectSanitizedFailure(request, [
      'new-access-secret',
      'new-refresh-secret',
    ]);
  });

  it('rejects an auth code without a device ID before contacting VK', async () => {
    const fetchMock = vi.spyOn(provider, 'fetch');

    await expect(
      provider.authenticate({
        code: 'authorization-code',
        codeVerifier: 'verifier',
      })
    ).rejects.toBeInstanceOf(BadBody);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
