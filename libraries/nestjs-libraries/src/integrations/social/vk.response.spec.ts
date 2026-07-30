import { describe, expect, it } from 'vitest';
import { BadBody, RefreshToken } from '../social.abstract';
import { unwrapVkResponse } from './vk.response';

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
