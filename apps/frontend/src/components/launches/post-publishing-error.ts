const VK_GROUP_SAFE_PUBLICATION_MESSAGES = new Set([
  'Reconnect VK Group through VK authorization to publish photographs.',
  'VK Group photo access is missing. Reconnect VK Group through VK authorization and grant photo access.',
]);

const GENERIC_PUBLICATION_ERROR =
  'An error occurred while publishing this post';
const MAX_SERIALIZED_ERROR_LENGTH = 100_000;
const MAX_VISITED_VALUES = 500;

const findSafeVkGroupMessage = (error: unknown) => {
  if (typeof error !== 'string' || error.length > MAX_SERIALIZED_ERROR_LENGTH) {
    return undefined;
  }

  if (VK_GROUP_SAFE_PUBLICATION_MESSAGES.has(error)) {
    return error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(error);
  } catch {
    return undefined;
  }

  const pending = [parsed];
  let visited = 0;
  while (pending.length && visited < MAX_VISITED_VALUES) {
    const value = pending.shift();
    visited += 1;
    if (typeof value === 'string') {
      if (VK_GROUP_SAFE_PUBLICATION_MESSAGES.has(value)) {
        return value;
      }
      continue;
    }
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (value && typeof value === 'object') {
      pending.push(...Object.values(value));
    }
  }

  return undefined;
};

export const getLocalizedPostPublishingError = (
  providerIdentifier: string,
  error: unknown,
  t: (key: string, fallback: string) => string
) => {
  if (providerIdentifier === 'vk-group') {
    const message = findSafeVkGroupMessage(error);
    if (message) {
      return t(message, message);
    }
  }

  return t(GENERIC_PUBLICATION_ERROR, GENERIC_PUBLICATION_ERROR);
};
