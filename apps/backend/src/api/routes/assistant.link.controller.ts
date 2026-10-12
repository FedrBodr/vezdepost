import { BadRequestException, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { TelegramAssistantLinkService } from '@gitroom/nestjs-libraries/database/prisma/telegram-assistant/telegram.assistant.link.service';

const TRANSPORTS = new Set(['telegram', 'max']);

@ApiTags('Assistant')
@Controller('/assistant')
export class AssistantLinkController {
  constructor(private _linkService: TelegramAssistantLinkService) {}

  /** One-time deep link that binds a messenger account to this user and organization. */
  @Post('/link/:transport')
  async createLink(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization,
    @Param('transport') transport: string
  ) {
    if (!TRANSPORTS.has(transport)) {
      throw new BadRequestException('Unknown transport');
    }
    return {
      url: await this._linkService.createLinkUrl(
        user.id,
        org.id,
        transport as 'telegram' | 'max'
      ),
    };
  }
}
