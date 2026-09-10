export const VK_GROUP_PAGE_LOAD_ERROR =
  'Could not load managed VK communities. Reconnect VK Group and try again.';

export const VK_GROUP_SELECTION_ERROR =
  'Could not verify VK Group photo publishing access. Reconnect VK Group and try again.';

export const VK_GROUP_PHOTO_ACCESS_MISSING =
  'VK Group photo access is missing. Reconnect VK Group through VK authorization and grant photo access.';

export const VK_GROUP_LEGACY_TOKEN_RECONNECT =
  'Reconnect VK Group through VK authorization to publish photographs.';
export const VK_GROUP_SELECTION_RECONNECT =
  'Reconnect VK Group through VK authorization and try again.';

export const VK_GROUP_SELECTED_COMMUNITY_NOT_MANAGED =
  'The selected VK community is not managed by this account.';

export const VK_GROUP_SAFE_SELECTION_ERRORS = new Set([
  VK_GROUP_SELECTION_ERROR,
  VK_GROUP_PHOTO_ACCESS_MISSING,
  VK_GROUP_LEGACY_TOKEN_RECONNECT,
  VK_GROUP_SELECTED_COMMUNITY_NOT_MANAGED,
]);

export const getSafeVkGroupSelectionError = (message: unknown) =>
  typeof message === 'string' && VK_GROUP_SAFE_SELECTION_ERRORS.has(message)
    ? message
    : VK_GROUP_SELECTION_ERROR;
