import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import sharp from 'sharp';
import {
  buildProbeArgs,
  buildStoryVideoArgs,
  prepareStoryPhoto,
  prepareStoryVideo,
} from './telegram.stories.media';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('prepareStoryPhoto', () => {
  it('converts a landscape image to a 1080x1920 JPEG', async () => {
    const input = await sharp({
      create: {
        width: 1600,
        height: 900,
        channels: 3,
        background: '#3366ff',
      },
    })
      .png()
      .toBuffer();

    const output = await prepareStoryPhoto(input);
    const meta = await sharp(output).metadata();

    expect([meta.width, meta.height, meta.format]).toEqual([
      1080,
      1920,
      'jpeg',
    ]);
    expect(output.length).toBeLessThanOrEqual(10 * 1024 * 1024);
  });
});

describe('ffmpeg arguments', () => {
  it('builds an H.265 720x1280 story with one key frame per second', () => {
    const args = buildStoryVideoArgs('/in.mov', '/out.mp4');

    expect(args).toEqual(
      expect.arrayContaining([
        '-i',
        '/in.mov',
        '-c:v',
        'libx265',
        '-tag:v',
        'hvc1',
        '-movflags',
        '+faststart',
      ])
    );
    expect(args.join(' ')).toContain(
      'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280'
    );
    expect(args.join(' ')).toContain('keyint=30:min-keyint=30');
    expect(args.at(-1)).toBe('/out.mp4');
  });

  it('probes the container duration', () => {
    expect(buildProbeArgs('/in.mp4')).toEqual([
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      '/in.mp4',
    ]);
  });
});

describe.skipIf(!hasFfmpeg)('prepareStoryVideo (real ffmpeg)', () => {
  const makeVideo = (seconds: number) =>
    execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        `testsrc=size=1280x720:rate=30:duration=${seconds}`,
        '-f',
        'mp4',
        '-movflags',
        'frag_keyframe+empty_moov',
        'pipe:1',
      ],
      { maxBuffer: 64 * 1024 * 1024 }
    );

  it('transcodes a short clip', async () => {
    const { file, durationSeconds } = await prepareStoryVideo(makeVideo(2));

    expect(durationSeconds).toBeGreaterThan(1.5);
    expect(file.length).toBeGreaterThan(0);
  }, 120_000);

  it('rejects clips longer than 60 seconds', async () => {
    await expect(prepareStoryVideo(makeVideo(61))).rejects.toThrow('60');
  }, 120_000);
});
