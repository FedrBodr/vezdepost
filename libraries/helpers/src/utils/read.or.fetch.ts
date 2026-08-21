import { type MediaSourceOptions, readMediaSourceBuffer } from './media.source';

export const readOrFetch = async (
  path: string,
  options?: MediaSourceOptions
) => {
  return options
    ? readMediaSourceBuffer(path, options)
    : readMediaSourceBuffer(path);
};
