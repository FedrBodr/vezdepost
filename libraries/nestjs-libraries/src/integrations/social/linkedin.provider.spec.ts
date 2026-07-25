import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

vi.mock(
  '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface',
  () => ({})
);
vi.mock('@gitroom/nestjs-libraries/services/make.is', () => ({
  makeId: vi.fn(() => 'id'),
}));
vi.mock('@gitroom/helpers/utils/read.or.fetch', () => ({
  readOrFetch: vi.fn(),
}));
vi.mock('@gitroom/helpers/utils/has.extension', () => ({
  hasExtension: vi.fn(() => false),
}));
vi.mock('@gitroom/helpers/utils/timer', () => ({
  timer: vi.fn(),
}));
vi.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  BadBody: class extends Error {},
  SocialAbstract: class {
    assetBoolean(value: unknown) {
      return value === true || value === 'true';
    }

    checkScopes() {
      return undefined;
    }
  },
}));
vi.mock('@gitroom/helpers/decorators/post.plug', () => ({
  PostPlug: () => () => undefined,
}));
vi.mock(
  '@gitroom/nestjs-libraries/dtos/posts/providers-settings/linkedin.dto',
  () => ({ LinkedinDto: class {} })
);
vi.mock('@gitroom/nestjs-libraries/chat/rules.description.decorator', () => ({
  Rules: () => () => undefined,
}));

import { LinkedinProvider } from './linkedin.provider';

beforeEach(() => {
  vi.restoreAllMocks();
  process.env = {
    ...originalEnv,
    FRONTEND_URL: 'https://app.vezdepost.ru',
    LINKEDIN_CLIENT_ID: 'linkedin-client-id',
    LINKEDIN_CLIENT_SECRET: 'linkedin-client-secret',
  };
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

const image = (name: string) => ({
  id: name,
  path: `https://cdn.test/${name}.jpg`,
  type: 'image' as const,
});

const video = {
  id: 'video',
  path: 'https://cdn.test/video.mp4',
  type: 'video' as const,
};

const details = (
  media: Array<ReturnType<typeof image> | typeof video>,
  postAsCarousel: boolean
) => [
  {
    id: 'post-1',
    message: 'LinkedIn post',
    media,
    settings: {
      post_as_images_carousel: postAsCarousel,
    },
  } as any,
];

const prepareProvider = () => {
  const provider = new LinkedinProvider();
  const converted = details([image('carousel')], true);
  const convertImagesToPdfCarousel = vi
    .spyOn(provider as any, 'convertImagesToPdfCarousel')
    .mockResolvedValue(converted);
  const processMediaForPosts = vi
    .spyOn(provider as any, 'processMediaForPosts')
    .mockResolvedValue({ 'post-1': ['asset-1'] });
  const createMainPost = vi
    .spyOn(provider as any, 'createMainPost')
    .mockResolvedValue('urn:li:share:1');

  return {
    provider,
    converted,
    convertImagesToPdfCarousel,
    processMediaForPosts,
    createMainPost,
  };
};

describe('LinkedinProvider carousel fallback', () => {
  it('converts two images and publishes them as a PDF carousel', async () => {
    const setup = prepareProvider();
    const postDetails = details([image('one'), image('two')], true);

    await setup.provider.post(
      'person-1',
      'token',
      postDetails,
      {} as any,
      'personal'
    );

    expect(setup.convertImagesToPdfCarousel).toHaveBeenCalledWith(
      postDetails,
      postDetails[0]
    );
    expect(setup.processMediaForPosts).toHaveBeenCalledWith(
      [setup.converted[0]],
      'token',
      'person-1',
      'personal'
    );
    expect(setup.createMainPost).toHaveBeenCalledWith(
      'person-1',
      'token',
      setup.converted[0],
      ['asset-1'],
      'personal',
      true
    );
  });

  it.each([
    ['one image', [image('one')]],
    ['one video', [video]],
    ['no media', []],
  ])(
    'publishes %s as a regular post when carousel is requested',
    async (_name, media) => {
      const setup = prepareProvider();
      const postDetails = details(media as any, true);

      await setup.provider.post(
        'person-1',
        'token',
        postDetails,
        {} as any,
        'personal'
      );

      expect(setup.convertImagesToPdfCarousel).not.toHaveBeenCalled();
      expect(setup.processMediaForPosts).toHaveBeenCalledWith(
        [postDetails[0]],
        'token',
        'person-1',
        'personal'
      );
      expect(setup.createMainPost).toHaveBeenCalledWith(
        'person-1',
        'token',
        postDetails[0],
        ['asset-1'],
        'personal',
        false
      );
    }
  );

  it('preserves an explicit carousel opt-out for multiple images', async () => {
    const setup = prepareProvider();
    const postDetails = details([image('one'), image('two')], false);

    await setup.provider.post(
      'person-1',
      'token',
      postDetails,
      {} as any,
      'personal'
    );

    expect(setup.convertImagesToPdfCarousel).not.toHaveBeenCalled();
    expect(setup.createMainPost).toHaveBeenCalledWith(
      'person-1',
      'token',
      postDetails[0],
      ['asset-1'],
      'personal',
      false
    );
  });

  it.each([
    { name: 'one image', media: [image('one')] },
    { name: 'one video', media: [video] },
    { name: 'no media', media: [] },
  ])(
    'accepts $name and relies on regular-post fallback',
    async ({ media }) => {
      const provider = new LinkedinProvider();

      await expect(
        provider.checkValidity([media as any], {
          post_as_images_carousel: true,
        })
      ).resolves.toBe(true);
    }
  );

  it('keeps rejecting multiple attachments when one is a video', async () => {
    const provider = new LinkedinProvider();

    await expect(
      provider.checkValidity([[video, image('one')] as any], {
        post_as_images_carousel: true,
      })
    ).resolves.toBe('Can have maximum 1 media when selecting a video.');
  });
});

describe('LinkedinProvider personal OAuth configuration', () => {
  it('generates an interactive authorization URL with only personal scopes', async () => {
    const { url } = await new LinkedinProvider().generateAuthUrl();
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe(
      'https://www.linkedin.com/oauth/v2/authorization'
    );
    expect(parsed.searchParams.get('client_id')).toBe('linkedin-client-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://app.vezdepost.ru/integrations/social/linkedin'
    );
    expect(parsed.searchParams.get('scope')?.split(' ')).toEqual([
      'openid',
      'profile',
      'w_member_social',
    ]);
    expect(parsed.searchParams.has('prompt')).toBe(false);
  });

  it('fails locally when the Client ID is missing', async () => {
    delete process.env.LINKEDIN_CLIENT_ID;

    await expect(new LinkedinProvider().generateAuthUrl()).rejects.toThrow(
      'LINKEDIN_CLIENT_ID is not configured'
    );
  });

  it('fails locally when the Client Secret is missing', async () => {
    delete process.env.LINKEDIN_CLIENT_SECRET;

    await expect(new LinkedinProvider().generateAuthUrl()).rejects.toThrow(
      'LINKEDIN_CLIENT_SECRET is not configured'
    );
  });
});
