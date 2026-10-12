// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

import { useMobileUpload } from './use.mobile.upload';

beforeEach(() => fetchMock.mockReset());

describe('useMobileUpload', () => {
  it('refuses an iPhone MOV before uploading', async () => {
    const { result } = renderHook(() => useMobileUpload());
    await expect(
      result.current(new File(['v'], 'clip.mov', { type: 'video/quicktime' }))
    ).rejects.toThrow('Видео: только MP4');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the server reason on a 400', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Unsupported file type.' }),
    });
    const { result } = renderHook(() => useMobileUpload());
    await expect(
      result.current(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
    ).rejects.toThrow('Unsupported file type.');
  });

  it('returns id and path on success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 'm1', path: '/u/a.jpg' }),
    });
    const { result } = renderHook(() => useMobileUpload());
    await expect(
      result.current(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
    ).resolves.toEqual({ id: 'm1', path: '/u/a.jpg' });
  });
});
