import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  TELEGRAM_STORY_ACTIVE_PERIODS,
  TELEGRAM_STORY_MAX_FRAMES,
} from '@gitroom/helpers/utils/telegram.stories.constants';

export class TelegramStoryFrameDto {
  @IsOptional()
  @IsString()
  mediaId?: string;

  @IsIn(['post', 'none', 'custom'])
  text: 'post' | 'none' | 'custom';

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  caption?: string;
}

export class TelegramStoriesDto {
  @IsOptional()
  @IsIn([...TELEGRAM_STORY_ACTIVE_PERIODS])
  active_period?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TELEGRAM_STORY_MAX_FRAMES)
  @ValidateNested({ each: true })
  @Type(() => TelegramStoryFrameDto)
  frames?: TelegramStoryFrameDto[];
}
