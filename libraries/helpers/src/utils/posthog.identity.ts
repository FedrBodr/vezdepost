export const resetPostHogBeforeRedirect = (
  reset: () => void,
  redirect: () => void
) => {
  try {
    reset();
  } finally {
    redirect();
  }
};
