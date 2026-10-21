import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';

const PURPOSE = 'onboarding_unsubscribe';

/** Never expires: an unsubscribe link in an old email must keep working. */
export const signOnboardingUnsubscribeToken = (userId: string) =>
  AuthChecker.signJWT({ id: userId, purpose: PURPOSE });

/** The user id of a valid unsubscribe token, or null for anything else. */
export const verifyOnboardingUnsubscribeToken = (token?: string) => {
  if (!token) {
    return null;
  }
  try {
    const payload = AuthChecker.verifyJWT(token) as {
      id?: unknown;
      purpose?: unknown;
    };
    return payload?.purpose === PURPOSE && typeof payload.id === 'string'
      ? payload.id
      : null;
  } catch {
    return null;
  }
};

export const onboardingUnsubscribeUrl = (userId: string) =>
  `${
    process.env.NEXT_PUBLIC_BACKEND_URL
  }/public/onboarding/unsubscribe?token=${encodeURIComponent(
    signOnboardingUnsubscribeToken(userId)
  )}`;
