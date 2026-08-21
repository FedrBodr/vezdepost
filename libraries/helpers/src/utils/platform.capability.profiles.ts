import type {
  FormattingSupport,
  PlatformCapabilityProfileV2,
  PostVariantCapability,
  TextFieldCapability,
} from './platform.capability.types';
import {
  TELEGRAM_BODY_LIMIT,
  TELEGRAM_MEDIA_CAPTION_LIMIT,
  TELEGRAM_MEDIA_GROUP_MAX_ITEMS,
} from './telegram.constraints';

const plainFormatting: TextFieldCapability['formatting'] = {
  bold: 'unicode',
  underline: 'unicode',
  links: 'plain',
  lists: 'plain',
  headings: 'plain',
};

const telegramFormatting: TextFieldCapability['formatting'] = {
  bold: 'native',
  underline: 'native',
  links: 'unsupported',
  lists: 'plain',
  headings: 'plain',
};

const maxFormatting: TextFieldCapability['formatting'] = {
  bold: 'native',
  underline: 'native',
  links: 'native',
  lists: 'plain',
  headings: 'plain',
};

const slackFormatting: TextFieldCapability['formatting'] = {
  bold: 'native',
  underline: 'unsupported',
  links: 'native',
  lists: 'plain',
  headings: 'plain',
};

const body = (
  max: number,
  dialect: TextFieldCapability['dialect'],
  formatting: Record<
    'bold' | 'underline' | 'links' | 'lists' | 'headings',
    FormattingSupport
  >,
  source: 'platform' | 'application-safety' = 'platform',
  recommendedMax?: number
): TextFieldCapability => ({
  key: 'body',
  label: 'Body',
  required: false,
  source: 'canonical-editor',
  dialect,
  limit: {
    max,
    unit: dialect === 'slack-mrkdwn' ? 'utf16-code-units' : 'graphemes',
    source,
    ...(recommendedMax === undefined ? {} : { recommendedMax }),
  },
  formatting,
});

const caption = (): TextFieldCapability => ({
  ...body(1_024, 'html', telegramFormatting),
  key: 'caption',
  label: 'Media caption',
  limit: { ...TELEGRAM_MEDIA_CAPTION_LIMIT },
});

const telegramBody = (): TextFieldCapability => ({
  ...body(4_096, 'html', telegramFormatting),
  limit: { ...TELEGRAM_BODY_LIMIT },
});

const telegramText: PostVariantCapability = {
  key: 'text',
  fields: [telegramBody()],
  structuredFields: [],
  media: {
    type: 'optional',
    images: { min: 1 },
    videos: { min: 1 },
    mixed: true,
  },
  delivery: {
    longMediaText: 'not-applicable',
    stripRawUrls: false,
    mediaGroupMaxItems: TELEGRAM_MEDIA_GROUP_MAX_ITEMS,
  },
};

const telegramMedia: PostVariantCapability = {
  ...telegramText,
  key: 'media',
  fields: [telegramBody(), caption()],
  delivery: {
    longMediaText: 'split-after-media',
    stripRawUrls: false,
    mediaGroupMaxItems: TELEGRAM_MEDIA_GROUP_MAX_ITEMS,
  },
};

const simpleVariant = (
  key: string,
  limit: number,
  dialect: TextFieldCapability['dialect'],
  formatting: TextFieldCapability['formatting'],
  media: PostVariantCapability['media'] = {
    type: 'optional',
    images: { min: 1, max: 10 },
    videos: { min: 1, max: 1 },
    mixed: true,
  },
  structuredFields: PostVariantCapability['structuredFields'] = [],
  delivery: PostVariantCapability['delivery'] = {
    longMediaText: 'not-applicable',
    stripRawUrls: false,
  },
  source: 'platform' | 'application-safety' = 'platform',
  recommendedMax?: number
): PostVariantCapability => ({
  key,
  fields: [body(limit, dialect, formatting, source, recommendedMax)],
  structuredFields,
  media,
  delivery,
});

const evidenceDate = '2026-08-20';

const profiles: Record<string, PlatformCapabilityProfileV2> = {
  telegram: {
    identifier: 'telegram',
    displayName: 'Telegram',
    verification: 'verified',
    evidenceDate,
    defaultVariant: 'text',
    variants: { text: telegramText, media: telegramMedia },
  },
  max: {
    identifier: 'max',
    displayName: 'MAX',
    verification: 'verified',
    evidenceDate,
    defaultVariant: 'post',
    variants: {
      post: simpleVariant('post', 4_000, 'html', maxFormatting, {
        type: 'optional',
        images: { min: 1, max: 10 },
      }),
    },
  },
  linkedin: {
    identifier: 'linkedin',
    displayName: 'LinkedIn',
    verification: 'verified',
    evidenceDate,
    defaultVariant: 'feed',
    variants: {
      feed: simpleVariant('feed', 3_000, 'plain', plainFormatting, {
        type: 'exclusive',
        optional: true,
        alternatives: [
          { kind: 'images', min: 1, max: 10 },
          { kind: 'video', min: 1, max: 1 },
        ],
      }),
    },
  },
  'linkedin-page': {
    identifier: 'linkedin-page',
    displayName: 'LinkedIn Page',
    verification: 'verified',
    evidenceDate,
    defaultVariant: 'feed',
    variants: {},
    aliasOf: 'linkedin',
  },
  tumblr: {
    identifier: 'tumblr',
    displayName: 'Tumblr',
    verification: 'verified',
    evidenceDate,
    defaultVariant: 'post',
    variants: {
      post: simpleVariant(
        'post',
        32_768,
        'plain',
        plainFormatting,
        {
          type: 'optional',
          images: { min: 1, max: 30 },
          videos: { min: 1, max: 1 },
          mixed: true,
        },
        [
          { key: 'title', label: 'Title', required: false },
          { key: 'link', label: 'Link', required: false },
          { key: 'sourceUrl', label: 'Source URL', required: false },
          { key: 'tags', label: 'Tags', required: false },
        ]
      ),
    },
  },
  pinterest: {
    identifier: 'pinterest',
    displayName: 'Pinterest',
    verification: 'verified',
    evidenceDate,
    defaultVariant: 'pin',
    variants: {
      pin: simpleVariant(
        'pin',
        500,
        'plain',
        plainFormatting,
        {
          type: 'exclusive',
          alternatives: [
            { kind: 'images', min: 1, max: 5 },
            { kind: 'video', min: 1, max: 1, coverRequired: true },
          ],
        },
        [
          { key: 'title', label: 'Title', required: false },
          { key: 'link', label: 'Link', required: false },
          { key: 'board', label: 'Board', required: true },
        ]
      ),
    },
  },
  vk: {
    identifier: 'vk',
    displayName: 'VK',
    verification: 'verified',
    evidenceDate,
    defaultVariant: 'post',
    variants: {
      post: simpleVariant('post', 16_384, 'plain', plainFormatting),
    },
  },
  'vk-group': {
    identifier: 'vk-group',
    displayName: 'VK Group',
    verification: 'verified',
    evidenceDate,
    defaultVariant: 'post',
    variants: {
      post: simpleVariant('post', 16_384, 'plain', plainFormatting, {
        type: 'optional',
        images: { min: 1, max: 10 },
      }),
    },
  },
  slack: {
    identifier: 'slack',
    displayName: 'Slack',
    verification: 'verified',
    evidenceDate,
    defaultVariant: 'message',
    variants: {
      message: simpleVariant(
        'message',
        40_000,
        'slack-mrkdwn',
        slackFormatting,
        { type: 'optional' },
        [],
        { longMediaText: 'not-applicable', stripRawUrls: false },
        'platform',
        4_000
      ),
    },
  },
  tiktok: {
    identifier: 'tiktok',
    displayName: 'TikTok',
    verification: 'verified',
    evidenceDate,
    defaultVariant: 'video',
    variants: {
      video: {
        key: 'video',
        fields: [
          {
            ...body(2_200, 'plain', plainFormatting),
            key: 'caption',
            label: 'Caption',
            required: false,
            limit: {
              max: 2_200,
              unit: 'utf16-code-units',
              source: 'platform',
            },
          },
        ],
        structuredFields: [],
        media: {
          type: 'exclusive',
          alternatives: [{ kind: 'video', min: 1, max: 1 }],
        },
        delivery: { longMediaText: 'caption', stripRawUrls: false },
      },
      photo: {
        key: 'photo',
        fields: [
          {
            key: 'title',
            label: 'Title',
            required: false,
            source: 'provider-setting',
            dialect: 'plain',
            limit: {
              max: 90,
              unit: 'utf16-code-units',
              source: 'platform',
            },
            formatting: plainFormatting,
          },
          {
            ...body(4_000, 'plain', plainFormatting),
            key: 'description',
            label: 'Description',
            limit: {
              max: 4_000,
              unit: 'utf16-code-units',
              source: 'platform',
            },
          },
        ],
        structuredFields: [],
        media: {
          type: 'exclusive',
          alternatives: [{ kind: 'images', min: 1, max: 35 }],
        },
        delivery: { longMediaText: 'not-applicable', stripRawUrls: false },
      },
    },
  },
  mastodon: {
    identifier: 'mastodon',
    displayName: 'Mastodon',
    verification: 'runtime',
    evidenceDate,
    defaultVariant: 'status',
    variants: {
      status: simpleVariant(
        'status',
        500,
        'plain',
        plainFormatting,
        {
          type: 'provider-runtime',
          fallback: {
            type: 'optional',
            images: { min: 1, max: 4 },
            videos: { min: 1, max: 1 },
            mixed: true,
          },
        },
        [{ key: 'contentWarning', label: 'Content warning', required: false }],
        { longMediaText: 'not-applicable', stripRawUrls: false },
        'application-safety'
      ),
    },
    runtimeKeys: ['text-limit', 'media-rule'],
    runtimeMaxAgeSeconds: 3_600,
  },
};

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
};

export const BATCH_0_IDENTIFIERS = deepFreeze([
  'telegram',
  'max',
  'linkedin',
  'linkedin-page',
  'tumblr',
  'pinterest',
  'vk',
  'vk-group',
  'slack',
  'tiktok',
  'mastodon',
] as const);

export const BATCH_0_PROFILES = deepFreeze(profiles);
