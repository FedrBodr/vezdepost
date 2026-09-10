export type DashboardContentValidationFailure =
  | { category: 'too-long' }
  | { category: 'content-error'; message: string };

export const selectDashboardContentValidationFailure = (item: {
  tooLong: boolean;
  contentError?: string;
}): DashboardContentValidationFailure | undefined => {
  if (item.tooLong) {
    return { category: 'too-long' };
  }
  if (item.contentError) {
    return { category: 'content-error', message: item.contentError };
  }
  return undefined;
};
