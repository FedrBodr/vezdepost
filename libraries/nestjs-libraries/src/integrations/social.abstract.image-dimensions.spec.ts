import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@gitroom/helpers/utils/media.source', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readMediaSourceBuffer: vi.fn().mockResolvedValue(Buffer.from('image')),
}));
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
  })),
}));

import { readMediaSourceBuffer } from '@gitroom/helpers/utils/media.source';
import { SocialAbstract } from './social.abstract';

class ImageDimensionsProbe extends SocialAbstract {
  identifier = 'probe';

  dimensions(path: string) {
    return this.getImageDimensions(path);
  }
}

describe('SocialAbstract image dimension reads', () => {
  beforeEach(() => {
    vi.mocked(readMediaSourceBuffer).mockClear();
  });

  it('uses the purpose-specific image byte cap and body timeout', async () => {
    await expect(
      new ImageDimensionsProbe().dimensions(
        'https://media.example.test/photo.jpg'
      )
    ).resolves.toEqual({ width: 800, height: 600 });

    expect(readMediaSourceBuffer).toHaveBeenCalledWith(
      'https://media.example.test/photo.jpg',
      { maxBytes: 10 * 1024 * 1024, bodyTimeoutMs: 30_000 }
    );
  });
});
