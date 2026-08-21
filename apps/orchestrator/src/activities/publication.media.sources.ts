import type { MediaContent } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

export const PUBLICATION_SECONDARY_MEDIA_SOURCE_FIELDS = [
  {
    providerIdentifier: 'youtube',
    container: 'settings',
    field: 'thumbnail',
  },
  {
    providerIdentifier: 'wordpress',
    container: 'settings',
    field: 'main_image',
  },
  {
    providerIdentifier: 'reddit',
    container: 'media',
    field: 'thumbnail',
  },
  {
    providerIdentifier: 'tumblr',
    container: 'media',
    field: 'thumbnail',
  },
] as const;

export type PublicationMediaSource = Partial<MediaContent> &
  Record<string, unknown>;

type CollectPublicationMediaSourcePaths = {
  providerIdentifier: string;
  settings: unknown;
  media: readonly PublicationMediaSource[];
};

function secondaryPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Invalid secondary media source');
  }
  return value;
}

export function collectPublicationMediaSourcePaths({
  providerIdentifier,
  settings,
  media,
}: CollectPublicationMediaSourcePaths): string[] {
  const paths = media.flatMap(({ path }) =>
    typeof path === 'string' && path.trim() ? [path] : []
  );
  const registrations = PUBLICATION_SECONDARY_MEDIA_SOURCE_FIELDS.filter(
    (registration) => registration.providerIdentifier === providerIdentifier
  );

  for (const registration of registrations) {
    if (registration.container === 'media') {
      for (const item of media) {
        const value = item[registration.field];
        if (value !== undefined) paths.push(secondaryPath(value));
      }
      continue;
    }

    const settingsRecord =
      settings && typeof settings === 'object' && !Array.isArray(settings)
        ? (settings as Record<string, unknown>)
        : {};
    const value = settingsRecord[registration.field];
    if (value === undefined) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid secondary media source');
    }
    paths.push(secondaryPath((value as Record<string, unknown>).path));
  }

  return [...new Set(paths)];
}

const parseSettings = (value?: string | null): Record<string, unknown> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  throw new Error('Invalid publication settings');
};

export const parsePublicationMediaSources = (
  value?: string | null
): PublicationMediaSource[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed as PublicationMediaSource[];
  } catch {}
  throw new Error('Invalid publication media');
};

export function collectPublicationThreadMediaSourcePaths({
  providerIdentifier,
  posts,
}: {
  providerIdentifier: string;
  posts: ReadonlyArray<{ settings?: string | null; image?: string | null }>;
}): string[] {
  return [
    ...new Set(
      posts.flatMap((post) =>
        collectPublicationMediaSourcePaths({
          providerIdentifier,
          settings: parseSettings(post.settings),
          media: parsePublicationMediaSources(post.image),
        })
      )
    ),
  ];
}
