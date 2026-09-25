import {
  callTelegramApi,
  callTelegramApiMultipart,
} from '@gitroom/nestjs-libraries/integrations/social/telegram.rich.api';

export type TelegramBusinessConnection = {
  id: string;
  user: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  is_enabled: boolean;
  rights?: { can_manage_stories?: boolean };
};

export type PostStoryParams = {
  businessConnectionId: string;
  kind: 'photo' | 'video';
  file: Buffer;
  durationSeconds?: number;
  activePeriod: number;
  caption?: string;
};

export class TelegramBusinessApi {
  constructor(private readonly token = process.env.TELEGRAM_TOKEN || '') {}

  getBusinessConnection(id: string) {
    return callTelegramApi<TelegramBusinessConnection>(
      this.token,
      'getBusinessConnection',
      { business_connection_id: id }
    );
  }

  postStory(params: PostStoryParams) {
    const content =
      params.kind === 'photo'
        ? { type: 'photo', photo: 'attach://story' }
        : {
            type: 'video',
            video: 'attach://story',
            duration: params.durationSeconds,
            is_animation: false,
          };
    return callTelegramApiMultipart<{ id: number }>(
      this.token,
      'postStory',
      {
        business_connection_id: params.businessConnectionId,
        content: JSON.stringify(content),
        active_period: String(params.activePeriod),
        ...(params.caption
          ? { caption: params.caption, parse_mode: 'HTML' }
          : {}),
      },
      {
        field: 'story',
        filename: params.kind === 'photo' ? 'story.jpg' : 'story.mp4',
        contentType: params.kind === 'photo' ? 'image/jpeg' : 'video/mp4',
        data: params.file,
      }
    );
  }
}
