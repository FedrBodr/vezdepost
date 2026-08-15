export type EditorMode = 'none' | 'normal' | 'markdown' | 'html';
export type FormattingSupport = 'native' | 'unicode' | 'plain' | 'unsupported';
export type ContentMessageSeverity = 'information' | 'warning' | 'error';

export interface PlatformCapabilities {
  identifier: string;
  verified: boolean;
  output: EditorMode;
  formatting: {
    bold: FormattingSupport;
    underline: FormattingSupport;
    links: FormattingSupport;
    lists: FormattingSupport;
    headings: FormattingSupport;
  };
  text: { max: number; mediaCaptionMax?: number };
  media: {
    required: boolean;
    images: boolean;
    videos: boolean;
    maxImages?: number;
    maxVideos?: number;
    videoRequiresCover?: boolean;
  };
  specialFields: Array<{ key: string; required: boolean }>;
  delivery: {
    longMediaText: 'caption' | 'split-after-media' | 'not-applicable';
  };
}

export interface LegacyCapabilityFallback {
  editor: EditorMode;
  maximumCharacters: number;
}

const plainFormatting = {
  bold: 'unicode',
  underline: 'unicode',
  links: 'plain',
  lists: 'plain',
  headings: 'plain',
} as const;

const activeProfiles: Record<string, PlatformCapabilities> = {
  telegram: {
    identifier: 'telegram',
    verified: true,
    output: 'html',
    formatting: {
      bold: 'native',
      underline: 'native',
      links: 'unsupported',
      lists: 'plain',
      headings: 'plain',
    },
    text: { max: 4096, mediaCaptionMax: 1024 },
    media: { required: false, images: true, videos: true },
    specialFields: [],
    delivery: { longMediaText: 'split-after-media' },
  },
  max: {
    identifier: 'max',
    verified: true,
    output: 'html',
    formatting: {
      bold: 'native',
      underline: 'native',
      links: 'native',
      lists: 'plain',
      headings: 'plain',
    },
    text: { max: 4000 },
    media: { required: false, images: true, videos: false },
    specialFields: [],
    delivery: { longMediaText: 'caption' },
  },
  linkedin: {
    identifier: 'linkedin',
    verified: true,
    output: 'normal',
    formatting: plainFormatting,
    text: { max: 3000 },
    media: { required: false, images: true, videos: true, maxVideos: 1 },
    specialFields: [],
    delivery: { longMediaText: 'not-applicable' },
  },
  tumblr: {
    identifier: 'tumblr',
    verified: true,
    output: 'normal',
    formatting: plainFormatting,
    text: { max: 32768 },
    media: {
      required: false,
      images: true,
      videos: true,
      maxImages: 30,
      maxVideos: 1,
    },
    specialFields: [
      { key: 'title', required: false },
      { key: 'link', required: false },
      { key: 'sourceUrl', required: false },
      { key: 'tags', required: false },
    ],
    delivery: { longMediaText: 'not-applicable' },
  },
  pinterest: {
    identifier: 'pinterest',
    verified: true,
    output: 'normal',
    formatting: plainFormatting,
    text: { max: 500 },
    media: {
      required: true,
      images: true,
      videos: true,
      maxImages: 5,
      maxVideos: 1,
      videoRequiresCover: true,
    },
    specialFields: [
      { key: 'title', required: false },
      { key: 'link', required: false },
      { key: 'board', required: true },
    ],
    delivery: { longMediaText: 'not-applicable' },
  },
  vk: {
    identifier: 'vk',
    verified: true,
    output: 'normal',
    formatting: plainFormatting,
    text: { max: 16384 },
    media: { required: false, images: true, videos: true },
    specialFields: [],
    delivery: { longMediaText: 'not-applicable' },
  },
  'vk-group': {
    identifier: 'vk-group',
    verified: true,
    output: 'normal',
    formatting: plainFormatting,
    text: { max: 16384 },
    media: {
      required: false,
      images: true,
      videos: false,
      maxImages: 10,
      maxVideos: 0,
    },
    specialFields: [],
    delivery: { longMediaText: 'not-applicable' },
  },
};

const supportRank: FormattingSupport[] = [
  'unsupported',
  'plain',
  'unicode',
  'native',
];
const weakest = (values: FormattingSupport[]) =>
  supportRank[Math.min(...values.map((value) => supportRank.indexOf(value)))];
const strictestDefined = (values: Array<number | undefined>) => {
  const defined = values.filter(
    (value): value is number => value !== undefined
  );
  return defined.length ? Math.min(...defined) : undefined;
};

export const getPlatformCapabilities = (
  identifier: string,
  fallback: LegacyCapabilityFallback = {
    editor: 'normal',
    maximumCharacters: 1_000_000,
  }
): PlatformCapabilities =>
  activeProfiles[identifier] || {
    identifier,
    verified: false,
    output: fallback.editor,
    formatting:
      fallback.editor === 'none'
        ? {
            bold: 'unsupported',
            underline: 'unsupported',
            links: 'unsupported',
            lists: 'unsupported',
            headings: 'unsupported',
          }
        : fallback.editor === 'normal'
        ? plainFormatting
        : {
            bold: 'native',
            underline: 'native',
            links: 'native',
            lists: 'native',
            headings: 'native',
          },
    text: { max: fallback.maximumCharacters },
    media: { required: false, images: true, videos: true },
    specialFields: [],
    delivery: { longMediaText: 'not-applicable' },
  };

export const intersectPlatformCapabilities = (
  profiles: PlatformCapabilities[]
): PlatformCapabilities => {
  const selected = profiles.length
    ? profiles
    : [getPlatformCapabilities('universal')];
  return {
    identifier: 'universal',
    verified: selected.every((item) => item.verified),
    output: 'normal',
    formatting: {
      bold: weakest(selected.map((item) => item.formatting.bold)),
      underline: weakest(selected.map((item) => item.formatting.underline)),
      links: weakest(selected.map((item) => item.formatting.links)),
      lists: weakest(selected.map((item) => item.formatting.lists)),
      headings: weakest(selected.map((item) => item.formatting.headings)),
    },
    text: {
      max: Math.min(...selected.map((item) => item.text.max)),
      mediaCaptionMax: strictestDefined(
        selected.map((item) => item.text.mediaCaptionMax)
      ),
    },
    media: {
      required: selected.some((item) => item.media.required),
      images: selected.every((item) => item.media.images),
      videos: selected.every((item) => item.media.videos),
      maxImages: strictestDefined(selected.map((item) => item.media.maxImages)),
      maxVideos: strictestDefined(selected.map((item) => item.media.maxVideos)),
      videoRequiresCover: selected.some(
        (item) => item.media.videoRequiresCover
      ),
    },
    specialFields: [],
    delivery: { longMediaText: 'not-applicable' },
  };
};
