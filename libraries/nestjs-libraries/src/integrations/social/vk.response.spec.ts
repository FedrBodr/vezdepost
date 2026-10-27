import { describe, expect, it, vi } from 'vitest';
import { BadBody, RefreshToken } from '../social.abstract';
import { collectVkWallPosts, unwrapVkResponse } from './vk.response';

describe('collectVkWallPosts', () => {
  it('pages through the wall until posts are older than the window', async () => {
    const page = (dates: number[]) => ({
      items: dates.map((date) => ({ date })),
    });
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce(page([300, 200]))
      .mockResolvedValueOnce(page([150, 50]));

    const posts = await collectVkWallPosts(loadPage, 100, 2);

    expect(posts.map(({ date }) => date)).toEqual([300, 200, 150]);
    expect(loadPage.mock.calls).toEqual([[0], [2]]);
  });
});

describe('unwrapVkResponse', () => {
  it('returns a valid VK response', () => {
    expect(
      unwrapVkResponse({ response: { post_id: 42 } }, 'wall.post')
    ).toEqual({ post_id: 42 });
  });

  it('maps VK error 5 to refresh-token without exposing credentials', () => {
    const token = 'vk-secret-token';
    expect(() =>
      unwrapVkResponse(
        { error: { error_code: 5, error_msg: `expired ${token}` } },
        'wall.post'
      )
    ).toThrow(RefreshToken);
    try {
      unwrapVkResponse(
        { error: { error_code: 5, error_msg: `expired ${token}` } },
        'wall.post'
      );
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(token);
    }
  });

  it('maps another VK error to a sanitized bad-body failure', () => {
    expect(() =>
      unwrapVkResponse(
        { error: { error_code: 100, error_msg: 'bad parameter' } },
        'photos.saveWallPhoto'
      )
    ).toThrow(BadBody);
  });

  it('rejects a payload without response or error', () => {
    expect(() => unwrapVkResponse({}, 'wall.post')).toThrow(BadBody);
  });
});
