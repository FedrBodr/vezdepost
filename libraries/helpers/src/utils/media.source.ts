import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import {
  SAFE_REMOTE_DNS_TIMEOUT_MS,
  SAFE_REMOTE_FETCH_MAX_BYTES,
  SafeDnsLookup,
  SafeRemoteFetchOptions,
  SafeRemoteStream,
  assertSafeRemoteUrl,
  fetchRemoteBuffer,
  fetchRemoteMetadata,
  withSafeRemoteRange,
  withSafeRemoteStream,
} from './ssrf.safe.fetch';
import {
  resolveAppOwnedLocalUploadFilePath,
  resolveLocalUploadFilePath,
} from './local.upload.path';

export type MediaSourceOptions = SafeRemoteFetchOptions & {
  maxBytes?: number;
};

export type MediaSourceStream = SafeRemoteStream & { local: boolean };

export class InvalidMediaSourceError extends Error {
  readonly code = 'INVALID_MEDIA_SOURCE';

  constructor() {
    super('Invalid media source');
    this.name = 'InvalidMediaSourceError';
  }
}

function isMissingLocalPathError(error: unknown): boolean {
  const code =
    error && typeof error === 'object'
      ? (error as { code?: unknown }).code
      : undefined;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function resolveMediaSource(
  path: string
): { kind: 'local'; path: string } | { kind: 'remote'; url: string } {
  if (/^https?:\/\//i.test(path)) {
    const local = resolveAppOwnedLocalUploadFilePath(path);
    return local
      ? { kind: 'local', path: local }
      : { kind: 'remote', url: path };
  }
  const local = resolveLocalUploadFilePath(path);
  if (!local) throw new InvalidMediaSourceError();
  return { kind: 'local', path: local };
}

async function confinedLocalPath(path: string): Promise<string> {
  const uploadDirectory = process.env.UPLOAD_DIRECTORY;
  if (!uploadDirectory) throw new InvalidMediaSourceError();

  const root = await realpath(resolve(uploadDirectory));
  let file: string;
  try {
    file = await realpath(path);
  } catch (error) {
    if (isMissingLocalPathError(error)) throw new InvalidMediaSourceError();
    throw error;
  }
  const relation = relative(root, file);
  if (
    relation === '..' ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new InvalidMediaSourceError();
  }
  return file;
}

async function confinedLocalFile(path: string) {
  const localPath = await confinedLocalPath(path);
  const details = await stat(localPath);
  if (!details.isFile()) throw new InvalidMediaSourceError();
  return { localPath, details };
}

export async function authorizeMediaSource(
  path: string,
  options: { lookup?: SafeDnsLookup; dnsTimeoutMs?: number } = {}
): Promise<void> {
  const source = resolveMediaSource(path);
  if (source.kind === 'local') {
    await confinedLocalFile(source.path);
    return;
  }
  await assertSafeRemoteUrl(
    source.url,
    options.lookup,
    options.dnsTimeoutMs ?? SAFE_REMOTE_DNS_TIMEOUT_MS
  );
}

export async function readMediaSourceBuffer(
  path: string,
  options: MediaSourceOptions = {}
): Promise<Buffer> {
  const source = resolveMediaSource(path);
  if (source.kind === 'remote') return fetchRemoteBuffer(source.url, options);
  const { localPath, details } = await confinedLocalFile(source.path);
  const maximum = options.maxBytes ?? SAFE_REMOTE_FETCH_MAX_BYTES;
  if (details.size > maximum) throw new Error('Media source is too large');
  return readFile(localPath);
}

export async function withMediaSourceStream<T>(
  path: string,
  options: MediaSourceOptions,
  consume: (source: MediaSourceStream) => Promise<T>
): Promise<T> {
  const source = resolveMediaSource(path);
  if (source.kind === 'remote') {
    return withSafeRemoteStream(source.url, options, (remote) =>
      consume({ ...remote, local: false })
    );
  }

  const { localPath, details } = await confinedLocalFile(source.path);
  const maximum = options.maxBytes ?? SAFE_REMOTE_FETCH_MAX_BYTES;
  if (details.size > maximum) throw new Error('Media source is too large');
  const stream = createReadStream(localPath);
  try {
    return await consume({
      stream,
      size: details.size,
      finalUrl: localPath,
      status: 200,
      headers: new Headers({ 'content-length': String(details.size) }),
      local: true,
    });
  } finally {
    stream.destroy();
  }
}

export async function getMediaSourceMetadata(
  path: string,
  options: MediaSourceOptions = {}
): Promise<{
  size?: number;
  contentType?: string;
  finalUrl: string;
  local: boolean;
}> {
  const source = resolveMediaSource(path);
  if (source.kind === 'remote') {
    return {
      ...(await fetchRemoteMetadata(source.url, options)),
      local: false,
    };
  }
  const { localPath, details } = await confinedLocalFile(source.path);
  if (details.size > (options.maxBytes ?? SAFE_REMOTE_FETCH_MAX_BYTES)) {
    throw new Error('Media source is too large');
  }
  return { size: details.size, finalUrl: localPath, local: true };
}

export async function withMediaSourceRange<T>(
  path: string,
  options: MediaSourceOptions & {
    start: number;
    end: number;
    totalSize: number;
  },
  consume: (source: MediaSourceStream) => Promise<T>
): Promise<T> {
  const source = resolveMediaSource(path);
  if (source.kind === 'remote') {
    return withSafeRemoteRange(source.url, options, (remote) =>
      consume({ ...remote, local: false })
    );
  }
  const { localPath, details } = await confinedLocalFile(source.path);
  const length = options.end - options.start + 1;
  if (
    details.size !== options.totalSize ||
    options.start < 0 ||
    options.end < options.start ||
    options.end >= details.size ||
    length > (options.maxBytes ?? SAFE_REMOTE_FETCH_MAX_BYTES)
  ) {
    throw new Error('Invalid media source range');
  }
  const stream: Readable = createReadStream(localPath, {
    start: options.start,
    end: options.end,
  });
  try {
    return await consume({
      stream,
      size: length,
      finalUrl: localPath,
      status: 206,
      headers: new Headers({
        'content-length': String(length),
        'content-range': `bytes ${options.start}-${options.end}/${details.size}`,
      }),
      local: true,
    });
  } finally {
    stream.destroy();
  }
}
