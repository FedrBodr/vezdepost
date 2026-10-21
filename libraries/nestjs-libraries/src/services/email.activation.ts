/**
 * Password sign-ups must confirm their email only when a provider can deliver
 * the link and EMAIL_ACTIVATION_DISABLED is not "true". Vezdepost keeps
 * auto-activation on: the onboarding welcome email is the soft address check.
 */
export const isEmailActivationRequired = (hasEmailProvider: boolean) =>
  hasEmailProvider && process.env.EMAIL_ACTIVATION_DISABLED !== 'true';
