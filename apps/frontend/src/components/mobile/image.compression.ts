export const COMPRESS_ABOVE_BYTES = 1.5 * 1024 * 1024;
export const MAX_SIDE = 2048;
export const IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
export const VIDEO_LIMIT_BYTES = 1024 * 1024 * 1024;
const JPEG_QUALITY = 0.85;

type FileLike = { type: string; size: number };

export const shouldCompress = (
  file: FileLike,
  width?: number,
  height?: number
) => {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return false;
  }
  if (file.size > COMPRESS_ABOVE_BYTES) {
    return true;
  }
  return Math.max(width || 0, height || 0) > MAX_SIDE;
};

export const targetSize = (width: number, height: number) => {
  const longest = Math.max(width, height);
  if (longest <= MAX_SIDE) {
    return { width, height };
  }
  const ratio = MAX_SIDE / longest;
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
};

/**
 * Formats the backend refuses that phones commonly produce. Checked before
 * any upload so the user gets a reason instead of a generic failure.
 */
export const typeProblem = (file: {
  type: string;
  name: string;
}): string | null => {
  const name = file.name.toLowerCase();
  if (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.(heic|heif)$/.test(name)
  ) {
    return 'Формат HEIC не поддерживается';
  }
  if (
    (file.type.startsWith('video/') && file.type !== 'video/mp4') ||
    /\.(mov|3gp|webm|avi|mkv)$/.test(name)
  ) {
    return 'Видео: только MP4';
  }
  return null;
};

/** Checked after compression, against the backend limits. */
export const sizeProblem = (file: FileLike): string | null => {
  if (file.type.startsWith('image/')) {
    return file.size > IMAGE_LIMIT_BYTES ? 'Фото больше 10 МБ' : null;
  }
  if (file.type.startsWith('video/')) {
    return file.size > VIDEO_LIMIT_BYTES ? 'Видео больше 1 ГБ' : null;
  }
  return 'Можно только фото или видео';
};

const loadImage = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    image.src = url;
  });

/** Browser only. Returns the original file when nothing needs doing or on any failure. */
export const compressImage = async (file: File): Promise<File> => {
  if (!shouldCompress(file)) {
    return file;
  }
  try {
    const image = await loadImage(file);
    if (!shouldCompress(file, image.naturalWidth, image.naturalHeight)) {
      return file;
    }
    const { width, height } = targetSize(
      image.naturalWidth,
      image.naturalHeight
    );
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    );
    if (!blob || blob.size >= file.size) {
      return file;
    }
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
};
