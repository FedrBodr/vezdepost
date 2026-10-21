// Pure module: imported by the onboarding workflow, keep it free of Node/Nest.

/** Plain JSON: it crosses the Temporal activity boundary. */
export type OnboardingState = {
  email: string;
  activated: boolean;
  disabled: boolean;
  deleted: boolean;
  sendOnboardingEmails: boolean;
  organizationId: string | null;
  channelCount: number;
  postCount: number;
  firstChannelAt: string | null;
  assistantLinks: Array<{ transport: string; telegramUserId: string }>;
};

/** The chain is over once the user publishes, opts out or loses access. */
export const isOnboardingFinished = (state: OnboardingState | null) =>
  !state ||
  state.deleted ||
  state.disabled ||
  !state.sendOnboardingEmails ||
  state.postCount > 0;
