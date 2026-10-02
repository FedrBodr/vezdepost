import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class TelegramAssistantLinkRepository {
  constructor(private _link: PrismaRepository<'telegramAssistantLink'>) {}

  upsertLink(telegramUserId: string, userId: string, organizationId: string) {
    return this._link.model.telegramAssistantLink.upsert({
      where: { telegramUserId },
      create: { telegramUserId, userId, organizationId },
      update: { userId, organizationId },
    });
  }

  findByTelegramUserId(telegramUserId: string) {
    return this._link.model.telegramAssistantLink.findUnique({
      where: { telegramUserId },
    });
  }
}
