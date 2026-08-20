import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('axios', () => ({ default: { get: mocks.axiosGet } }));
vi.mock('@gitroom/helpers/utils/media.source', () => ({
  readMediaSourceBuffer: vi.fn(async (path: string) => {
    const response = await mocks.axiosGet(path, {
      responseType: 'arraybuffer',
    });
    return Buffer.from(response.data);
  }),
}));
vi.mock(
  '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface',
  () => ({})
);
vi.mock('@gitroom/nestjs-libraries/services/make.is', () => ({
  makeId: vi.fn(() => 'state-id'),
}));
vi.mock('@gitroom/helpers/utils/has.extension', () => ({
  hasExtension: vi.fn((path: string, extension: string) =>
    path.split('?')[0].toLowerCase().endsWith(`.${extension}`)
  ),
}));
vi.mock(
  '@gitroom/nestjs-libraries/dtos/posts/providers-settings/tumblr.dto',
  () => ({ TumblrDto: class {} })
);
vi.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  SocialAbstract: class {
    fetch = mocks.fetch;
    async getImageDimensions() {
      return { width: 912, height: 978 };
    }
    checkScopes() {
      return true;
    }
  },
}));

import { TumblrProvider } from './tumblr.provider';

const response = () =>
  ({
    json: vi.fn().mockResolvedValue({ response: { id_string: '42' } }),
  } as unknown as Response);

const integration = {
  profile: 'https://test-blog.tumblr.com',
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue(response());
  mocks.axiosGet.mockResolvedValue({
    data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
  });
});

describe('TumblrProvider multipart uploads', () => {
  it('sends JSON without a filename and image bytes in the matching media part', async () => {
    await new TumblrProvider().post(
      'test-blog',
      'access-token',
      [
        {
          id: 'post-1',
          message: 'image test',
          media: [
            {
              id: 'media-1',
              path: 'https://cdn.test/path/test image.png?signature=redacted',
              type: 'image',
            },
          ],
          settings: {},
        } as any,
      ],
      integration
    );

    const options = mocks.fetch.mock.calls[0][1] as RequestInit;
    const contentType = (options.headers as Record<string, string>)[
      'Content-Type'
    ];
    const boundary = contentType.replace('multipart/form-data; boundary=', '');
    const body = options.body as Buffer;
    const serialized = body.toString('latin1');

    expect(Buffer.isBuffer(body)).toBe(true);
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(serialized).toContain(
      'Content-Disposition: form-data; name="json"\r\n' +
        'Content-Type: application/json\r\n\r\n'
    );
    expect(serialized).not.toContain('name="json"; filename=');
    expect(serialized).toContain(
      'Content-Disposition: form-data; name="media-0"; filename="test_image.png"\r\n' +
        'Content-Type: image/png\r\n\r\n'
    );
    expect(body.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    expect(serialized.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  it('keeps text-only posts as application/json requests', async () => {
    await new TumblrProvider().post(
      'test-blog',
      'access-token',
      [{ id: 'post-2', message: 'text only', media: [], settings: {} } as any],
      integration
    );

    const options = mocks.fetch.mock.calls[0][1] as RequestInit;
    expect((options.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json'
    );
    expect(typeof options.body).toBe('string');
    expect(mocks.axiosGet).not.toHaveBeenCalled();
  });

  it('keeps the safe Tumblr 8005 error message', () => {
    expect(
      new TumblrProvider().handleErrors(
        '{"errors":[{"code":8005,"detail":"unsupported"}]}',
        400
      )
    ).toEqual({
      type: 'bad-body',
      value: 'Tumblr rejected one of the uploaded media files.',
    });
  });
});
