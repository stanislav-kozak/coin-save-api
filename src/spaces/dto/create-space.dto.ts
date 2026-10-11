import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { USER_LOCALES, type UserLocale } from '../../users/dto/update-me.dto';

export class CreateSpaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  // Language of the default categories: the UI language the space is created
  // in. Falls back to the account language when omitted.
  @ApiPropertyOptional({
    enum: USER_LOCALES,
    enumName: 'UserLocale',
    description:
      'Language of the default categories (send the UI language); ' +
      "defaults to the account's language",
  })
  @IsOptional()
  @IsIn(USER_LOCALES)
  locale?: UserLocale;
}
