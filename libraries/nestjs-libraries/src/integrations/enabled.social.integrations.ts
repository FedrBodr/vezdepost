export type SocialIntegrationAllowlistResult = Readonly<{
  configured: boolean;
  allowed: readonly string[];
  unknown: readonly string[];
}>;

export const parseEnabledSocialIntegrations = (
  rawValue: string | undefined,
  registeredIdentifiers: readonly string[]
): SocialIntegrationAllowlistResult => {
  if (!rawValue?.trim()) {
    return {
      configured: false,
      allowed: registeredIdentifiers,
      unknown: [],
    };
  }

  const configuredIdentifiers = Array.from(
    new Set(
      rawValue
        .split(',')
        .map((identifier) => identifier.trim().toLowerCase())
        .filter(Boolean)
    )
  );
  const registered = new Set(registeredIdentifiers);
  const configured = new Set(configuredIdentifiers);

  return {
    configured: true,
    allowed: registeredIdentifiers.filter((identifier) =>
      configured.has(identifier)
    ),
    unknown: configuredIdentifiers.filter(
      (identifier) => !registered.has(identifier)
    ),
  };
};
