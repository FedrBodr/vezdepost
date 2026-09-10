export const isAllowedMoltbookClaimUrl = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'www.moltbook.com' &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith('/claim/') &&
      url.pathname.length > '/claim/'.length
    );
  } catch {
    return false;
  }
};
