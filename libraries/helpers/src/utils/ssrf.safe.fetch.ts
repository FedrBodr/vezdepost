import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import net from 'node:net';
import { Agent } from 'undici';

export const SAFE_REMOTE_FETCH_TIMEOUT_MS = 2_000;
export const SAFE_REMOTE_FETCH_BODY_TIMEOUT_MS = 15 * 60 * 1_000;
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

export async function assertSafeRemoteUrl(
  value: string,
  lookup: SafeDnsLookup = lookupAll
): Promise<void> {
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
    return;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost') {
    throw new Error('Blocked remote media URL');
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error('Blocked remote media URL');
    }
    return;
  }

  const records = await lookup(hostname);
  if (!records.length || records.some(({ address }) => isBlockedIp(address))) {
    throw new Error('Blocked remote media URL');
  }
}

async function readBoundedBody(
  response: Response,
  maxBytes: number
): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (declared && declared > maxBytes) {
    throw new Error('Remote media is too large');
  }

  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Remote media is too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total
  );
}

export async function fetchRemoteBuffer(
  url: string,
  options: {
    maxBytes?: number;
    timeoutMs?: number;
    bodyTimeoutMs?: number;
    maxRedirects?: number;
    fetchImpl?: FetchLike;
    lookup?: SafeDnsLookup;
  } = {}
): Promise<Buffer> {
  const maxBytes = options.maxBytes ?? SAFE_REMOTE_FETCH_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? SAFE_REMOTE_FETCH_TIMEOUT_MS;
  const bodyTimeoutMs =
    options.bodyTimeoutMs ?? SAFE_REMOTE_FETCH_BODY_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? SAFE_REMOTE_FETCH_MAX_REDIRECTS;
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const lookup = options.lookup ?? lookupAll;

  let currentUrl = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertSafeRemoteUrl(currentUrl, lookup);
    const controller = new AbortController();
    const responseTimeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(currentUrl, {
        signal: controller.signal,
        redirect: 'manual',
        dispatcher: getSsrfSafeDispatcher(),
      });
    } finally {
      clearTimeout(responseTimeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Remote redirect is missing Location');
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!response.ok) {
      throw new Error(`Remote media request failed with ${response.status}`);
    }
    const bodyTimeout = setTimeout(() => controller.abort(), bodyTimeoutMs);
    try {
      return await readBoundedBody(response, maxBytes);
    } finally {
      clearTimeout(bodyTimeout);
    }
  }
  throw new Error('Too many remote media redirects');
}
