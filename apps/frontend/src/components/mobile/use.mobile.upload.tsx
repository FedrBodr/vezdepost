'use client';

import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import {
  compressImage,
  sizeProblem,
  typeProblem,
} from '@gitroom/frontend/components/mobile/image.compression';

/** Compresses when useful, uploads to the media library, returns {id, path}. */
export const useMobileUpload = () => {
  const fetch = useFetch();
  return useCallback(
    async (original: File) => {
      const unsupported = typeProblem(original);
      if (unsupported) {
        throw new Error(unsupported);
      }
      const file = await compressImage(original);
      const problem = sizeProblem(file);
      if (problem) {
        throw new Error(problem);
      }
      const formData = new FormData();
      formData.append('file', file, file.name);
      const response = await fetch('/media/upload-simple', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          typeof body?.message === 'string'
            ? body.message
            : 'Не удалось загрузить файл'
        );
      }
      const data = await response.json();
      return { id: data.id as string, path: data.path as string };
    },
    [fetch]
  );
};
