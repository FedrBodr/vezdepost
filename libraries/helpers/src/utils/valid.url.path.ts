import {
  ValidationArguments,
  ValidatorConstraintInterface,
  ValidatorConstraint,
} from 'class-validator';
import { terminalExtension } from './has.extension';

const ALLOWED_MEDIA_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'mp4',
]);

export function normalizedLocalMediaPath(value: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.split(/[?#]/, 1)[0]);
  } catch {
    return undefined;
  }

  const normalized = decoded.replace(/\\/g, '/');
  if (/^[a-z]:/i.test(normalized) || normalized.includes('\0')) {
    return undefined;
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..')) {
    return undefined;
  }
  const relative = segments
    .filter((segment) => segment && segment !== '.')
    .join('/');
  return relative || undefined;
}

@ValidatorConstraint({ name: 'checkValidExtension', async: false })
export class ValidUrlExtension implements ValidatorConstraintInterface {
  validate(text: string, args: ValidationArguments) {
    const extension = terminalExtension(text);
    return !!extension && ALLOWED_MEDIA_EXTENSIONS.has(extension);
  }

  defaultMessage(args: ValidationArguments) {
    // here you can provide default error message if validation failed
    return 'File must have a valid extension: .png, .jpg, .jpeg, .gif, .webp, or .mp4';
  }
}

@ValidatorConstraint({ name: 'checkValidPath', async: false })
export class ValidUrlPath implements ValidatorConstraintInterface {
  validate(text: string, args: ValidationArguments) {
    if (typeof text !== 'string' || !text) {
      return false;
    }

    const looksRemote =
      /^[a-z][a-z\d+.-]*:/i.test(text) || text.startsWith('//');
    if (!looksRemote) {
      return !!normalizedLocalMediaPath(text);
    }

    let parsed: URL;
    try {
      parsed = new URL(text);
    } catch {
      return false;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    const restrictedHostname = process.env.RESTRICT_UPLOAD_DOMAINS?.trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .replace(/\.$/, '');
    if (!restrictedHostname) {
      return true;
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    return (
      hostname === restrictedHostname ||
      hostname.endsWith(`.${restrictedHostname}`)
    );
  }

  defaultMessage(args: ValidationArguments) {
    // here you can provide default error message if validation failed
    return (
      'URL must contain the domain: ' +
      process.env.RESTRICT_UPLOAD_DOMAINS +
      ' Make sure you first use the upload API route.'
    );
  }
}
