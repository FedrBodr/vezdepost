import { Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { TelegramAssistantLinkService } from '@gitroom/nestjs-libraries/database/prisma/telegram-assistant/telegram.assistant.link.service';

@ApiTags('Telegram Assistant')
@Controller('/telegram-assistant')
export class TelegramAssistantController {
  constructor(private _linkService: TelegramAssistantLinkService) {}

  @Post('/link')
  async createLink(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    return { url: await this._linkService.createLinkUrl(user.id, org.id) };
  }
}
