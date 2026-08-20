import { isAbsolute, relative, resolve, sep } from 'node:path';
import { normalizedLocalMediaPath } from './valid.url.path';

export function resolveLocalUploadFilePath(
  mediaPath: string,
  uploadDirectory = process.env.UPLOAD_DIRECTORY
): string | undefined {
  const relativeMediaPath = normalizedLocalMediaPath(mediaPath);
  if (!relativeMediaPath || !uploadDirectory) {
    return undefined;
  }

  const root = resolve(uploadDirectory);
  const file = resolve(root, relativeMediaPath);
  const relation = relative(root, file);
  if (
    relation === '..' ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    return undefined;
  }
  return file;
}

export function resolveAppOwnedLocalUploadFilePath(
  mediaUrl: string
): string | undefined {
  if ((process.env.STORAGE_PROVIDER || 'local') !== 'local') {
    return undefined;
  }

  try {
    const frontend = new URL(process.env.FRONTEND_URL || '');
    const media = new URL(mediaUrl);
    const publicUploads = new URL('/uploads/', frontend);
    if (
      media.origin !== frontend.origin ||
      !media.pathname.startsWith(publicUploads.pathname)
    ) {
      return undefined;
    }
    return resolveLocalUploadFilePath(
      media.pathname.slice(publicUploads.pathname.length)
    );
  } catch {
    return undefined;
  }
}
