import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class TelegramAssistantLinkRepository {
  constructor(
    private _link: PrismaRepository<'telegramAssistantLink'>,
    private _membership: PrismaRepository<'userOrganization'>
  ) {}

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

  deleteByTelegramUserId(telegramUserId: string) {
    return this._link.model.telegramAssistantLink.deleteMany({
      where: { telegramUserId },
    });
  }

  async isActiveMember(userId: string, organizationId: string) {
    const membership = await this._membership.model.userOrganization.findFirst({
      where: { userId, organizationId, disabled: false },
      select: { id: true },
    });
    return !!membership;
  }
}
