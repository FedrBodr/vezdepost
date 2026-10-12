import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export type AssistantLinkTransport = 'telegram' | 'max';

@Injectable()
export class TelegramAssistantLinkRepository {
  constructor(
    private _link: PrismaRepository<'telegramAssistantLink'>,
    private _membership: PrismaRepository<'userOrganization'>
  ) {}

  upsertLink(
    transport: AssistantLinkTransport,
    telegramUserId: string,
    userId: string,
    organizationId: string
  ) {
    return this._link.model.telegramAssistantLink.upsert({
      where: { transport_telegramUserId: { transport, telegramUserId } },
      create: { transport, telegramUserId, userId, organizationId },
      update: { userId, organizationId },
    });
  }

  findByMessengerUserId(
    transport: AssistantLinkTransport,
    telegramUserId: string
  ) {
    return this._link.model.telegramAssistantLink.findUnique({
      where: { transport_telegramUserId: { transport, telegramUserId } },
    });
  }

  deleteByMessengerUserId(
    transport: AssistantLinkTransport,
    telegramUserId: string
  ) {
    return this._link.model.telegramAssistantLink.deleteMany({
      where: { transport, telegramUserId },
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
