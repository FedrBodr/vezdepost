import sharp from 'sharp';
import { spawn } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { TELEGRAM_STORY_VIDEO_MAX_SECONDS } from '@gitroom/helpers/utils/telegram.stories.constants';

const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 30 * 1024 * 1024;

/** Fits the photo into 1080x1920 over a blurred cover of itself. */
export const prepareStoryPhoto = async (input: Buffer): Promise<Buffer> => {
  const background = await sharp(input)
    .rotate()
    .resize(1080, 1920, { fit: 'cover' })
    .blur(40)
    .toBuffer();
  const foreground = await sharp(input)
    .rotate()
    .resize(1080, 1920, { fit: 'inside' })
    .toBuffer();
  const output = await sharp(background)
    .composite([{ input: foreground, gravity: 'center' }])
    .jpeg({ quality: 88 })
    .toBuffer();
  if (output.length > PHOTO_MAX_BYTES) {
    throw new Error('Story photo exceeds 10 MB after conversion');
  }
  return output;
};

// Only local MP4/MOV input: ffmpeg must not follow playlists or other
// protocols embedded in user-supplied media.
const SAFE_INPUT = ['-protocol_whitelist', 'file', '-f', 'mov'];

// Telegram story video: 720x1280, H.265 in MPEG-4, a key frame every second,
// streamable (faststart).
export const buildStoryVideoArgs = (input: string, output: string) => [
  '-y',
  ...SAFE_INPUT,
  '-i',
  input,
  '-vf',
  'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black,fps=30',
  '-c:v',
  'libx265',
  '-tag:v',
  'hvc1',
  '-preset',
  'fast',
  '-b:v',
  '3000k',
  '-maxrate',
  '3500k',
  '-bufsize',
  '7000k',
  '-x265-params',
  'keyint=30:min-keyint=30:scenecut=0',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '128k',
  '-ac',
  '2',
  '-movflags',
  '+faststart',
  output,
];

export const buildProbeArgs = (input: string) => [
  '-v',
  'error',
  ...SAFE_INPUT,
  '-show_entries',
  'format=duration',
  '-of',
  'default=noprint_wrappers=1:nokey=1',
  input,
];

export const runProcess = (
  command: string,
  args: string[],
  timeoutMs = 5 * 60 * 1_000
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${command} exited with ${code}: ${stderr}`));
      }
    });
  });

let serialQueue: Promise<unknown> = Promise.resolve();

/** Runs CPU-heavy jobs (video encodes) one at a time per process. */
export const runSerially = <T>(job: () => Promise<T>): Promise<T> => {
  const result = serialQueue.then(job, job);
  serialQueue = result.catch(() => undefined);
  return result;
};

export const withTempDir = async <T>(
  fn: (dir: string) => Promise<T>
): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-story-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

export const probeVideoDuration = async (path: string) => {
  const duration = Number(
    (await runProcess('ffprobe', buildProbeArgs(path))).trim()
  );
  if (!Number.isFinite(duration)) {
    throw new Error('Could not read the video duration');
  }
  return duration;
};

export const prepareStoryVideo = (input: Buffer) =>
  withTempDir(async (dir) => {
    const source = join(dir, 'source');
    const output = join(dir, 'story.mp4');
    await writeFile(source, input);
    if ((await probeVideoDuration(source)) > TELEGRAM_STORY_VIDEO_MAX_SECONDS) {
      throw new Error('Story video must be at most 60 seconds long');
    }
    await runSerially(() =>
      runProcess('ffmpeg', buildStoryVideoArgs(source, output))
    );
    const file = await readFile(output);
    if (file.length > VIDEO_MAX_BYTES) {
      throw new Error('Story video exceeds 30 MB after conversion');
    }
    return { file, durationSeconds: await probeVideoDuration(output) };
  });
