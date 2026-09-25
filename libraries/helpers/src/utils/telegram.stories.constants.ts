export const TELEGRAM_STORIES_IDENTIFIER = 'telegram-stories';
export const TELEGRAM_STORY_ACTIVE_PERIODS = [
  '21600',
  '43200',
  '86400',
  '172800',
] as const;
export const TELEGRAM_STORY_DEFAULT_ACTIVE_PERIOD = '86400';
export const TELEGRAM_STORY_MAX_FRAMES = 10;
export const TELEGRAM_STORY_CAPTION_MAX = 2048;
export const TELEGRAM_STORY_VIDEO_MAX_SECONDS = 60;

export type TelegramStoryFrameText = 'post' | 'none' | 'custom';
export type TelegramStoryFrameSetting = {
  mediaId?: string;
  text: TelegramStoryFrameText;
  caption?: string;
};

/**
 * Caption for every story of a series. A frame binds to media by id (editor)
 * or, without an id, by position (MCP). The post text defaults to the first
 * story only.
 */
export const resolveStoryFrameCaptions = (
  postText: string,
  media: Array<{ id?: string }>,
  frames: TelegramStoryFrameSetting[] = []
): string[] =>
  media.map((item, index) => {
    const byId = item.id
      ? frames.find((frame) => frame.mediaId === item.id)
      : undefined;
    const positional = frames[index];
    const frame =
      byId ?? (positional && !positional.mediaId ? positional : undefined);
    const text = frame?.text ?? (index === 0 ? 'post' : 'none');
    if (text === 'post') {
      return postText;
    }
    return text === 'custom' ? frame?.caption ?? '' : '';
  });

export const isTelegramStoriesEnabledForOrg = (
  rawValue: string | undefined,
  orgId: string
) =>
  (rawValue || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(orgId);
