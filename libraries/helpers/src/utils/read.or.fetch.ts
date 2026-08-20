import { readMediaSourceBuffer } from './media.source';

export const readOrFetch = async (path: string) => {
  return readMediaSourceBuffer(path);
};
