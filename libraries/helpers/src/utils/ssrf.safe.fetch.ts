import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import net from 'node:net';
import { Readable } from 'node:stream';
import { Agent } from 'undici';

export const SAFE_REMOTE_FETCH_TIMEOUT_MS = 2_000;
export const SAFE_REMOTE_DNS_TIMEOUT_MS = 2_000;
export const SAFE_REMOTE_HEADER_TIMEOUT_MS = 2_000;
export const SAFE_REMOTE_FETCH_BODY_TIMEOUT_MS = 15 * 60 * 1_000;
export const SAFE_REMOTE_FETCH_IDLE_TIMEOUT_MS = 30_000;
export const SAFE_REMOTE_FETCH_MAX_REDIRECTS = 5;
export const SAFE_REMOTE_IMAGE_FETCH_MAX_BYTES = 10 * 1024 * 1024;
export const SAFE_REMOTE_IMAGE_FETCH_BODY_TIMEOUT_MS = 30_000;
export const SAFE_REMOTE_FETCH_MAX_BYTES = 1024 * 1024 * 1024;

type DnsRecord = { address: string; family: number };
export type SafeDnsLookup = (hostname: string) => Promise<readonly DnsRecord[]>;
type FetchLike = (
  input: string,
  init: RequestInit & { dispatcher?: Agent }
) => Promise<Response>;

export type SafeRemoteFetchOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  headerTimeoutMs?: number;
  dnsTimeoutMs?: number;
  bodyTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxRedirects?: number;
  fetchImpl?: FetchLike;
  lookup?: SafeDnsLookup;
};

export type SafeRemoteStream = {
  stream: Readable;
  size?: number;
  contentType?: string;
  finalUrl: string;
  status: number;
  headers: Headers;
};

export function isBlockedIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  if ([a, b].some((part) => Number.isNaN(part))) return true;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function ipv6Hextets(ip: string): number[] | undefined {
  let normalized = ip.toLowerCase().split('%', 1)[0];
  if (normalized.includes('.')) {
    const separator = normalized.lastIndexOf(':');
    const octets = normalized
      .slice(separator + 1)
      .split('.')
      .map(Number);
    if (
      separator < 0 ||
      octets.length !== 4 ||
      octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return undefined;
    }
    normalized = `${normalized.slice(0, separator)}:${(
      octets[0] * 256 +
      octets[1]
    ).toString(16)}:${(octets[2] * 256 + octets[3]).toString(16)}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined;

  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ].map((part) => Number.parseInt(part, 16));
  return groups.length === 8 && groups.every(Number.isFinite)
    ? groups
    : undefined;
}

export function isBlockedIPv6(ip: string): boolean {
  const groups = ipv6Hextets(ip);
  if (!groups) return true;

  const [first] = groups;
  const unspecified = groups.every((part) => part === 0);
  const loopback =
    groups.slice(0, 7).every((part) => part === 0) && groups[7] === 1;
  const uniqueLocal = (first & 0xfe00) === 0xfc00;
  const linkLocal = (first & 0xffc0) === 0xfe80;
  const siteLocal = (first & 0xffc0) === 0xfec0;
  const multicast = (first & 0xff00) === 0xff00;
  const ipv4Mapped =
    groups.slice(0, 5).every((part) => part === 0) && groups[5] === 0xffff;
  const ipv4Compatible = groups.slice(0, 6).every((part) => part === 0);
  const ipv4Translatable =
    groups.slice(0, 4).every((part) => part === 0) &&
    groups[4] === 0xffff &&
    groups[5] === 0;
  const nat64WellKnown =
    groups[0] === 0x64 &&
    groups[1] === 0xff9b &&
    groups.slice(2, 6).every((part) => part === 0);
  const nat64LocalUse =
    groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 1;
  const embeddedIpv4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${
    groups[7] >> 8
  }.${groups[7] & 0xff}`;

  return (
    unspecified ||
    loopback ||
    uniqueLocal ||
    linkLocal ||
    siteLocal ||
    multicast ||
    nat64LocalUse ||
    ((ipv4Mapped || ipv4Compatible || ipv4Translatable || nat64WellKnown) &&
      isBlockedIPv4(embeddedIpv4))
  );
}

export function isBlockedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isBlockedIPv4(ip);
  if (version === 6) return isBlockedIPv6(ip);
  return true;
}

export const ssrfSafeDispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      if (net.isIP(hostname)) {
        const family = net.isIP(hostname);
        if (isBlockedIp(hostname)) {
          return callback(new Error('Blocked IP'), '', 0);
        }
        return options && (options as any).all
          ? callback(null, [{ address: hostname, family }] as any, family)
          : callback(null, hostname, family);
      }

      dns.lookup(hostname, options, (error, address: any, family: any) => {
        if (error) return callback(error, '', 0);
        if (Array.isArray(address)) {
          if (address.some((entry) => isBlockedIp(entry.address))) {
            return callback(new Error('Blocked IP'), '', 0);
          }
          return callback(null, address as any, 0);
        }
        if (isBlockedIp(address)) {
          return callback(new Error('Blocked IP'), '', 0);
        }
        callback(null, address, family);
      });
    },
  },
});

export function getSsrfSafeDispatcher(): Agent | undefined {
  return process.env.DISABLE_SSRF_PROTECTION === 'true'
    ? undefined
    : ssrfSafeDispatcher;
}

const lookupAll: SafeDnsLookup = (hostname) =>
  dnsPromises.lookup(hostname, { all: true });

async function resolveSafeRemoteUrl(
  value: string,
  lookup: SafeDnsLookup,
  dnsTimeoutMs: number
): Promise<{ parsed: URL; records: readonly DnsRecord[] }> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Remote media URL is invalid');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Remote media URL must use HTTP or HTTPS');
  }

  if (process.env.DISABLE_SSRF_PROTECTION === 'true') {
    return { parsed, records: [] };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost') {
    throw new Error('Blocked remote media URL');
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error('Blocked remote media URL');
    }
    return {
      parsed,
      records: [{ address: hostname, family: net.isIP(hostname) }],
    };
  }

  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const records = await Promise.race([
    lookup(hostname),
    new Promise<never>((_, reject) => {
      dnsTimer = setTimeout(
        () => reject(new Error('Remote media DNS lookup timed out')),
        dnsTimeoutMs
      );
    }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (!records.length || records.some(({ address }) => isBlockedIp(address))) {
    throw new Error('Blocked remote media URL');
  }
  return { parsed, records };
}

export async function assertSafeRemoteUrl(
  value: string,
  lookup: SafeDnsLookup = lookupAll,
  dnsTimeoutMs = SAFE_REMOTE_DNS_TIMEOUT_MS
): Promise<void> {
  await resolveSafeRemoteUrl(value, lookup, dnsTimeoutMs);
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (!response.body || response.body.locked) return;
  await response.body.cancel().catch(() => undefined);
}

function pinnedDispatcher(records: readonly DnsRecord[]): Agent | undefined {
  if (process.env.DISABLE_SSRF_PROTECTION === 'true' || records.length === 0) {
    return undefined;
  }
  return new Agent({
    connect: {
      lookup(_hostname, options, callback) {
        if ((options as any)?.all) {
          return callback(null, [...records] as any, 0);
        }
        const [record] = records;
        callback(null, record.address, record.family);
      },
    },
  });
}

type OpenRemoteResponse = {
  response: Response;
  controller: AbortController;
  dispatcher?: Agent;
  finalUrl: string;
};

async function disposeOpenResponse(
  opened: OpenRemoteResponse,
  cancelBody = true
): Promise<void> {
  if (cancelBody) await cancelResponseBody(opened.response);
  opened.controller.abort();
  opened.dispatcher?.destroy();
}

async function openRemoteResponse(
  url: string,
  options: SafeRemoteFetchOptions & {
    method?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<OpenRemoteResponse> {
  const headerTimeoutMs =
    options.headerTimeoutMs ??
    options.timeoutMs ??
    SAFE_REMOTE_HEADER_TIMEOUT_MS;
  const dnsTimeoutMs = options.dnsTimeoutMs ?? SAFE_REMOTE_DNS_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? SAFE_REMOTE_FETCH_MAX_REDIRECTS;
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const lookup = options.lookup ?? lookupAll;
  let currentUrl = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const { records } = await resolveSafeRemoteUrl(
      currentUrl,
      lookup,
      dnsTimeoutMs
    );
    const dispatcher = pinnedDispatcher(records);
    const controller = new AbortController();
    const responseTimeout = setTimeout(
      () => controller.abort(new Error('Remote media headers timed out')),
      headerTimeoutMs
    );
    let response: Response;
    try {
      response = await fetchImpl(currentUrl, {
        signal: controller.signal,
        redirect: 'manual',
        dispatcher,
        ...(options.method ? { method: options.method } : {}),
        ...(options.headers ? { headers: options.headers } : {}),
      });
    } catch (error) {
      dispatcher?.destroy();
      throw error;
    } finally {
      clearTimeout(responseTimeout);
    }

    const opened = { response, controller, dispatcher, finalUrl: currentUrl };
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await disposeOpenResponse(opened);
      if (!location) throw new Error('Remote redirect is missing Location');
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return opened;
  }
  throw new Error('Too many remote media redirects');
}

function responseSize(response: Response): number | undefined {
  const value = response.headers.get('content-length');
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

async function createBoundedStream(
  opened: OpenRemoteResponse,
  maxBytes: number,
  bodyTimeoutMs: number,
  idleTimeoutMs: number
): Promise<{ stream: Readable; dispose: () => Promise<void> }> {
  const declared = responseSize(opened.response);
  if (declared !== undefined && declared > maxBytes) {
    await disposeOpenResponse(opened);
    throw new Error('Remote media is too large');
  }
  if (!opened.response.body) {
    return {
      stream: Readable.from([]),
      dispose: () => disposeOpenResponse(opened, false),
    };
  }

  const reader = opened.response.body.getReader();
  let total = 0;
  let completed = false;
  let disposed = false;
  let stream: Readable;
  const bodyDeadline = Date.now() + bodyTimeoutMs;

  const chunks = async function* () {
    try {
      while (true) {
        const remaining = bodyDeadline - Date.now();
        if (remaining <= 0) {
          throw new Error('Remote media body download aborted by timeout');
        }
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        const next = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            idleTimer = setTimeout(
              () =>
                reject(
                  new Error(
                    'Remote media body download aborted by idle timeout'
                  )
                ),
              Math.min(idleTimeoutMs, remaining)
            );
          }),
        ]).finally(() => clearTimeout(idleTimer));
        if (next.done) {
          completed = true;
          break;
        }
        total += next.value.byteLength;
        if (total > maxBytes) {
          throw new Error('Remote media is too large');
        }
        yield Buffer.from(next.value);
      }
    } catch (error) {
      opened.controller.abort(error);
      throw error;
    } finally {
      if (!completed) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  };

  stream = Readable.from(chunks());
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    if (!completed) {
      await reader.cancel().catch(() => undefined);
      stream.destroy();
    }
    await disposeOpenResponse(opened, false);
  };
  return { stream, dispose };
}

export async function withSafeRemoteStream<T>(
  url: string,
  options: SafeRemoteFetchOptions & {
    method?: string;
    headers?: Record<string, string>;
    acceptedStatuses?: readonly number[];
    validateResponse?: (response: Response) => void;
  },
  consume: (source: SafeRemoteStream) => Promise<T>
): Promise<T> {
  const maxBytes = options.maxBytes ?? SAFE_REMOTE_FETCH_MAX_BYTES;
  const opened = await openRemoteResponse(url, options);
  const acceptedStatuses = options.acceptedStatuses ?? [200];
  if (!acceptedStatuses.includes(opened.response.status)) {
    await disposeOpenResponse(opened);
    throw new Error(
      `Remote media request failed with ${opened.response.status}`
    );
  }
  try {
    options.validateResponse?.(opened.response);
  } catch (error) {
    await disposeOpenResponse(opened);
    throw error;
  }
  const bodyTimeoutMs =
    options.bodyTimeoutMs ?? SAFE_REMOTE_FETCH_BODY_TIMEOUT_MS;
  const { stream, dispose } = await createBoundedStream(
    opened,
    maxBytes,
    bodyTimeoutMs,
    options.idleTimeoutMs ?? SAFE_REMOTE_FETCH_IDLE_TIMEOUT_MS
  );
  let bodyTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      consume({
        stream,
        size: responseSize(opened.response),
        contentType: opened.response.headers.get('content-type') || undefined,
        finalUrl: opened.finalUrl,
        status: opened.response.status,
        headers: opened.response.headers,
      }),
      new Promise<never>((_, reject) => {
        bodyTimer = setTimeout(() => {
          const error = new Error('Remote media body download timeout');
          opened.controller.abort(error);
          reject(error);
        }, bodyTimeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(bodyTimer);
    await dispose();
  }
}

export async function fetchRemoteMetadata(
  url: string,
  options: SafeRemoteFetchOptions = {}
): Promise<{ size?: number; contentType?: string; finalUrl: string }> {
  const opened = await openRemoteResponse(url, { ...options, method: 'HEAD' });
  try {
    if (opened.response.status !== 200) {
      throw new Error(
        `Remote media request failed with ${opened.response.status}`
      );
    }
    const size = responseSize(opened.response);
    if (
      size !== undefined &&
      size > (options.maxBytes ?? SAFE_REMOTE_FETCH_MAX_BYTES)
    ) {
      throw new Error('Remote media is too large');
    }
    return {
      size,
      contentType: opened.response.headers.get('content-type') || undefined,
      finalUrl: opened.finalUrl,
    };
  } finally {
    await disposeOpenResponse(opened);
  }
}

export async function withSafeRemoteRange<T>(
  url: string,
  options: SafeRemoteFetchOptions & {
    start: number;
    end: number;
    totalSize: number;
  },
  consume: (source: SafeRemoteStream) => Promise<T>
): Promise<T> {
  const expectedLength = options.end - options.start + 1;
  if (
    !Number.isSafeInteger(options.start) ||
    !Number.isSafeInteger(options.end) ||
    options.start < 0 ||
    options.end < options.start ||
    expectedLength > (options.maxBytes ?? SAFE_REMOTE_FETCH_MAX_BYTES)
  ) {
    throw new Error('Invalid remote media range');
  }
  return withSafeRemoteStream(
    url,
    {
      ...options,
      maxBytes: expectedLength,
      headers: { Range: `bytes=${options.start}-${options.end}` },
      acceptedStatuses: [206],
      validateResponse(response) {
        const contentRange = response.headers.get('content-range');
        if (
          contentRange !==
          `bytes ${options.start}-${options.end}/${options.totalSize}`
        ) {
          throw new Error('Invalid remote media Content-Range');
        }
        const declared = responseSize(response);
        if (declared !== expectedLength) {
          throw new Error('Invalid remote media range length');
        }
      },
    },
    consume
  );
}

export async function fetchRemoteBuffer(
  url: string,
  options: SafeRemoteFetchOptions = {}
): Promise<Buffer> {
  return withSafeRemoteStream(url, options, async ({ stream }) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  });
}
