import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { QuickPostDto } from '@gitroom/nestjs-libraries/dtos/posts/quick.post.dto';
import { QuickPostNestService } from '@gitroom/nestjs-libraries/quick-post/quick.post.nest.service';
import { QuickPostError } from '@gitroom/nestjs-libraries/quick-post/quick.post.service';

@ApiTags('Posts')
@Controller('/posts')
export class QuickPostController {
  constructor(private _quickPost: QuickPostNestService) {}

  /** One post per selected channel with default settings (mobile and bots). */
  @Post('/quick')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async publish(
    @GetOrgFromRequest() org: Organization,
    @Body() body: QuickPostDto
  ) {
    try {
      return await this._quickPost.publish(
        org.id,
        {
          text: body.text,
          media: body.media,
          integrationIds: body.integrationIds,
          schedule:
            body.schedule.type === 'date'
              ? { type: 'date', date: body.schedule.date! }
              : { type: body.schedule.type },
        },
        'WEB'
      );
    } catch (error) {
      if (error instanceof QuickPostError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
