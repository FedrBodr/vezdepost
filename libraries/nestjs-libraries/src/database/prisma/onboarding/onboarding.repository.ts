import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class OnboardingRepository {
  constructor(
    private _user: PrismaRepository<
      'user' | 'integration' | 'post' | 'telegramAssistantLink'
    >
  ) {}

  getUser(userId: string) {
    return this._user.model.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        activated: true,
        deletedAt: true,
        sendOnboardingEmails: true,
        // the organization created at sign-up is the earliest membership
        organizations: {
          where: { organization: { deletedAt: null } },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { organizationId: true, disabled: true },
        },
      },
    });
  }

  countChannels(organizationId: string) {
    return this._user.model.integration.count({
      where: { organizationId, deletedAt: null },
    });
  }

  getFirstChannel(organizationId: string) {
    return this._user.model.integration.findFirst({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
  }

  countPosts(organizationId: string) {
    return this._user.model.post.count({
      where: { organizationId, deletedAt: null },
    });
  }

  getAssistantLinks(userId: string) {
    return this._user.model.telegramAssistantLink.findMany({
      where: { userId },
      select: { transport: true, telegramUserId: true },
    });
  }

  unsubscribe(userId: string) {
    return this._user.model.user.updateMany({
      where: { id: userId },
      data: { sendOnboardingEmails: false },
    });
  }
}
