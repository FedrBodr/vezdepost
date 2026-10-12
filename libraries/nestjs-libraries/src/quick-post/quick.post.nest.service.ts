import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  QuickPostChannel,
  QuickPostInput,
  QuickPostResult,
  QuickPostService,
} from '@gitroom/nestjs-libraries/quick-post/quick.post.service';

/** Nest-injectable facade over the dependency-free QuickPostService. */
@Injectable()
export class QuickPostNestService {
  private readonly service: QuickPostService;

  constructor(
    postsService: PostsService,
    integrationService: IntegrationService
  ) {
    this.service = new QuickPostService({ postsService, integrationService });
  }

  listChannels(organizationId: string): Promise<QuickPostChannel[]> {
    return this.service.listChannels(organizationId);
  }

  publish(
    organizationId: string,
    input: QuickPostInput,
    creationMethod: 'WEB' | 'API'
  ): Promise<QuickPostResult> {
    return this.service.publish(organizationId, input, creationMethod);
  }
}
