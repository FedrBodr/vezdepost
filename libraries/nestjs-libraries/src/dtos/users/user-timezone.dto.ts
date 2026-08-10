import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UserTimezoneDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  timezoneName: string;
}
