import { describe, expect, it } from 'vitest';
import {
  isTelegramStoriesEnabledForOrg,
  resolveStoryFrameCaptions,
} from './telegram.stories.constants';

const media = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('resolveStoryFrameCaptions', () => {
  it('puts the post text on the first frame by default', () => {
    expect(resolveStoryFrameCaptions('Hi', media)).toEqual(['Hi', '', '']);
  });

  it('matches frames by media id regardless of order', () => {
    expect(
      resolveStoryFrameCaptions('Hi', media, [
        { mediaId: 'c', text: 'custom', caption: 'Third' },
        { mediaId: 'a', text: 'none' },
      ])
    ).toEqual(['', '', 'Third']);
  });

  it('matches id-less frames by position (MCP form)', () => {
    expect(
      resolveStoryFrameCaptions('Hi', media, [
        { text: 'none' },
        { text: 'post' },
        { text: 'custom', caption: 'Last' },
      ])
    ).toEqual(['', 'Hi', 'Last']);
  });

  it('does not apply a frame bound to another media by position', () => {
    expect(
      resolveStoryFrameCaptions(
        'Hi',
        [{ id: 'x' }],
        [{ mediaId: 'gone', text: 'none' }]
      )
    ).toEqual(['Hi']);
  });
});

describe('isTelegramStoriesEnabledForOrg', () => {
  it.each([
    [undefined, 'org-1', false],
    ['  ', 'org-1', false],
    ['org-1, org-2', 'org-2', true],
    ['org-1', 'org-3', false],
  ])('%s / %s -> %s', (raw, org, expected) => {
    expect(isTelegramStoriesEnabledForOrg(raw as any, org)).toBe(expected);
  });
});
