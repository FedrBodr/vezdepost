export const PUBLICATION_MEDIA_PREFLIGHT_FAILURE_TYPE =
  'publication_media_preflight';

const DETERMINISTIC_PUBLICATION_MEDIA_ERRORS = new Set([
  'Blocked remote media URL',
  'Invalid media attachment.',
  'Invalid media list.',
  'Invalid publication integration',
  'Invalid publication media',
  'Invalid publication settings',
  'Invalid secondary media source',
  'Remote media URL is invalid',
  'Remote media URL must use HTTP or HTTPS',
]);

export function isDeterministicPublicationMediaError(
  error: unknown
): error is Error {
  return (
    error instanceof Error &&
    ((error as Error & { code?: unknown }).code === 'INVALID_MEDIA_SOURCE' ||
      DETERMINISTIC_PUBLICATION_MEDIA_ERRORS.has(error.message))
  );
}
