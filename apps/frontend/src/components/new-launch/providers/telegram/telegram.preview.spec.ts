import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../launches/general.preview.component', () => ({
  GeneralPreviewComponent: () => null,
}));
vi.mock('../../../launches/helpers/use.integration', () => ({
  useIntegration: () => ({ value: [] }),
}));

import { shouldShowTelegramSplitWarning } from './telegram.preview';

const post = (content: string, image: Array<{ path: string }> = []) => ({
  content,
  image,
});

describe('shouldShowTelegramSplitWarning', () => {
  it('is hidden for text-only posts', () => {
    expect(shouldShowTelegramSplitWarning([post('x'.repeat(1545))])).toBe(
      false
    );
  });

  it('is hidden at the caption boundary', () => {
    expect(
      shouldShowTelegramSplitWarning([
        post('x'.repeat(1024), [{ path: 'photo.jpg' }]),
      ])
    ).toBe(false);
  });

  it('is visible above the boundary when media exists', () => {
    expect(
      shouldShowTelegramSplitWarning([
        post('<p>' + 'x'.repeat(1025) + '</p>', [{ path: 'photo.jpg' }]),
      ])
    ).toBe(true);
  });
});
