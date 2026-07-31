export interface LegacyPublication {
  state: string;
  releaseId: string | null;
  releaseURL: string | null;
}

export function isTrustedLegacyPublication(post: LegacyPublication): boolean {
  return (
    post.state === 'PUBLISHED' &&
    post.releaseId !== null &&
    post.releaseId.trim() !== '' &&
    post.releaseId !== 'undefined' &&
    !(post.releaseURL ?? '').includes('undefined')
  );
}
