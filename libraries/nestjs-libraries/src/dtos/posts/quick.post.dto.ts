import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QuickPostMediaDto {
  @IsDefined()
  @IsString()
  id: string;

  @IsDefined()
  @IsString()
  path: string;
}

export class QuickPostScheduleDto {
  @IsDefined()
  @IsIn(['now', 'queue', 'date'])
  type: 'now' | 'queue' | 'date';

  @ValidateIf((o) => o.type === 'date')
  @IsDefined()
  @IsDateString()
  date?: string;
}

export class QuickPostDto {
  @IsDefined()
  @IsString()
  text: string;

  @IsDefined()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuickPostMediaDto)
  media: QuickPostMediaDto[];

  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  integrationIds: string[];

  @IsDefined()
  @ValidateNested()
  @Type(() => QuickPostScheduleDto)
  schedule: QuickPostScheduleDto;
}
