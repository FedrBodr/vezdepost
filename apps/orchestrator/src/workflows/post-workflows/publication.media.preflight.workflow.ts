import { ActivityFailure, ApplicationFailure } from '@temporalio/workflow';
import { PUBLICATION_MEDIA_PREFLIGHT_FAILURE_TYPE } from '../../activities/publication.media.preflight';

type PublicationPreflightActivities<T> = {
  getPostsList: (organizationId: string, postId: string) => Promise<T[]>;
  changeState: (
    postId: string,
    state: 'ERROR',
    error: unknown
  ) => Promise<unknown>;
  inAppNotification: (
    organizationId: string,
    subject: string,
    message: string,
    sendEmail: boolean,
    digest: boolean,
    type: 'fail'
  ) => Promise<unknown>;
};

function isPublicationMediaPreflightFailure(
  error: unknown
): error is ActivityFailure & { cause: ApplicationFailure } {
  return (
    error instanceof ActivityFailure &&
    error.cause instanceof ApplicationFailure &&
    error.cause.nonRetryable === true &&
    error.cause.type === PUBLICATION_MEDIA_PREFLIGHT_FAILURE_TYPE
  );
}

export async function getPublicationPostsOrFail<T>({
  organizationId,
  postId,
  getPostsList,
  changeState,
  inAppNotification,
}: {
  organizationId: string;
  postId: string;
} & PublicationPreflightActivities<T>): Promise<T[] | false> {
  try {
    return await getPostsList(organizationId, postId);
  } catch (error) {
    if (!isPublicationMediaPreflightFailure(error)) throw error;

    const safeMessage = error.cause.message || 'Invalid publication media';
    await changeState(postId, 'ERROR', safeMessage);
    await inAppNotification(
      organizationId,
      'We could not prepare your post safely',
      `The post was not published because its media could not be prepared safely: ${safeMessage}`,
      true,
      false,
      'fail'
    );
    return false;
  }
}
