import { timer } from '@gitroom/helpers/utils/timer';
import { Integration } from '@prisma/client';
import {
  AuthTokenDetails,
  PendingCheckResponse,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { ApplicationFailure } from '@temporalio/activity';
import { setHeartbeatDetails } from '@gitroom/nestjs-libraries/temporal/temporal.heartbeat';
import {
  InvalidMediaSourceError,
  type MediaSourceOptions,
  getMediaSourceMetadata,
  readMediaSourceBuffer,
  withMediaSourceRange,
  withMediaSourceStream,
} from '@gitroom/helpers/utils/media.source';
import {
  SAFE_REMOTE_IMAGE_FETCH_BODY_TIMEOUT_MS,
  SAFE_REMOTE_IMAGE_FETCH_MAX_BYTES,
} from '@gitroom/helpers/utils/ssrf.safe.fetch';
import {
  getSsrfSafeAxios,
  getSsrfSafeDispatcher,
} from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import sharp from 'sharp';
import { PassThrough, Readable } from 'stream';
import { pipeline } from 'stream/promises';

// media.source bounds every remote read with idle and body deadlines and
// reports a stalled transfer with one of these messages; undici's own
// TimeoutError covers the header phase.
const isReadTimeout = (err: any) =>
  err?.name === 'TimeoutError' ||
  err?.cause?.name === 'TimeoutError' ||
  /aborted by (idle )?timeout|body download timeout|timed out/i.test(
    String(err?.message || '')
  );

// A media source that is not allowed (outside the upload directory, private
// address) or too large never succeeds on retry, so it fails the post with a
// readable message instead of looping through Temporal retries.
const toMediaError = (err: any, identifier: string) =>
  err instanceof InvalidMediaSourceError ||
  /too large|Invalid (remote )?media|Blocked (IP|remote media URL)|Remote media URL (is invalid|must use)|redirect|request failed with 4\d\d/i.test(
    String(err?.message || '')
  )
    ? new BadBody(
        identifier,
        JSON.stringify({ error: String(err?.message || err) }),
        Buffer.from('{}'),
        'We could not read the media for this post, so it was not published'
      )
    : err;

// Sizes resolved by mediaSize, reused by mediaChunk so a chunked upload does
// not issue a HEAD per chunk. Bounded: providers are long-lived singletons.
const knownMediaSizes = new Map<string, number>();
const rememberMediaSize = (path: string, size: number) => {
  knownMediaSizes.delete(path);
  knownMediaSizes.set(path, size);
  if (knownMediaSizes.size > 100) {
    knownMediaSizes.delete(knownMediaSizes.keys().next().value as string);
  }
};

export const stripQuery = (url: string) => {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch (err) {
    return url.split('?')[0];
  }
};

export type ValidityMedia = {
  path: string;
  thumbnail?: string;
  type?: 'image' | 'video' | string;
};

// Temporal serializes the whole ApplicationFailure (message + details) into the
// workflow history and ships it over gRPC, which has a hard frame limit (4MB by
// default). Provider error messages/bodies can be huge (full HTML error pages,
// base64 media echoed back, stack traces), so we cap every string that goes into
// the failure to keep the history small and avoid "GRPC Message too large".
const MAX_FAILURE_MESSAGE = 2_000;
const MAX_FAILURE_FIELD = 4_000;

export function truncateForTemporal(value: any, max: number): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = typeof value === 'string' ? value : safeStringify(value);
  if (str.length <= max) {
    return str;
  }

  return `${str.slice(0, max)}… [truncated ${str.length - max} chars]`;
}

export class RefreshToken extends ApplicationFailure {
  constructor(identifier: string, json: string, body: BodyInit, message = '') {
    super(
      truncateForTemporal(message, MAX_FAILURE_MESSAGE),
      'refresh_token',
      true,
      [
        {
          identifier,
          json: truncateForTemporal(json, MAX_FAILURE_FIELD),
          body: truncateForTemporal(body, MAX_FAILURE_FIELD),
        },
      ]
    );
  }
}

// A `disconnect` error means the platform will keep rejecting this channel no
// matter how many times the token is refreshed (e.g. TikTok's daily active
// user cap): the channel must be disconnected so the user re-connects it,
// possibly through another provider (see MIGRATE_PROVIDERS).
export class Disconnect extends ApplicationFailure {
  constructor(identifier: string, json: string, body: BodyInit, message = '') {
    super(
      truncateForTemporal(message, MAX_FAILURE_MESSAGE),
      'disconnect',
      true,
      [
        {
          identifier,
          json: truncateForTemporal(json, MAX_FAILURE_FIELD),
          body: truncateForTemporal(body, MAX_FAILURE_FIELD),
        },
      ]
    );
  }
}

export class BadBody extends ApplicationFailure {
  constructor(identifier: string, json: string, body: BodyInit, message = '') {
    super(truncateForTemporal(message, MAX_FAILURE_MESSAGE), 'bad_body', true, [
      {
        identifier,
        json: truncateForTemporal(json, MAX_FAILURE_FIELD),
        body: truncateForTemporal(body, MAX_FAILURE_FIELD),
      },
    ]);
  }
}

export class NotEnoughScopes {
  constructor(
    public message = 'Not enough scopes, when choosing a provider, please add all the scopes'
  ) {}
}

function safeStringify(obj: any) {
  const seen = new WeakSet();

  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  });
}

export abstract class SocialAbstract {
  abstract identifier: string;
  maxConcurrentJob = 1;

  public handleErrors(
    body: string,
    status: number
  ):
    | {
        type: 'refresh-token' | 'bad-body' | 'retry' | 'disconnect';
        value: string;
      }
    | undefined {
    return undefined;
  }

  /**
   * When a provider is migrated to another one (MIGRATE_PROVIDERS env), the two
   * apps return different app-scoped ids, so a reconnect is matched to the
   * existing channel by profile instead. Override when a provider pair needs a
   * different matching rule.
   */
  public migrationMatch(
    auth: Pick<AuthTokenDetails, 'id' | 'username'>,
    integration: Integration
  ): boolean {
    return !!auth.username && auth.username === integration.profile;
  }

  /**
   * Server-side replacement for the old client-side `checkValidity`.
   * Validates the media attached to a post (and its comments) against the
   * provider rules. Returns `true` when valid, or an error message string.
   *
   * `posts` mirrors the client shape: the outer array is the main post followed
   * by each comment, the inner array is the media items for that entry.
   *
   * Note: video-duration validations that used to run in the browser are not
   * re-implemented here (no ffmpeg dependency). Image-dimension checks use sharp.
   */
  async checkValidity(
    posts: Array<ValidityMedia[]>,
    settings: any,
    additionalSettings: any[]
  ): Promise<string | true> {
    return true;
  }

  /**
   * Providers that return a `pending` PostResponse from `post` / `comment` must
   * override this with a single, read-only status check (no loops, no timers) -
   * the polling loop lives in the post workflow, where a retry is harmless.
   *
   * The defaults throw so a provider that returns `pending` without overriding
   * fails loudly on the first test post instead of silently completing with a
   * bogus releaseURL. They are unreachable for providers that never return
   * `pending`.
   */
  public async checkPostStatus(
    accessToken: string,
    pendingData: any,
    integration: Integration
  ): Promise<PendingCheckResponse> {
    // 'Unknown Error' keeps this developer guard out of the user-facing
    // post.error (changeState only surfaces curated bad_body messages)
    throw new BadBody(
      this.identifier,
      '{"error":"checkPostStatus is not implemented for this provider"}',
      '{}',
      'Unknown Error'
    );
  }

  /** Runs the mutations left after `checkPostStatus` returns `ready`. Same contract as `checkPostStatus`. */
  public async finalizePost(
    accessToken: string,
    pendingData: any,
    integration: Integration
  ): Promise<PendingCheckResponse> {
    throw new BadBody(
      this.identifier,
      '{"error":"finalizePost is not implemented for this provider"}',
      '{}',
      'Unknown Error'
    );
  }

  // axios flavor of the SSRF-safe dispatcher that `this.fetch` applies - for
  // providers that need axios (form-data / stream uploads). Never call plain
  // axios with a user-influenced URL.
  protected getSsrfSafeAxios() {
    return getSsrfSafeAxios();
  }

  protected assetBoolean(value: boolean | string) {
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }
    return value || false;
  }

  /** Reads the pixel dimensions of an image via sharp (works for http or local paths). */
  protected async getImageDimensions(
    path: string
  ): Promise<{ width: number; height: number }> {
    // Stored media paths are relative (e.g. "uploads/x.png"); resolve them to a
    // fetchable URL the same way posts.service.updateMedia does.
    const url =
      path?.indexOf('http') === -1
        ? `${process.env.FRONTEND_URL}/${path}`
        : path;
    setHeartbeatDetails(`read media ${stripQuery(url)}`);
    const { width = 0, height = 0 } = await sharp(
      await this.readOrFetch(url, {
        maxBytes: SAFE_REMOTE_IMAGE_FETCH_MAX_BYTES,
        bodyTimeoutMs: SAFE_REMOTE_IMAGE_FETCH_BODY_TIMEOUT_MS,
      })
    ).metadata();
    return { width, height };
  }

  // Reads the whole media into memory: used for images, which the providers
  // hand straight to sharp. Goes through media.source, which confines local
  // paths to the upload directory and bounds remote reads (SSRF-safe, size,
  // idle and body deadlines). A stall is retried once, then the post fails.
  protected async readOrFetch(
    path: string,
    options?: MediaSourceOptions,
    retried = false
  ): Promise<Buffer> {
    try {
      return await (options
        ? readMediaSourceBuffer(path, options)
        : readMediaSourceBuffer(path));
    } catch (err: any) {
      if (!isReadTimeout(err)) {
        throw toMediaError(err, '');
      }

      if (!retried) {
        return this.readOrFetch(path, options, true);
      }

      throw new BadBody(
        '',
        JSON.stringify({ path: stripQuery(path) }),
        Buffer.from('{}'),
        'We could not read the media for this post, so it was not published'
      );
    }
  }

  // Resolves the total byte size of the media without loading it into memory:
  // a HEAD request for remote URLs, a stat for local uploads.
  protected async mediaSize(path: string, identifier = ''): Promise<number> {
    setHeartbeatDetails(`media size ${stripQuery(path)}`);
    let size: number | undefined;
    try {
      size = (await getMediaSourceMetadata(path)).size;
    } catch (err) {
      throw toMediaError(err, identifier);
    }
    // A zero/unknown size would poison chunk-count math downstream.
    if (!size || !Number.isFinite(size) || size <= 0) {
      throw new BadBody(
        identifier,
        '{}',
        Buffer.from('{}'),
        'Could not determine the media size for upload'
      );
    }
    rememberMediaSize(path, size);
    return size;
  }

  // Reads a single [start, end] byte range into memory. Used by providers whose
  // chunked-upload APIs require a Buffer per segment: only one small chunk is
  // resident at a time, never the whole file. media.source rejects anything
  // but a 206 with the exact Content-Range, so a server that ignores Range
  // never yields a corrupted chunk.
  protected async mediaChunk(
    path: string,
    start: number,
    end: number,
    identifier = '',
    retried = false
  ): Promise<Buffer> {
    setHeartbeatDetails(`media chunk ${start}-${end} ${stripQuery(path)}`);
    const totalSize =
      knownMediaSizes.get(path) ?? (await this.mediaSize(path, identifier));
    try {
      return await withMediaSourceRange(
        path,
        { start, end, totalSize },
        async ({ stream }) => {
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(Buffer.from(chunk));
          return Buffer.concat(chunks);
        }
      );
    } catch (err) {
      if (!isReadTimeout(err)) {
        throw toMediaError(err, identifier);
      }

      // A stall is transient and nothing has been sent to the platform yet,
      // so read the same range once more before giving up.
      if (!retried) {
        return this.mediaChunk(path, start, end, identifier, true);
      }

      // BadBody rather than a retryable error: the read already retried
      // itself, and repeating the publish would re-read the same media and
      // re-upload everything already sent while holding the provider's
      // queue slot. The message is what the user is shown.
      throw new BadBody(
        identifier,
        JSON.stringify({ start, end }),
        Buffer.from('{}'),
        'We could not read the media for this post, so it was not published'
      );
    }
  }

  // Opens the media as a Node stream for streamed uploads. media.source scopes
  // its streams to a callback, so the source is piped into a PassThrough that
  // the caller owns; the bounded read stays open until the caller has drained
  // it, and a stall or size overrun destroys the returned stream.
  protected async mediaStream(
    path: string,
    identifier = ''
  ): Promise<Readable> {
    setHeartbeatDetails(`media stream ${stripQuery(path)}`);
    return new Promise<Readable>((resolve, reject) => {
      let opened = false;
      withMediaSourceStream(path, {}, async ({ stream }) => {
        const out = new PassThrough();
        opened = true;
        resolve(out);
        await pipeline(stream, out);
      }).catch((err) => {
        if (!opened) {
          reject(toMediaError(err, identifier));
        }
      });
    });
  }

  // Streamed request bodies can't be replayed by this.fetch's retry, so
  // providers wrap streamed uploads in a factory that rebuilds the request
  // (re-opening its source streams) on every attempt. Errors carrying a
  // `response` (axios errors, or a thrown { response: { status, data } })
  // go through the same retry and handleErrors classification rules as
  // this.fetch; anything else is rethrown untouched so Temporal keeps its
  // usual retry behavior.
  protected async runStreamedUpload<T>(
    func: () => Promise<T>,
    identifier = '',
    totalRetries = 0
  ): Promise<T> {
    try {
      return await func();
    } catch (err: any) {
      if (!err?.response) {
        throw err;
      }

      const status = err.response.status || 500;
      const data = err.response.data;
      // '|| {}' / "|| '{}'" match this.fetch, which never hands handleErrors
      // an empty string.
      const json =
        (typeof data === 'string' ? data : safeStringify(data || {})) || '{}';
      const handleError = this.handleErrors(json, status);

      if (
        totalRetries <= 2 &&
        (status === 429 ||
          (status === 500 && !handleError) ||
          handleError?.type === 'retry' ||
          json.includes('rate_limit_exceeded') ||
          json.includes('Rate limit'))
      ) {
        await timer(5000);
        return this.runStreamedUpload(func, identifier, totalRetries + 1);
      }

      if (handleError?.type === 'disconnect') {
        throw new Disconnect(identifier, json, '{}', handleError?.value);
      }

      if (
        (status === 401 &&
          (handleError?.type === 'refresh-token' || !handleError)) ||
        handleError?.type === 'refresh-token'
      ) {
        throw new RefreshToken(identifier, json, '{}', handleError?.value);
      }

      throw new BadBody(
        identifier,
        json,
        '{}',
        handleError?.value || 'Unknown Error'
      );
    }
  }

  public async mention(
    token: string,
    d: { query: string },
    id: string,
    integration: Integration
  ): Promise<
    | { id: string; label: string; image: string; doNotCache?: boolean }[]
    | { none: true }
  > {
    return { none: true };
  }

  async runInConcurrent<T>(
    func: (...args: any[]) => Promise<T>,
    ignoreConcurrency?: boolean
  ) {
    let globalErr = {};
    let value: any;
    try {
      value = await func();
    } catch (err) {
      const handle = this.handleErrors(safeStringify(err), 200);
      value = { err: true, value: 'Unknown Error', ...(handle || {}) };
      globalErr = err;
    }

    if (value && value?.err && value?.value) {
      if (value.type === 'refresh-token') {
        throw new RefreshToken(
          '',
          safeStringify({}),
          {} as any,
          value.value || ''
        );
      }
      if (value.type === 'disconnect') {
        throw new Disconnect(
          '',
          safeStringify(globalErr),
          {} as any,
          value.value || ''
        );
      }
      throw new BadBody(
        '',
        safeStringify(globalErr),
        {} as any,
        value.value || ''
      );
    }

    return value;
  }

  async fetch(
    url: string,
    options: RequestInit = {},
    identifier = '',
    totalRetries = 0,
    ignoreConcurrency = false,
    message = ''
  ): Promise<Response> {
    // A platform that accepts the connection and then goes silent leaves the
    // activity with nothing logged until startToCloseTimeout. Record the call
    // first so the timeout failure names it. Query string is dropped - some
    // providers carry access_token there and details are stored by Temporal.
    setHeartbeatDetails(`fetch ${stripQuery(url)}`);

    const request = await fetch(url, {
      ...options,
      // @ts-ignore - undici-only option, not in the lib.dom RequestInit type
      dispatcher: (options as any).dispatcher ?? getSsrfSafeDispatcher(),
    });

    if (request.status === 200 || request.status === 201) {
      return request;
    }

    let json = '{}';
    try {
      json = await request.text();
    } catch (err) {
      json = '{}';
    }

    if (totalRetries > 2) {
      // Include the platform's actual response body so the failure is
      // diagnosable, instead of an empty '{}'.
      throw new BadBody(identifier, json, options.body || '{}', message);
    }

    const handleError = this.handleErrors(json || '{}', request.status);

    if (
      request.status === 429 ||
      (request.status === 500 && !handleError) ||
      json.includes('rate_limit_exceeded') ||
      json.includes('Rate limit')
    ) {
      await timer(5000);
      return this.fetch(
        url,
        options,
        identifier,
        totalRetries + 1,
        ignoreConcurrency,
        handleError?.value || 'Unknown Error'
      );
    }

    if (handleError?.type === 'retry') {
      await timer(5000);
      return this.fetch(
        url,
        options,
        identifier,
        totalRetries + 1,
        ignoreConcurrency,
        handleError?.value || 'Unknown Error'
      );
    }

    if (handleError?.type === 'disconnect') {
      throw new Disconnect(
        identifier,
        json,
        options.body!,
        handleError?.value
      );
    }

    if (
      (request.status === 401 &&
        (handleError?.type === 'refresh-token' || !handleError)) ||
      handleError?.type === 'refresh-token'
    ) {
      throw new RefreshToken(
        identifier,
        json,
        options.body!,
        handleError?.value
      );
    }

    throw new BadBody(
      identifier,
      json,
      options.body!,
      handleError?.value || 'Unknown Error'
    );
  }

  checkScopes(required: string[], got: string | string[]) {
    if (Array.isArray(got)) {
      if (!required.every((scope) => got.includes(scope))) {
        throw new NotEnoughScopes();
      }

      return true;
    }

    const newGot = decodeURIComponent(got);

    const splitType = newGot.indexOf(',') > -1 ? ',' : ' ';
    const gotArray = newGot.split(splitType);
    if (!required.every((scope) => gotArray.includes(scope))) {
      throw new NotEnoughScopes();
    }

    return true;
  }
}
