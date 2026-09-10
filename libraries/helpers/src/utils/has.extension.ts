export const terminalExtension = (
  path: string | undefined | null
): string | undefined => {
  if (!path) {
    return undefined;
  }

  const pathname = path.split(/[?#]/, 1)[0].replace(/\\/g, '/');
  const finalSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dot = finalSegment.lastIndexOf('.');
  if (dot < 0 || dot === finalSegment.length - 1) {
    return undefined;
  }

  return finalSegment.slice(dot + 1).toLowerCase();
};

export const hasExtension = (
  path: string | undefined | null,
  extension: string
): boolean => {
  const expected = extension.replace(/^\./, '').toLowerCase();
  return !!expected && terminalExtension(path) === expected;
};
