import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@gitroom/helpers/utils/read.or.fetch', () => ({
  readOrFetch: vi.fn().mockResolvedValue(Buffer.from('image')),
}));
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
  })),
}));

import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import { SocialAbstract } from './social.abstract';

class ImageDimensionsProbe extends SocialAbstract {
  identifier = 'probe';

  dimensions(path: string) {
    return this.getImageDimensions(path);
  }
}

describe('SocialAbstract image dimension reads', () => {
  beforeEach(() => {
    vi.mocked(readOrFetch).mockClear();
  });

  it('uses the purpose-specific image byte cap and body timeout', async () => {
    await expect(
      new ImageDimensionsProbe().dimensions(
        'https://media.example.test/photo.jpg'
      )
    ).resolves.toEqual({ width: 800, height: 600 });

    expect(readOrFetch).toHaveBeenCalledWith(
      'https://media.example.test/photo.jpg',
      { maxBytes: 10 * 1024 * 1024, bodyTimeoutMs: 30_000 }
    );
  });
});
