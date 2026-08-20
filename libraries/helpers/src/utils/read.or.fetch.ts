import { readFileSync } from 'fs';
import { fetchRemoteBuffer } from './ssrf.safe.fetch';
import { resolveAppOwnedLocalUploadFilePath } from './local.upload.path';

export const readOrFetch = async (path: string) => {
  if (/^https?:\/\//i.test(path)) {
    const localFile = resolveAppOwnedLocalUploadFilePath(path);
    if (localFile) {
      return readFileSync(localFile);
    }
    return fetchRemoteBuffer(path);
  }

  return readFileSync(path);
};
