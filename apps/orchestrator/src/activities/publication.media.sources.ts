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

type CollectPublicationMediaSourcePaths = {
  providerIdentifier: string;
  settings: unknown;
  media: MediaContent[];
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
  const paths = media.map(({ path }) => path);
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
